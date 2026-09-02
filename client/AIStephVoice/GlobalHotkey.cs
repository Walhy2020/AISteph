using System.Runtime.InteropServices;
using System.Windows.Interop;

namespace AIStephVoice;

internal sealed class GlobalHotkey : IDisposable
{
    private const int HotkeyId = 0x4156;
    private const int WmHotkey = 0x0312;
    private const uint ModAlt = 0x0001;
    private const uint ModControl = 0x0002;
    private const uint ModShift = 0x0004;
    private const uint ModNoRepeat = 0x4000;
    private readonly HwndSource source;
    private HotkeyGesture gesture;
    private bool registered;

    public const string DefaultDisplayText = "Ctrl + Alt + R";

    public event EventHandler? Pressed;

    public GlobalHotkey(nint windowHandle, string shortcut)
    {
        source = HwndSource.FromHwnd(windowHandle)
            ?? throw new InvalidOperationException("无法获取客户端窗口句柄。");
        if (!TryParse(shortcut, out gesture, out var error))
        {
            throw new ArgumentException(error, nameof(shortcut));
        }
        source.AddHook(WindowProcedure);
        registered = Register(gesture);
    }

    public bool IsRegistered => registered;

    public string DisplayText => gesture.DisplayText;

    public bool TryUpdate(string shortcut, out string error)
    {
        if (!TryParse(shortcut, out var next, out error)) return false;
        if (next == gesture && registered) return true;

        var previous = gesture;
        if (registered)
        {
            UnregisterHotKey(source.Handle, HotkeyId);
            registered = false;
        }

        if (Register(next))
        {
            gesture = next;
            registered = true;
            error = string.Empty;
            return true;
        }

        gesture = previous;
        registered = Register(previous);
        error = registered
            ? $"快捷键 {next.DisplayText} 已被其他程序占用，已恢复 {previous.DisplayText}。"
            : "新快捷键注册失败，原快捷键也未能恢复，请重新设置。";
        return false;
    }

    public static bool TryNormalize(string? shortcut, out string normalized)
    {
        if (TryParse(shortcut, out var parsed, out _))
        {
            normalized = parsed.DisplayText;
            return true;
        }
        normalized = DefaultDisplayText;
        return false;
    }

    private static bool TryParse(string? shortcut, out HotkeyGesture parsed, out string error)
    {
        parsed = default;
        error = string.Empty;
        var parts = String.IsNullOrWhiteSpace(shortcut)
            ? []
            : shortcut.Split('+', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        uint modifiers = 0;
        uint virtualKey = 0;
        string? keyLabel = null;

        foreach (var rawPart in parts)
        {
            var part = rawPart.ToUpperInvariant();
            switch (part)
            {
                case "CTRL":
                case "CONTROL":
                    modifiers |= ModControl;
                    continue;
                case "ALT":
                    modifiers |= ModAlt;
                    continue;
                case "SHIFT":
                    modifiers |= ModShift;
                    continue;
            }

            if (virtualKey != 0 || !TryParseKey(part, out virtualKey, out keyLabel))
            {
                error = "快捷键只支持字母、数字或 F1-F12。";
                return false;
            }
        }

        var modifierCount = 0;
        if ((modifiers & ModControl) != 0) modifierCount++;
        if ((modifiers & ModAlt) != 0) modifierCount++;
        if ((modifiers & ModShift) != 0) modifierCount++;
        if (modifierCount < 2 || virtualKey == 0 || keyLabel is null)
        {
            error = "快捷键需要至少两个修饰键，再加一个字母、数字或 F1-F12。";
            return false;
        }

        var labels = new List<string>(4);
        if ((modifiers & ModControl) != 0) labels.Add("Ctrl");
        if ((modifiers & ModAlt) != 0) labels.Add("Alt");
        if ((modifiers & ModShift) != 0) labels.Add("Shift");
        labels.Add(keyLabel);
        parsed = new HotkeyGesture(modifiers, virtualKey, string.Join(" + ", labels));
        return true;
    }

    private static bool TryParseKey(string part, out uint virtualKey, out string? keyLabel)
    {
        virtualKey = 0;
        keyLabel = null;
        if (part.Length == 1 && part[0] is >= 'A' and <= 'Z' or >= '0' and <= '9')
        {
            virtualKey = part[0];
            keyLabel = part;
            return true;
        }
        if (part.StartsWith('F')
            && int.TryParse(part.AsSpan(1), out var functionNumber)
            && functionNumber is >= 1 and <= 12)
        {
            virtualKey = (uint)(0x70 + functionNumber - 1);
            keyLabel = $"F{functionNumber}";
            return true;
        }
        return false;
    }

    private bool Register(HotkeyGesture hotkey)
    {
        return RegisterHotKey(
            source.Handle,
            HotkeyId,
            hotkey.Modifiers | ModNoRepeat,
            hotkey.VirtualKey
        );
    }

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

    private readonly record struct HotkeyGesture(uint Modifiers, uint VirtualKey, string DisplayText);
}