using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace AIStephVoice;

internal static class ServiceManager
{
    public const string Origin = "http://127.0.0.1:39310";
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromSeconds(2) };
    private static readonly Queue<string> OutputTail = new();
    private static Process? serviceProcess;

    public static bool OwnsService => serviceProcess is { HasExited: false };

    public static string RecordingsDirectory
    {
        get
        {
            var launch = LocateRuntime();
            return Path.Combine(launch.WorkspaceRoot, "data", "audio");
        }
    }

    public static async Task EnsureRunningAsync()
    {
        if (await IsReadyAsync()) return;

        var launch = LocateRuntime();
        Directory.CreateDirectory(launch.WorkspaceRoot);
        var startInfo = new ProcessStartInfo
        {
            FileName = FindNodeExecutable(launch.RuntimeRoot),
            Arguments = $"\"{launch.ServerScript}\"",
            WorkingDirectory = launch.WorkspaceRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        startInfo.Environment["AISTEPH_DESKTOP_CLIENT"] = "1";
        startInfo.Environment["PATH"] = launch.RuntimeRoot + Path.PathSeparator
            + Environment.GetEnvironmentVariable("PATH");

        try
        {
            serviceProcess = Process.Start(startInfo)
                ?? throw new InvalidOperationException("Node.js 服务进程未能创建。");
            serviceProcess.OutputDataReceived += (_, eventArgs) => RememberOutput(eventArgs.Data);
            serviceProcess.ErrorDataReceived += (_, eventArgs) => RememberOutput(eventArgs.Data);
            serviceProcess.BeginOutputReadLine();
            serviceProcess.BeginErrorReadLine();
        }
        catch (Exception error)
        {
            throw new InvalidOperationException(
                "无法启动 AISteph Voice 录音服务，请确认 Node.js 已安装。\n" + error.Message,
                error
            );
        }

        for (var attempt = 0; attempt < 80; attempt++)
        {
            if (await IsReadyAsync()) return;
            if (serviceProcess.HasExited)
            {
                throw new InvalidOperationException(
                    "录音服务启动后立即退出。\n" + string.Join(Environment.NewLine, OutputTail)
                );
            }
            await Task.Delay(250);
        }
        throw new TimeoutException("录音服务启动超时，请检查本机 39310 端口是否被占用。");
    }

    public static async Task StopOwnedServiceAsync()
    {
        var process = serviceProcess;
        serviceProcess = null;
        if (process is null || process.HasExited) return;
        try
        {
            process.Kill(entireProcessTree: true);
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await process.WaitForExitAsync(timeout.Token);
        }
        catch
        {
            // Windows logout or process shutdown may complete before the wait returns.
        }
        finally
        {
            process.Dispose();
        }
    }

    public static async Task<bool> IsReadyAsync()
    {
        try
        {
            using var response = await Client.GetAsync(Origin + "/");
            if (!response.IsSuccessStatusCode) return false;
            var html = await response.Content.ReadAsStringAsync();
            return html.Contains("name=\"aisteph-token\"", StringComparison.Ordinal)
                && html.Contains("name=\"aisteph-version\"", StringComparison.Ordinal);
        }
        catch
        {
            return false;
        }
    }

    private static RuntimeLaunch LocateRuntime()
    {
        var packagedRoot = Path.Combine(AppContext.BaseDirectory, "runtime");
        var packagedScript = Path.Combine(packagedRoot, "src", "server.js");
        if (File.Exists(packagedScript))
        {
            var workspaceRoot = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "AISteph Voice"
            );
            return new RuntimeLaunch(packagedRoot, packagedScript, workspaceRoot);
        }

        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        for (var level = 0; level < 9 && directory is not null; level++, directory = directory.Parent)
        {
            var serverScript = Path.Combine(directory.FullName, "src", "server.js");
            var versionFile = Path.Combine(directory.FullName, "VERSION");
            if (File.Exists(serverScript) && File.Exists(versionFile))
            {
                return new RuntimeLaunch(directory.FullName, serverScript, directory.FullName);
            }
        }
        throw new FileNotFoundException("客户端安装目录缺少录音服务文件。", packagedScript);
    }
    private static string FindNodeExecutable(string runtimeRoot)
    {
        var bundledNode = Path.Combine(runtimeRoot, "node.exe");
        return File.Exists(bundledNode) ? bundledNode : "node";
    }

    private static void RememberOutput(string? line)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        lock (OutputTail)
        {
            OutputTail.Enqueue(line);
            while (OutputTail.Count > 8) OutputTail.Dequeue();
        }
    }

    private sealed record RuntimeLaunch(string RuntimeRoot, string ServerScript, string WorkspaceRoot);
}