using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace AIStephVoice;

internal sealed class GlobalHotkey : IDisposable
{
    private const int HotkeyId = 0x4156;
    private const int WmHotkey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint ModNoRepeat = 0x4000;
    private const uint VirtualKeyR = 0x52;
    private readonly HwndSource source;
    private bool registered;

    public event EventHandler? Pressed;

    public GlobalHotkey(nint windowHandle)
    {
        source = HwndSource.FromHwnd(windowHandle)
            ?? throw new InvalidOperationException("无法获取客户端窗口句柄。");
        source.AddHook(WindowProcedure);
        registered = RegisterHotKey(
            windowHandle,
            HotkeyId,
            ModControl | ModAlt | ModNoRepeat,
            VirtualKeyR
        );
    }

    public bool IsRegistered => registered;

    private nint WindowProcedure(nint windowHandle, int message, nint wParam, nint lParam, ref bool handled)
    {
        if (message == WmHotkey && wParam.ToInt32() == HotkeyId)
        {
            handled = true;
            Pressed?.Invoke(this, EventArgs.Empty);
        }
        return nint.Zero;
    }

    public void Dispose()
    {
        source.RemoveHook(WindowProcedure);
        if (registered)
        {
            UnregisterHotKey(source.Handle, HotkeyId);
            registered = false;
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool RegisterHotKey(nint windowHandle, int id, uint modifiers, uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnregisterHotKey(nint windowHandle, int id);
}