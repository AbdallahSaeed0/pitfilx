# Scan Pipeline Fix - Intermittent Scan Failures

## Problem
Library scanning (both auto-scan and manual scan) sometimes fails to start or execute, leaving the system in a state where no scans can run.

## Root Causes Identified

### 1. **Scan State Not Properly Cleaned Up**
- If a scan fails or encounters an exception, the `IsRunning` flag might not be properly reset
- This blocks all future scans (both manual and auto) indefinitely
- The cleanup code was in a `finally` block but could still fail in edge cases

### 2. **No Timeout or Hung Scan Detection**
- Long-running or stuck scans could block the pipeline forever
- No mechanism to detect or recover from hung scans
- API calls to TMDB or file system operations could hang indefinitely

### 3. **Race Conditions**
- Multiple scan triggers (manual + auto scans) could conflict
- The `IsRunning` check and `BeginJob()` were not atomic
- No locking mechanism to prevent concurrent scan starts

### 4. **Silent Failures in Background Services**
- Auto-scan exceptions were caught but not logged
- No visibility into why auto-scans were failing
- Made debugging intermittent issues nearly impossible

### 5. **SSE EventSource Connection Issues**
- EventSource could disconnect without proper reconnection
- No retry logic for dropped connections
- UI would lose scan progress updates

## Changes Made

### 1. Improved ScanRuntime State Management
**File:** `Pitflix.API/Services/ScanRuntime.cs`

**Changes:**
- Added `SemaphoreSlim` for thread-safe scan start/stop operations
- Added `_scanStartedAt` timestamp to track scan duration
- Changed `BeginJob()` to async `BeginJobAsync()` with atomic lock checking
- Changed `EndJob()` to async `EndJobAsync()` with proper locking
- Added `ScanRunningDuration` property to track how long a scan has been running
- Added `ForceResetAsync()` method to force cleanup of hung scans

**Benefits:**
- Thread-safe scan start/stop prevents race conditions
- Can detect scans that have been running too long
- Can force reset stuck scans without restarting the API

### 2. Hung Scan Detection and Auto-Recovery
**File:** `Pitflix.API/Program.cs` - `/api/scan/start` endpoint

**Changes:**
- Before starting a new scan, check if current scan has been running > 6 hours
- If so, force reset the scan state and broadcast cancellation
- Use async `BeginJobAsync()` for atomic lock checking
- Properly cleanup with `EndJobAsync()` in finally block

**Benefits:**
- Scans stuck for > 6 hours are automatically reset
- New scans can start after hung scan detection
- Prevents permanent scan pipeline blockage

### 3. Better Error Logging in Auto-Scan Services
**Files:**
- `Pitflix.API/Services/LibraryAutoScanService.cs`
- `Pitflix.API/Services/PinnedFolderScanService.cs`

**Changes:**
- Replaced silent `catch` blocks with proper error logging
- Log exception details when auto-scans fail
- Makes intermittent issues visible in logs

**Benefits:**
- Can diagnose why auto-scans are failing
- Error messages in API logs
- Better troubleshooting information

### 4. SSE Reconnection with Exponential Backoff
**File:** `Pitflix.UI/src/hooks/useScanProgress.ts`

**Changes:**
- Added automatic reconnection logic for EventSource
- Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (max)
- Maximum 10 reconnection attempts
- Proper cleanup of old connections before reconnecting

**Benefits:**
- UI automatically reconnects if SSE connection drops
- Scan progress updates recover from network hiccups
- Better resilience to temporary connection issues

### 5. New Diagnostic Endpoints
**File:** `Pitflix.API/Program.cs`

**New Endpoints:**

#### `GET /api/scan/diagnostic`
Returns detailed scan state information:
```json
{
  "isRunning": true,
  "jobId": "abc123",
  "runningDuration": "01:23:45",
  "runningSeconds": 5025,
  "total": 1000,
  "current": 456,
  "matched": 400,
  "unmatched": 56,
  "skipped": 200,
  "percent": 45.6,
  "isPotentiallyHung": false
}
```

#### `POST /api/scan/force-reset`
Manually force reset the scan state (emergency recovery):
- Cancels any running scan
- Clears the scan state
- Broadcasts cancellation to UI
- Returns: `{ "message": "Scan state has been reset" }`

**Benefits:**
- Can diagnose scan state issues
- Can manually recover from hung scans
- Provides troubleshooting information

## How to Use the Fixes

### Normal Operation
The fixes work automatically - no changes needed to your scanning workflow.

### If Scans Get Stuck

#### Option 1: Wait for Auto-Recovery (Recommended)
If a scan has been running for over 6 hours, the next scan attempt will automatically:
1. Detect the hung scan
2. Force reset the state
3. Start the new scan

#### Option 2: Check Diagnostic Information
```bash
# Check scan state
curl http://localhost:5001/api/scan/diagnostic
```

Look for:
- `isPotentiallyHung: true` - Scan has been running for over 3 hours
- `runningSeconds` - How long the current scan has been running
- `current` / `total` - Progress (if stuck at same number, likely hung)

#### Option 3: Manual Force Reset
```bash
# Force reset scan state
curl -X POST http://localhost:5001/api/scan/force-reset
```

Use this if:
- Scan is clearly stuck (no progress for hours)
- Cannot start new scans
- Auto-recovery hasn't kicked in yet

#### Option 4: Restart the API
As a last resort, restart `Pitflix.API.exe` to clear all state.

