#if WINDOWS
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace PitflixPlayer;

/// <summary>
/// Windows taskbar thumbnail-toolbar buttons (Previous, Play/Pause, Next)
/// shown when hovering the PitflixPlayer taskbar icon.
/// </summary>
internal sealed class TaskbarThumbButtons : IDisposable
{
    private const uint IdPrevious  = 1;
    private const uint IdPlayPause = 2;
    private const uint IdNext      = 3;

    private readonly Window _window;
    private IntPtr _hwnd;
    private HwndSource? _hwndSource;
    private readonly Icon _prevIcon;
    private readonly Icon _playIcon;
    private readonly Icon _pauseIcon;
    private readonly Icon _nextIcon;
    private bool _isPlaying;
    private bool _hasPrevious;
    private bool _hasNext;
    private bool _initialized;
    private bool _disposed;

    public Action? OnPrevious  { get; set; }
    public Action? OnPlayPause { get; set; }
    public Action? OnNext      { get; set; }

    internal static bool IsSupported => OperatingSystem.IsWindows();

    public TaskbarThumbButtons(Window window)
    {
        _window = window;

        _prevIcon  = CreateVectorIcon(ThumbButtonIcon.Previous);
        _playIcon  = CreateVectorIcon(ThumbButtonIcon.Play);
        _pauseIcon = CreateVectorIcon(ThumbButtonIcon.Pause);
        _nextIcon  = CreateVectorIcon(ThumbButtonIcon.Next);

        // ThumbBarAddButtons requires the window to be visible — register after
        // the first render, not at Loaded (which can fire before Show()).
        if (_window.IsVisible)
            Register();
        else
            _window.ContentRendered += OnContentRendered;
    }

    private void OnContentRendered(object? sender, EventArgs e)
    {
        _window.ContentRendered -= OnContentRendered;
        Register();
    }

    private void Register()
    {
        if (_initialized || _disposed) return;

        _hwnd = new WindowInteropHelper(_window).Handle;
        if (_hwnd == IntPtr.Zero)
        {
            App.Log("TaskbarThumbButtons: HWND is zero — skipping toolbar");
            return;
        }

        _hwndSource = HwndSource.FromHwnd(_hwnd);
        _hwndSource?.AddHook(WndProc);

        bool isPlaying = _isPlaying;
        var buttons = new[]
        {
            MakeButton(IdPrevious,  _prevIcon,  "Previous", _hasPrevious),
            MakeButton(IdPlayPause, isPlaying ? _pauseIcon : _playIcon,
                       isPlaying ? "Pause" : "Play", true),
            MakeButton(IdNext,      _nextIcon,  "Next",     _hasNext),
        };

        if (TaskbarInterop.AddButtons(_hwnd, buttons))
        {
            _initialized = true;
            App.Log($"TaskbarThumbButtons: toolbar registered on HWND 0x{_hwnd:X}");
        }
    }

    public void UpdatePlaybackState(bool isPlaying, bool hasPrevious, bool hasNext)
    {
        _isPlaying    = isPlaying;
        _hasPrevious  = hasPrevious;
        _hasNext      = hasNext;

        if (!_initialized)
        {
            if (_window.IsVisible) Register();
            return;
        }
        if (_disposed) return;

        var buttons = new[]
        {
            MakeButton(IdPrevious,  _prevIcon,  "Previous", hasPrevious),
            MakeButton(IdPlayPause,  isPlaying ? _pauseIcon : _playIcon,
                       isPlaying ? "Pause" : "Play", true),
            MakeButton(IdNext,      _nextIcon,  "Next",     hasNext),
        };
        TaskbarInterop.UpdateButtons(_hwnd, buttons);
    }

    private static TaskbarInterop.ThumbButton MakeButton(
        uint id, Icon icon, string tip, bool enabled)
    {
        return new TaskbarInterop.ThumbButton
        {
            dwMask  = TaskbarInterop.ThbIcon | TaskbarInterop.ThbTooltip | TaskbarInterop.ThbFlags,
            iId     = id,
            hIcon   = icon.Handle,
            szTip   = tip,
            dwFlags = enabled ? TaskbarInterop.ThbfEnabled : TaskbarInterop.ThbfDisabled,
        };
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != TaskbarInterop.WM_COMMAND) return IntPtr.Zero;

        int cmd = wParam.ToInt32();
        if (((cmd >> 16) & 0xFFFF) != TaskbarInterop.THBN_CLICKED) return IntPtr.Zero;

        switch ((uint)(cmd & 0xFFFF))
        {
            case IdPrevious:  OnPrevious?.Invoke();  break;
            case IdPlayPause: OnPlayPause?.Invoke(); break;
            case IdNext:      OnNext?.Invoke();      break;
        }
        return IntPtr.Zero;
    }

    private enum ThumbButtonIcon { Previous, Play, Pause, Next }

    private static Icon CreateVectorIcon(ThumbButtonIcon kind)
    {
        const int size = 20;
        using var bmp = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(Color.White);

            switch (kind)
            {
                case ThumbButtonIcon.Previous:
                    g.FillPolygon(brush, new[]
                    {
                        new PointF(11, 4), new PointF(11, 16), new PointF(5, 10)
                    });
                    g.FillRectangle(brush, 4, 4, 2.5f, 12);
                    break;

                case ThumbButtonIcon.Play:
                    g.FillPolygon(brush, new[]
                    {
                        new PointF(6, 4), new PointF(6, 16), new PointF(16, 10)
                    });
                    break;

                case ThumbButtonIcon.Pause:
                    g.FillRectangle(brush, 5, 4, 3.5f, 12);
                    g.FillRectangle(brush, 11.5f, 4, 3.5f, 12);
                    break;

                case ThumbButtonIcon.Next:
                    g.FillRectangle(brush, 13.5f, 4, 2.5f, 12);
                    g.FillPolygon(brush, new[]
                    {
                        new PointF(9, 4), new PointF(9, 16), new PointF(15, 10)
                    });
                    break;
            }
        }

        IntPtr hIcon = bmp.GetHicon();
        try
        {
            using var temp = Icon.FromHandle(hIcon);
            return (Icon)temp.Clone();
        }
        finally
        {
            DestroyIcon(hIcon);
        }
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool DestroyIcon(IntPtr handle);

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _window.ContentRendered -= OnContentRendered;
        if (_hwndSource is not null)
            _hwndSource.RemoveHook(WndProc);

        _prevIcon.Dispose();
        _playIcon.Dispose();
        _pauseIcon.Dispose();
        _nextIcon.Dispose();
    }
}
#endif
