using System.Diagnostics;
using System.IO;
using Microsoft.Win32;

namespace AIStephVoice;

internal static class DesktopSettings
{
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string RunValueName = "AISteph Voice";
    private const string SettingsKeyPath = @"Software\AISteph Voice";
    private const string HotkeyValueName = "RecordingHotkey";

    public static string GetHotkey()
    {
        using var key = Registry.CurrentUser.OpenSubKey(SettingsKeyPath, writable: false);
        var stored = key?.GetValue(HotkeyValueName) as string;
        return GlobalHotkey.TryNormalize(stored, out var normalized)
            ? normalized
            : GlobalHotkey.DefaultDisplayText;
    }

    public static void SetHotkey(string shortcut)
    {
        if (!GlobalHotkey.TryNormalize(shortcut, out var normalized))
        {
            throw new InvalidOperationException("快捷键格式无效。");
        }
        using var key = Registry.CurrentUser.CreateSubKey(SettingsKeyPath, writable: true)
            ?? throw new InvalidOperationException("无法保存 AISteph Voice 设置。");
        key.SetValue(HotkeyValueName, normalized, RegistryValueKind.String);
    }
    public static bool IsStartWithWindowsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
        var current = key?.GetValue(RunValueName) as string;
        return string.Equals(current, BuildStartupCommand(), StringComparison.OrdinalIgnoreCase);
    }

    public static void SetStartWithWindows(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
            ?? throw new InvalidOperationException("无法打开 Windows 当前用户启动项。");
        if (enabled)
        {
            key.SetValue(RunValueName, BuildStartupCommand(), RegistryValueKind.String);
        }
        else
        {
            key.DeleteValue(RunValueName, throwOnMissingValue: false);
        }
    }

    public static string EnsureRecordingsDirectory()
    {
        var path = ServiceManager.RecordingsDirectory;
        Directory.CreateDirectory(path);
        return path;
    }

    public static void OpenRecordingsDirectory()
    {
        var path = EnsureRecordingsDirectory();
        Process.Start(new ProcessStartInfo
        {
            FileName = "explorer.exe",
            Arguments = $"\"{path}\"",
            UseShellExecute = true
        });
    }

    private static string BuildStartupCommand()
    {
        var executablePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("无法读取 AISteph Voice 程序路径。");
        return $"\"{executablePath}\" --background";
    }
}