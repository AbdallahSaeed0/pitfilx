using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace PitflixPlayer;

/// <summary>
/// Connects to mpv's named-pipe IPC server and sends JSON commands.
///
/// mpv IPC wire format (one line per command):
///   {"command":["set_property","pause",true]}\n
///   {"command":["seek",45.2,"absolute"]}\n
///   {"command":["playlist-next"]}\n
///
/// Reads from the pipe are ignored — the backend WebSocket loop already
/// polls mpv's state and pushes it to us.  All sends are fire-and-forget
/// from the caller's perspective; we log errors but never throw post-connect.
/// </summary>
internal sealed class MpvIpcClient : IDisposable
{
    private readonly string              _pipeName;
    private          NamedPipeClientStream? _pipe;
    private readonly SemaphoreSlim       _lock     = new(1, 1);
    private          bool                _disposed = false;

    /// <param name="pipeName">The bare pipe name, e.g. "pitflix-player-abc123".
    /// The class prepends "\\.\pipe\" automatically.</param>
    public MpvIpcClient(string pipeName) => _pipeName = pipeName;

    // ── Connection ────────────────────────────────────────────────────────────

    /// <summary>
    /// Connects to \\.\pipe\{pipeName} within <paramref name="timeoutMs"/>.
    /// Throws <see cref="TimeoutException"/> or <see cref="IOException"/> on failure.
    /// </summary>
    public async Task ConnectAsync(int timeoutMs = 5000)
    {
        var pipe = new NamedPipeClientStream(
            serverName:    ".",
            pipeName:      _pipeName,
            direction:     PipeDirection.InOut,
            options:       PipeOptions.Asynchronous);

        await pipe.ConnectAsync(timeoutMs).ConfigureAwait(false);

        _pipe = pipe;
        App.Log($"MpvIpcClient connected to \\\\.\\pipe\\{_pipeName}");

        // CRITICAL: continuously drain mpv's outgoing stream (command replies +
        // the events it broadcasts on every seek / file change / etc.).  We
        // don't use the data — the backend's own IPC connection polls state and
        // pushes it over WebSocket — but if we never READ, mpv's per-client
        // write buffer fills after a handful of messages, mpv's writer thread
        // for THIS client blocks, and it then stops reading our commands.  That
        // was the "after a few playlist switches / seeks everything stops
        // responding" bug: pause/seek/playlist commands were written to the
        // pipe but mpv had wedged on the full unread buffer and never processed
        // them.  Draining keeps mpv's writer flowing so our commands are always
        // serviced.
        _ = Task.Run(DrainLoopAsync);
    }

    /// <summary>Reads and discards everything mpv sends so its per-client write
    /// buffer never fills (which would otherwise stall command processing for
    /// this connection).  Runs until the pipe closes / the client is disposed.</summary>
    private async Task DrainLoopAsync()
    {
        var buf = new byte[16 * 1024];
        try
        {
            var pipe = _pipe;
            while (!_disposed && pipe is not null && pipe.IsConnected)
            {
                int n = await pipe.ReadAsync(buf, 0, buf.Length).ConfigureAwait(false);
                if (n <= 0) break;   // pipe closed by mpv
                // content intentionally discarded
            }
        }
        catch { /* pipe closed / disposed — normal on teardown */ }
    }

    // ── Send ──────────────────────────────────────────────────────────────────

    /// <summary>
    /// Serialises <paramref name="command"/> to
    /// <c>{"command":[arg0,arg1,...]}\n</c> and writes it to the pipe.
    ///
    /// A <see cref="SemaphoreSlim"/>(1,1) ensures concurrent callers never
    /// interleave their bytes.  Errors are swallowed (command failures are
    /// non-fatal — the next WS push will reconcile state).
    /// </summary>
    public async Task SendAsync(params object?[] command)
    {
        bool isPlaylist = command.Length > 0 && command[0] is string c0 &&
                          c0.StartsWith("playlist", StringComparison.Ordinal);

        if (_disposed || _pipe is null || !_pipe.IsConnected)
        {
            if (isPlaylist)
                App.Log($"MpvIpcClient: DROPPED '{command[0]}' — pipe not connected (disposed={_disposed}, pipe={_pipe != null}, connected={_pipe?.IsConnected})");
            return;
        }

        // mpv expects {"command":[...]} with a trailing newline
        var json  = JsonSerializer.Serialize(new { command }) + "\n";
        var bytes = Encoding.UTF8.GetBytes(json);

        // Guard the whole acquire/write/release against disposal racing in
        // between.  Dispose() can run concurrently (e.g. the thumb server is
        // torn down while a seek/screenshot send is in flight), disposing the
        // pipe AND — previously — the semaphore.  A Release() on a disposed
        // SemaphoreSlim throws ObjectDisposedException, which on a
        // fire-and-forget Task became an UNOBSERVED exception → the finalizer
        // rethrew it as the crash dialog the user saw.  Swallow disposal races
        // entirely; a dropped command is harmless (the next WS push reconciles).
        bool acquired = false;
        try
        {
            try { await _lock.WaitAsync().ConfigureAwait(false); acquired = true; }
            catch (ObjectDisposedException) { return; }

            if (!_disposed && _pipe is not null && _pipe.IsConnected)
            {
                await _pipe.WriteAsync(bytes).ConfigureAwait(false);
                await _pipe.FlushAsync().ConfigureAwait(false);
                if (isPlaylist) App.Log($"MpvIpcClient: wrote {json.TrimEnd()}");
            }
            else if (isPlaylist)
            {
                App.Log($"MpvIpcClient: DROPPED '{command[0]}' inside lock — connection lost");
            }
        }
        catch (ObjectDisposedException) { /* disposed mid-send — ignore */ }
        catch (Exception ex)
        {
            App.Log($"MpvIpcClient.SendAsync error: {ex.Message}");
        }
        finally
        {
            if (acquired)
            {
                try { _lock.Release(); } catch (ObjectDisposedException) { }
            }
        }
    }

    // ── Dispose ───────────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { _pipe?.Close(); } catch { }
        try { _pipe?.Dispose(); } catch { }
        // NOTE: deliberately do NOT dispose _lock.  In-flight SendAsync calls
        // may still be inside WaitAsync/Release; disposing the semaphore under
        // them throws ObjectDisposedException (the crash above).  SemaphoreSlim
        // only holds an unmanaged handle if AvailableWaitHandle was accessed
        // (we never do), so leaving it for the GC leaks nothing.
        App.Log("MpvIpcClient disposed");
    }
}