## Troubleshooting Guide

### Symptom: "Scan already running" error, but no scan is actually running

**Cause:** Scan state wasn't properly cleaned up from a previous failed scan.

**Solutions:**
1. Check diagnostic endpoint to see scan state
2. If `runningDuration` > 6 hours, try starting a scan again (will auto-reset)
3. Use force-reset endpoint: `POST /api/scan/force-reset`
4. Restart API server

### Symptom: Auto-scans not running at all

**Cause:** Either TMDB API key is missing, or auto-scan is encountering errors.

**Solutions:**
1. Check API logs for error messages from auto-scan services
2. Verify TMDB API key is configured
3. Check library folder paths exist and are accessible
4. Look for error logs: `LibraryAutoScanService` or `PinnedFolderScanService`

### Symptom: Manual scan starts but UI shows no progress

**Cause:** SSE connection dropped and didn't reconnect.

**Solutions:**
1. The UI should auto-reconnect within 1-30 seconds
2. Refresh the page to force reconnection
3. Check browser console (F12) for errors
4. Check if API is running: `GET /api/scan/progress`

### Symptom: Scan stuck at same percentage for hours

**Cause:** Scan might be hung on a specific file or TMDB API call.

**Solutions:**
1. Check diagnostic endpoint - if `isPotentiallyHung: true`, it will auto-reset on next scan attempt
2. Wait for 6-hour timeout (scan will auto-reset)
3. Manually force reset: `POST /api/scan/force-reset`
4. Check API logs for errors on specific files
5. Check TMDB API connectivity

## Configuration

### Hung Scan Timeout
Default: 6 hours

To change, edit `Program.cs` line where it checks:
```csharp
if (scan.IsRunning && scan.ScanRunningDuration > TimeSpan.FromHours(6))
```

Change `6` to your preferred number of hours.

### SSE Reconnection Settings
Default:
- Max attempts: 10
- Backoff: exponential (1s, 2s, 4s, 8s, 16s, 30s max)

To change, edit `useScanProgress.ts`:
```typescript
const MAX_RECONNECT_ATTEMPTS = 10;
const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 30000);
```

## Testing the Fixes

### Test 1: Normal Scan
```bash
# Start a scan
curl -X POST http://localhost:5001/api/scan/start -H "Content-Type: application/json" -d "{\"folders\": []}"

# Check progress
curl http://localhost:5001/api/scan/progress

# Should complete successfully
```

### Test 2: Concurrent Scan Prevention
```bash
# Start first scan
curl -X POST http://localhost:5001/api/scan/start -H "Content-Type: application/json" -d "{\"folders\": []}"

# Try to start second scan immediately
curl -X POST http://localhost:5001/api/scan/start -H "Content-Type: application/json" -d "{\"folders\": []}"

# Should get: {"error": "Scan already running."}
```

### Test 3: Force Reset
```bash
# Check diagnostic
curl http://localhost:5001/api/scan/diagnostic

# Force reset
curl -X POST http://localhost:5001/api/scan/force-reset

# Try starting scan again (should work)
curl -X POST http://localhost:5001/api/scan/start -H "Content-Type: application/json" -d "{\"folders\": []}"
```

### Test 4: SSE Reconnection
1. Start a scan
2. Open browser DevTools (F12) > Network tab
3. Find the `/api/scan/stream` connection
4. Simulate network issue (disconnect WiFi briefly)
5. Reconnect WiFi
6. Verify SSE reconnects automatically (check console)

## Monitoring

### Key Metrics to Monitor

1. **Scan Duration**
   - Check: `GET /api/scan/diagnostic` - `runningSeconds`
   - Alert if: > 3 hours for typical library size

2. **Scan State**
   - Check: `GET /api/scan/diagnostic` - `isPotentiallyHung`
   - Alert if: `true`

3. **Auto-Scan Failures**
   - Check API logs for: `LibraryAutoScanService` or `PinnedFolderScanService` errors
   - Alert on: repeated errors

4. **SSE Connection Health**
   - Check browser console for: reconnection attempts
   - Alert if: > 5 reconnection attempts in a short period

## No Breaking Changes

All changes are backward compatible:
- Existing scan API contracts unchanged
- No database schema changes
- No UI breaking changes
- All new endpoints are optional diagnostic tools

## Files Modified

1. ✅ `Pitflix.API/Services/ScanRuntime.cs` - Thread-safe state management
2. ✅ `Pitflix.API/Program.cs` - Hung scan detection, diagnostic endpoints
3. ✅ `Pitflix.API/Services/LibraryAutoScanService.cs` - Error logging
4. ✅ `Pitflix.API/Services/PinnedFolderScanService.cs` - Error logging
5. ✅ `Pitflix.UI/src/hooks/useScanProgress.ts` - SSE reconnection
6. ✅ `SCAN_PIPELINE_FIX.md` - This documentation (NEW)

## Summary

These fixes address the root causes of intermittent scan failures:
- ✅ Scan state is properly cleaned up with thread-safe locking
- ✅ Hung scans are automatically detected and reset after 6 hours
- ✅ Race conditions prevented with atomic lock checking
- ✅ Auto-scan failures are logged for diagnostics
- ✅ SSE connections automatically reconnect with backoff
- ✅ New diagnostic endpoints for troubleshooting
- ✅ Manual force-reset endpoint for emergency recovery

The scanning pipeline should now be much more robust and self-healing!
