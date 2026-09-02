using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace AIStephVoice;

public partial class MainWindow : Window
{
    private readonly System.Windows.Forms.NotifyIcon trayIcon;
    private readonly System.Windows.Forms.ToolStripMenuItem toggleMenuItem;
    private readonly System.Drawing.Icon idleTrayIcon;
    private readonly System.Drawing.Icon recordingTrayIcon;
    private readonly BitmapImage idleWindowIcon;
    private readonly BitmapImage recordingWindowIcon;
    private readonly DispatcherTimer updateTimer;
    private GlobalHotkey? globalHotkey;
    private bool requestActive;
    private bool exitRequested;
    private bool hideNoticeShown;
    private bool recordingStateRefreshActive;
    private bool recordingVisualActive;

    public MainWindow()
    {
        InitializeComponent();
        var configuredHotkey = DesktopSettings.GetHotkey();
        idleTrayIcon = LoadTrayIcon("Assets/AIStephVoice.ico");
        recordingTrayIcon = LoadTrayIcon("Assets/AIStephVoiceRecording.ico");
        idleWindowIcon = LoadWindowIcon("Assets/AIStephVoice.png");
        recordingWindowIcon = LoadWindowIcon("Assets/AIStephVoiceRecording.png");
        Icon = idleWindowIcon;
        toggleMenuItem = new System.Windows.Forms.ToolStripMenuItem($"开始 / 停止录音    {configuredHotkey}");
        toggleMenuItem.Click += async (_, _) => await Dispatcher.InvokeAsync(ToggleRecordingAsync);

        var openMenuItem = new System.Windows.Forms.ToolStripMenuItem("打开 AISteph Voice");
        openMenuItem.Click += (_, _) => Dispatcher.Invoke(ShowAndActivate);

        var updateMenuItem = new System.Windows.Forms.ToolStripMenuItem("检查在线更新…");
        updateMenuItem.Click += async (_, _) => await Dispatcher.InvokeAsync(() => CheckForUpdatesAsync(true));

        var exitMenuItem = new System.Windows.Forms.ToolStripMenuItem("退出 AISteph Voice");
        exitMenuItem.Click += async (_, _) => await Dispatcher.InvokeAsync(RequestExitAsync);

        var menu = new System.Windows.Forms.ContextMenuStrip();
        menu.Items.Add(toggleMenuItem);
        menu.Items.Add(openMenuItem);
        menu.Items.Add(updateMenuItem);
        menu.Items.Add(new System.Windows.Forms.ToolStripSeparator());
        menu.Items.Add(exitMenuItem);

        trayIcon = new System.Windows.Forms.NotifyIcon
        {
            Icon = idleTrayIcon,
            Text = $"AISteph Voice（{configuredHotkey}）",
            ContextMenuStrip = menu,
            Visible = true
        };
        trayIcon.DoubleClick += (_, _) => Dispatcher.Invoke(ShowAndActivate);

        updateTimer = new DispatcherTimer { Interval = TimeSpan.FromHours(12) };
        updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync(false);
        updateTimer.Start();


        SourceInitialized += HandleSourceInitialized;
        Closing += HandleClosing;
        StateChanged += HandleStateChanged;
    }

    public async Task InitializeAsync()
    {
        LoadingMessage.Text = "正在连接本地录音工作区…";
        await WorkspaceView.EnsureCoreWebView2Async();
        WorkspaceView.CoreWebView2.Settings.AreDevToolsEnabled = false;
        WorkspaceView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        WorkspaceView.CoreWebView2.WebMessageReceived += HandleWebMessageReceived;
        WorkspaceView.CoreWebView2.NavigationCompleted += HandleNavigationCompleted;
        WorkspaceView.Source = new Uri(ServiceManager.Origin + "/");
        var hotkey = DesktopSettings.GetHotkey();
        Notify("AISteph Voice 已就绪", $"按 {hotkey} 即可开始或停止录音。", System.Windows.Forms.ToolTipIcon.Info);
        _ = RefreshRecordingVisualAsync();
        _ = CheckForUpdatesAsync(false);
    }

