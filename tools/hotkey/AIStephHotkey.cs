using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace AIStephHotkey
{
    internal static class Program
    {
        private const string MutexName = "Local\\AIStephHotkey_v1";

        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, MutexName, out createdNew))
            {
                if (!createdNew) return;
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new TrayContext());
            }
        }
    }

    internal sealed class TrayContext : ApplicationContext
    {
        private readonly NotifyIcon trayIcon;
        private readonly HotkeyWindow hotkeyWindow;
        private readonly ToolStripMenuItem toggleItem;
        private bool requestActive;

        public TrayContext()
        {
            toggleItem = new ToolStripMenuItem("开始 / 停止录音    Ctrl+Alt+R");
            toggleItem.Click += async (sender, args) => await ToggleRecordingAsync();

            var openItem = new ToolStripMenuItem("打开录音工作台");
            openItem.Click += (sender, args) => OpenWorkspace();

            var exitItem = new ToolStripMenuItem("退出快捷键助手");
            exitItem.Click += (sender, args) => ExitThread();

            var menu = new ContextMenuStrip();
            menu.Items.Add(toggleItem);
            menu.Items.Add(openItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            trayIcon = new NotifyIcon
            {
                Icon = SystemIcons.Information,
                Text = "AISteph 快捷录音（Ctrl+Alt+R）",
                ContextMenuStrip = menu,
                Visible = true
            };
            trayIcon.DoubleClick += async (sender, args) => await ToggleRecordingAsync();

            hotkeyWindow = new HotkeyWindow();
            hotkeyWindow.Pressed += async (sender, args) => await ToggleRecordingAsync();
            if (hotkeyWindow.Register())
            {
                Notify("快捷录音已就绪", "按 Ctrl + Alt + R 即可开始或停止录音。", ToolTipIcon.Info);
            }
            else
            {
                Notify("快捷键注册失败", "Ctrl + Alt + R 已被其他程序占用，仍可通过托盘菜单录音。", ToolTipIcon.Warning);
            }
        }

        private async Task ToggleRecordingAsync()
        {
            if (requestActive) return;
            requestActive = true;
            toggleItem.Enabled = false;
            try
            {
                var result = await LocalApi.ToggleAsync();
                if (result.Action == "started")
                {
                    trayIcon.Text = "AISteph 正在录音（Ctrl+Alt+R 停止）";
                    Notify("录音已开始", "正在使用：" + (result.DeviceName ?? "默认麦克风"), ToolTipIcon.Info);
                }
                else
                {
                    trayIcon.Text = "AISteph 快捷录音（Ctrl+Alt+R）";
                    Notify("录音已保存", "音频已经进入录音资料库。", ToolTipIcon.Info);
                }
            }
            catch (Exception error)
            {
                Notify("快捷录音未执行", error.Message, ToolTipIcon.Error);
            }
            finally
            {
                toggleItem.Enabled = true;
                requestActive = false;
            }
        }

        private void Notify(string title, string message, ToolTipIcon icon)
        {
            trayIcon.BalloonTipTitle = title;
            trayIcon.BalloonTipText = message;
            trayIcon.BalloonTipIcon = icon;
            trayIcon.ShowBalloonTip(3500);
        }

        private static void OpenWorkspace()
        {
            try
            {
                Process.Start("http://127.0.0.1:39310/");
            }
            catch
            {
                // The recording shortcut remains usable when the browser cannot be opened.
            }
        }

        protected override void ExitThreadCore()
        {
            hotkeyWindow.Dispose();
            trayIcon.Visible = false;
            trayIcon.Dispose();
            base.ExitThreadCore();
        }
    }

    internal sealed class ToggleResult
    {
        public string Action { get; set; }
        public string DeviceName { get; set; }
    }

    internal static class LocalApi
    {
        private const string Origin = "http://127.0.0.1:39310";
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        public static async Task<ToggleResult> ToggleAsync()
        {
            var html = await RequestAsync("/", "GET", null);
            var match = Regex.Match(html, "name=\\\"aisteph-token\\\" content=\\\"([^\\\"]+)\\\"");
            if (!match.Success) throw new InvalidOperationException("无法读取本地服务令牌，请确认 AISteph 服务已经启动。");

            var payload = await RequestAsync("/api/recorder/toggle", "POST", match.Groups[1].Value);
            var data = Json.DeserializeObject(payload) as System.Collections.Generic.Dictionary<string, object>;
            if (data == null || !data.ContainsKey("action")) throw new InvalidOperationException("本地服务返回了无法识别的录音状态。");

            var action = Convert.ToString(data["action"]);
            string deviceName = null;
            object statusValue;
            if (data.TryGetValue("status", out statusValue))
            {
                var status = statusValue as System.Collections.Generic.Dictionary<string, object>;
                object deviceValue;
                if (status != null && status.TryGetValue("deviceName", out deviceValue))
                {
                    deviceName = Convert.ToString(deviceValue);
                }
            }
            return new ToggleResult { Action = action, DeviceName = deviceName };
        }

        private static async Task<string> RequestAsync(string path, string method, string token)
        {
            var request = (HttpWebRequest)WebRequest.Create(Origin + path);
            request.Method = method;
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;
            request.KeepAlive = false;
            request.Headers["Origin"] = Origin;
            if (!String.IsNullOrEmpty(token)) request.Headers["X-AISteph-Token"] = token;
            if (method == "POST") request.ContentLength = 0;

            HttpWebResponse response;
            try
            {
                response = (HttpWebResponse)await request.GetResponseAsync();
            }
            catch (WebException error)
            {
                response = error.Response as HttpWebResponse;
                if (response == null)
                {
                    throw new InvalidOperationException("AISteph 服务未启动，请先启动本地服务。");
                }
            }

            using (response)
            using (var reader = new StreamReader(response.GetResponseStream()))
            {
                var body = await reader.ReadToEndAsync();
                if ((int)response.StatusCode >= 400)
                {
                    try
                    {
                        var data = Json.DeserializeObject(body) as System.Collections.Generic.Dictionary<string, object>;
                        object message;
                        if (data != null && data.TryGetValue("error", out message))
                        {
                            throw new InvalidOperationException(Convert.ToString(message));
                        }
                    }
                    catch (InvalidOperationException)
                    {
                        throw;
                    }
                    catch
                    {
                        // Fall through to the generic HTTP error below.
                    }
                    throw new InvalidOperationException("本地录音请求失败（" + (int)response.StatusCode + "）。");
                }
                return body;
            }
        }
    }
    internal sealed class HotkeyWindow : NativeWindow, IDisposable
    {
        private const int HotkeyId = 0x4153;
        private const int WmHotkey = 0x0312;
        private const uint ModAlt = 0x0001;
        private const uint ModControl = 0x0002;
        private const uint ModNoRepeat = 0x4000;
        private const uint VirtualKeyR = 0x52;
        private bool registered;

        public event EventHandler Pressed;

        public HotkeyWindow()
        {
            CreateHandle(new CreateParams());
        }

        public bool Register()
        {
            registered = RegisterHotKey(Handle, HotkeyId, ModControl | ModAlt | ModNoRepeat, VirtualKeyR);
            return registered;
        }

        protected override void WndProc(ref Message message)
        {
            if (message.Msg == WmHotkey && message.WParam.ToInt32() == HotkeyId)
            {
                var handler = Pressed;
                if (handler != null) handler(this, EventArgs.Empty);
            }
            base.WndProc(ref message);
        }

        public void Dispose()
        {
            if (registered) UnregisterHotKey(Handle, HotkeyId);
            DestroyHandle();
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool RegisterHotKey(IntPtr windowHandle, int id, uint modifiers, uint virtualKey);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnregisterHotKey(IntPtr windowHandle, int id);
    }
}