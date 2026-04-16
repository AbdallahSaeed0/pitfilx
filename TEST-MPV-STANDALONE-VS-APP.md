# MPV Standalone vs App - Critical Finding

## Test Result

✅ **Standalone mpv is smooth and lightweight**
❌ **App-launched mpv lags the entire system**

This proves the issue is in our Rust implementation, NOT the mpv config or video files.

## What's Different?

### Standalone Command (Smooth)
```powershell
.\mpv.exe --config-dir="mpv-config" "video.mkv"
```

### App Command (Laggy)
The app adds these extra arguments:
```
--no-terminal
--config-dir=<path>
--keep-open=no
--hwdec=auto-safe
--keepaspect=yes
--background=color
--background-color=#000000
--volume-max=200
--input-ipc-server=pitflix-mpv-<uuid>  # ← SUSPECT #1
--priority=belownormal
--start=<seconds>
<video-path>
```

## Prime Suspects

### 1. IPC Named Pipe (Most Likely)
The `--input-ipc-server` creates a Windows named pipe for communication.

**Why this might cause lag:**
- Named pipe I/O can be blocking
- mpv sends property-change events constantly
- Our app reads from the pipe in a background thread
- Windows named pipes can have high overhead

**Test:** Launch without IPC
```powershell
$env:PITFLIX_NO_IPC="1"
npm run tauri dev
```

### 2. stdout/stderr Piping
We capture mpv's output:
```rust
cmd.stdin(Stdio::null())
   .stdout(Stdio::piped())
   .stderr(Stdio::piped())
```

**Why this might cause lag:**
- If mpv writes a lot to stdout/stderr, the pipe buffer can fill
- Blocked writes can cause the process to stall
- We read these in background threads

**Test:** Use `Stdio::null()` for stdout/stderr

### 3. Background IPC Reader Thread
We spawn a thread that constantly reads from the IPC pipe:
```rust
thread::spawn(move || {
  read_ipc_loop(...)  // Blocking read loop
})
```

**Why this might cause lag:**
- Thread synchronization overhead
- Lock contention on shared state
- Frequent IPC messages causing context switches

### 4. Process Priority
We set `BELOW_NORMAL_PRIORITY_CLASS` via Win32 API.

**Why this might cause lag:**
- If the priority is TOO low, mpv might not get enough CPU
- Could cause stuttering/lag as Windows deprioritizes it

**Test:** Remove the `SetPriorityClass` call

## Recommended Tests (In Order)

### Test 1: Disable IPC
```powershell
$env:PITFLIX_NO_IPC="1"
npm run tauri dev
# Open episode - check if lag is gone
```

**If smooth:** IPC is the bottleneck
**If still lags:** Continue to Test 2

### Test 2: Don't Pipe stdout/stderr
Modify `spawn_mpv_embedded`:
```rust
cmd.stdin(Stdio::null())
   .stdout(Stdio::null())  // Changed
   .stderr(Stdio::null())  // Changed
```

**If smooth:** Output piping is the issue
**If still lags:** Continue to Test 3

### Test 3: Remove Priority Lowering
Comment out the `SetPriorityClass` block:
```rust
// unsafe {
//   let _ = SetPriorityClass(handle, BELOW_NORMAL_PRIORITY_CLASS);
// }
```

**If smooth:** Priority was TOO low
**If still lags:** Continue to Test 4

### Test 4: Minimal Arguments
Launch with ONLY the essential args:
```
--config-dir=<path>
<video-path>
```

Remove all other arguments to match standalone as closely as possible.

## My Prediction

**IPC is the culprit.** Here's why:

1. Standalone mpv (no IPC) = smooth
2. Our mpv (with IPC) = laggy
3. App metrics show IPC events are frequent (3-6/sec)
4. Named pipes on Windows can have high overhead
5. The IPC reader thread might be causing lock contention

## Next Steps

1. Test with `PITFLIX_NO_IPC=1`
2. If that fixes it, we need to either:
   - Optimize IPC communication (less frequent property queries)
   - Use a different IPC method (shared memory, TCP socket)
   - Reduce the number of properties we observe
   - Batch IPC messages more aggressively

## Code Changes Made

Added diagnostic flag in `windows_host.rs`:
```rust
let disable_ipc = std::env::var("PITFLIX_NO_IPC").is_ok();
if disable_ipc {
  eprintln!("[mpv-diagnostic] IPC DISABLED");
  // Skip --input-ipc-server argument
}
```

This allows testing without IPC while keeping all other arguments the same.
