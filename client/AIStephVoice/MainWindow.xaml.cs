using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;

namespace AIStephVoice;

public partial class MainWindow : Window
{
    private readonly System.Windows.Forms.NotifyIcon trayIcon;
    private readonly System.Windows.Forms.ToolStripMenuItem toggleMenuItem;
    private readonly DispatcherTimer updateTimer;
    private GlobalHotkey? globalHotkey;
    private bool requestActive;
    private bool exitRequested;
    private bool hideNoticeShown;

    public MainWindow()
    {
        InitializeComponent();
        toggleMenuItem = new System.Windows.Forms.ToolStripMenuItem("开始 / 停止录音    Ctrl+Alt+R");
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

        var applicationIcon = System.Drawing.Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? string.Empty)
            ?? SystemIcons.Application;
        trayIcon = new System.Windows.Forms.NotifyIcon
        {
            Icon = applicationIcon,
            Text = "AISteph Voice（Ctrl+Alt+R）",
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
        WorkspaceView.CoreWebView2.NavigationCompleted += HandleNavigationCompleted;
        WorkspaceView.Source = new Uri(ServiceManager.Origin + "/");
        Notify("AISteph Voice 已就绪", "按 Ctrl + Alt + R 即可开始或停止录音。", System.Windows.Forms.ToolTipIcon.Info);
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
        globalHotkey = new GlobalHotkey(new WindowInteropHelper(this).Handle);
        globalHotkey.Pressed += async (_, _) => await ToggleRecordingAsync();
        if (!globalHotkey.IsRegistered)
        {
            Notify(
                "快捷键注册失败",
                "Ctrl + Alt + R 已被其他程序占用，仍可通过托盘菜单录音。",
                System.Windows.Forms.ToolTipIcon.Warning
            );
        }
    }

    private void HandleNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs eventArgs)
    {
        if (eventArgs.IsSuccess)
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            return;
        }
        LoadingMessage.Text = "工作台加载失败，请稍后重试。";
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
                trayIcon.Text = "AISteph Voice 正在录音";
                Notify(
                    "录音已开始",
                    "正在使用：" + (result.DeviceName ?? "默认麦克风"),
                    System.Windows.Forms.ToolTipIcon.Info
                );
            }
            else
            {
                trayIcon.Text = "AISteph Voice（Ctrl+Alt+R）";
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
        }
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
                "窗口已隐藏到系统托盘，Ctrl + Alt + R 仍可录音。",
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