    public void ShowAndActivate()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        Topmost = true;
        Topmost = false;
        Focus();
    }

    private void HandleSourceInitialized(object? sender, EventArgs eventArgs)
    {
        var configuredHotkey = DesktopSettings.GetHotkey();
        globalHotkey = new GlobalHotkey(new WindowInteropHelper(this).Handle, configuredHotkey);
        globalHotkey.Pressed += async (_, _) => await ToggleRecordingAsync();
        UpdateHotkeyPresentation();
        if (!globalHotkey.IsRegistered)
        {
            Notify(
                "快捷键注册失败",
                $"{configuredHotkey} 已被其他程序占用，请在设置中更换。",
                System.Windows.Forms.ToolTipIcon.Warning
            );
        }
    }

    private void HandleNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (eventArgs.IsSuccess)
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            SendDesktopSettings();
            return;
        }
        LoadingMessage.Text = "工作台加载失败，请稍后重试。";
    }

    private async void HandleWebMessageReceived(
        object? sender,
        CoreWebView2WebMessageReceivedEventArgs eventArgs
    )
    {
        if (!IsTrustedMessageSource(eventArgs.Source)) return;
        try
        {
            using var message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            if (!message.RootElement.TryGetProperty("type", out var typeProperty)) return;
            var type = typeProperty.GetString();
            switch (type)
            {
                case "recorder:state":
                    if (message.RootElement.TryGetProperty("state", out var stateProperty)
                        && stateProperty.ValueKind == JsonValueKind.String)
                    {
                        var recorderState = stateProperty.GetString();
                        SetRecordingVisual(recorderState is "starting" or "recording" or "stopping");
                    }
                    break;                case "settings:get":
                    SendDesktopSettings();
                    break;
                case "settings:set-hotkey":
                    UpdateRecordingHotkey(message.RootElement);
                    break;
                case "settings:set-startup":
                    if (!message.RootElement.TryGetProperty("enabled", out var enabledProperty)
                        || enabledProperty.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    {
                        throw new InvalidOperationException("开机启动设置无效。");
                    }
                    var enabled = enabledProperty.GetBoolean();
                    DesktopSettings.SetStartWithWindows(enabled);
                    SendDesktopSettings(enabled ? "已开启跟随系统启动。" : "已关闭跟随系统启动。");
                    break;
                case "settings:open-recordings":
                    DesktopSettings.OpenRecordingsDirectory();
                    SendDesktopSettings("已打开录音文件夹。");
                    break;
                case "settings:check-update":
                    await CheckForUpdatesAsync(true);
                    SendDesktopSettings("更新检查已完成。");
                    break;
            }
        }
        catch (Exception error)
        {
            SendDesktopError(error.Message);
        }
    }

    private static bool IsTrustedMessageSource(string source)
    {
        return Uri.TryCreate(source, UriKind.Absolute, out var uri)
            && string.Equals(
                uri.GetLeftPart(UriPartial.Authority),
                ServiceManager.Origin,
                StringComparison.OrdinalIgnoreCase
            );
    }

    private void SendDesktopSettings(string? message = null)
    {
        if (WorkspaceView.CoreWebView2 is null) return;
        var payload = new
        {
            type = "settings:state",
            isDesktopClient = true,
            hotkey = globalHotkey?.DisplayText ?? DesktopSettings.GetHotkey(),
            hotkeyRegistered = globalHotkey?.IsRegistered ?? false,
            startWithWindows = DesktopSettings.IsStartWithWindowsEnabled(),
            recordingsPath = DesktopSettings.EnsureRecordingsDirectory(),
            message,
            messageKind = string.IsNullOrWhiteSpace(message) ? null : "success"
        };
        WorkspaceView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
    }

    private void SendDesktopError(string message)
    {
        if (WorkspaceView.CoreWebView2 is null) return;
        WorkspaceView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(new
        {
            type = "settings:error",
            message
        }));
    }
    private void UpdateRecordingHotkey(JsonElement message)
    {
        if (!message.TryGetProperty("hotkey", out var hotkeyProperty)
            || hotkeyProperty.ValueKind != JsonValueKind.String)
        {
            throw new InvalidOperationException("快捷键设置无效。");
        }
        if (globalHotkey is null)
        {
            throw new InvalidOperationException("快捷键服务尚未就绪，请稍后重试。");
        }

        var previous = globalHotkey.DisplayText;
        var requested = hotkeyProperty.GetString() ?? string.Empty;
        if (!globalHotkey.TryUpdate(requested, out var error))
        {
            UpdateHotkeyPresentation();
            throw new InvalidOperationException(error);
        }
        try
        {
            DesktopSettings.SetHotkey(globalHotkey.DisplayText);
        }
        catch
        {
            globalHotkey.TryUpdate(previous, out _);
            UpdateHotkeyPresentation();
            throw;
        }
        UpdateHotkeyPresentation();
        SendDesktopSettings($"快捷键已设置为 {globalHotkey.DisplayText}。");
    }
    private async Task ToggleRecordingAsync()
    {
        if (requestActive) return;
        requestActive = true;
        toggleMenuItem.Enabled = false;
        try
        {
            await ServiceManager.EnsureRunningAsync();
            var result = await RecorderApi.ToggleAsync();
            if (result.Action == "started")
            {
                SetRecordingVisual(true);
                Notify(
                    "录音已开始",
                    "正在使用：" + (result.DeviceName ?? "默认麦克风"),
                    System.Windows.Forms.ToolTipIcon.Info
                );
            }
            else
            {
                SetRecordingVisual(false);
                Notify("录音已保存", "音频已经进入录音资料库。", System.Windows.Forms.ToolTipIcon.Info);
            }
        }
        catch (Exception error)
        {
            Notify("快捷录音未执行", error.Message, System.Windows.Forms.ToolTipIcon.Error);
        }
        finally
        {
            toggleMenuItem.Enabled = true;
            requestActive = false;
            await RefreshRecordingVisualAsync();
        }
    }

    private void UpdateHotkeyPresentation()
    {
        var hotkey = globalHotkey?.DisplayText ?? DesktopSettings.GetHotkey();
        toggleMenuItem.Text = $"开始 / 停止录音    {hotkey}";
        if (!recordingVisualActive) trayIcon.Text = $"AISteph Voice（{hotkey}）";
    }

    private async Task RefreshRecordingVisualAsync()
    {
        if (recordingStateRefreshActive) return;
        recordingStateRefreshActive = true;
        try
        {
            var state = await RecorderApi.GetStateAsync();
            SetRecordingVisual(state is "starting" or "recording" or "stopping");
        }
        catch
        {
            // The service may be restarting; retain the last known icon state.
        }
        finally
        {
            recordingStateRefreshActive = false;
        }
    }

    private void SetRecordingVisual(bool recording)
    {
        if (recordingVisualActive == recording) return;
        recordingVisualActive = recording;
        Icon = recording ? recordingWindowIcon : idleWindowIcon;
        trayIcon.Icon = recording ? recordingTrayIcon : idleTrayIcon;
        trayIcon.Text = recording
            ? "AISteph Voice 正在录音"
            : $"AISteph Voice（{globalHotkey?.DisplayText ?? DesktopSettings.GetHotkey()}）";
    }

    private static System.Drawing.Icon LoadTrayIcon(string resourcePath)
    {
        var resource = System.Windows.Application.GetResourceStream(new Uri(resourcePath, UriKind.Relative))
            ?? throw new FileNotFoundException("客户端图标资源不存在。", resourcePath);
        using var stream = resource.Stream;
        using var icon = new System.Drawing.Icon(stream);
        return (System.Drawing.Icon)icon.Clone();
    }

    private static BitmapImage LoadWindowIcon(string resourcePath)
    {
        var image = new BitmapImage();
        image.BeginInit();
        image.UriSource = new Uri($"pack://application:,,,/{resourcePath}", UriKind.Absolute);
        image.CacheOption = BitmapCacheOption.OnLoad;
        image.EndInit();
        image.Freeze();
        return image;
    }

    private async Task CheckForUpdatesAsync(bool manual)
    {
        try
        {
            var update = await UpdateService.CheckAsync();
            if (update.HasUpdate)
            {
                var answer = System.Windows.MessageBox.Show(
                    $"发现 AISteph Voice v{update.LatestVersion!.ToString(3)}。\n\n是否打开安全下载页面？",
                    "AISteph Voice 在线更新",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Information
                );
                if (answer == MessageBoxResult.Yes) UpdateService.OpenRelease(update);
            }
            else if (manual)
            {
                System.Windows.MessageBox.Show(
                    $"当前 v{update.CurrentVersion.ToString(3)} 已是最新稳定版本。",
                    "AISteph Voice 在线更新",
                    MessageBoxButton.OK,
                    MessageBoxImage.Information
                );
            }
        }
        catch (Exception error)
        {
            if (manual)
            {
                System.Windows.MessageBox.Show(
                    "暂时无法检查更新。\n" + error.Message,
                    "AISteph Voice 在线更新",
                    MessageBoxButton.OK,
                    MessageBoxImage.Warning
                );
            }
        }
    }

    private async Task RequestExitAsync()
    {
        if (requestActive) return;
        try
        {
            var state = await RecorderApi.GetStateAsync();
            if (state == "recording")
            {
                var answer = System.Windows.MessageBox.Show(
                    "当前正在录音。是否先停止并保存，然后退出 AISteph Voice？",
                    "正在录音",
                    MessageBoxButton.YesNo,
                    MessageBoxImage.Warning
                );
                if (answer != MessageBoxResult.Yes) return;
                await ToggleRecordingAsync();
            }
            else if (state is "starting" or "stopping")
            {
                System.Windows.MessageBox.Show("录音状态正在切换，请稍后再退出。", "AISteph Voice");
                return;
            }
        }
        catch (Exception error)
        {
            var answer = System.Windows.MessageBox.Show(
                "无法确认录音状态。仍要退出吗？\n" + error.Message,
                "AISteph Voice",
                MessageBoxButton.YesNo,
                MessageBoxImage.Warning
            );
            if (answer != MessageBoxResult.Yes) return;
        }

        exitRequested = true;
        updateTimer.Stop();
        globalHotkey?.Dispose();
        trayIcon.Visible = false;
        trayIcon.Dispose();
        idleTrayIcon.Dispose();
        recordingTrayIcon.Dispose();
        await ServiceManager.StopOwnedServiceAsync();
        System.Windows.Application.Current.Shutdown();
    }

    private void HandleClosing(object? sender, CancelEventArgs eventArgs)
    {
        if (exitRequested) return;
        eventArgs.Cancel = true;
        Hide();
        if (!hideNoticeShown)
        {
            hideNoticeShown = true;
            Notify(
                "AISteph Voice 仍在运行",
                $"窗口已隐藏到系统托盘，{globalHotkey?.DisplayText ?? DesktopSettings.GetHotkey()} 仍可录音。",
                System.Windows.Forms.ToolTipIcon.Info
            );
        }
    }

    private void HandleStateChanged(object? sender, EventArgs eventArgs)
    {
        if (WindowState == WindowState.Minimized) Hide();
    }

    private void Notify(string title, string message, System.Windows.Forms.ToolTipIcon icon)
    {
        trayIcon.BalloonTipTitle = title;
        trayIcon.BalloonTipText = message;
        trayIcon.BalloonTipIcon = icon;
        trayIcon.ShowBalloonTip(3500);
    }
}