# Pitflix Troubleshooting Guide

## Scan Not Working After Selecting Folder

If the scan doesn't start after selecting a folder, follow these steps:

### 1. Check if Pitflix API is Running

The most common issue is that the Pitflix.API backend is not running.

**How to check:**
- Open Task Manager (Ctrl + Shift + Esc)
- Look for `Pitflix.API.exe` or `pitflix-api-x86_64-pc-windows-msvc.exe` in the Processes tab
- If you don't see it, the API is not running

**How to fix:**
- If using the Tauri desktop app, the API should start automatically
- Check the sidecar log file at: `%LOCALAPPDATA%\Pitflix\sidecar.log`
- Look for errors like:
  - "did NOT find bundled sidecar exe" - The API executable is missing
  - "sidecar exited early" - The API crashed on startup
  - "API port readiness (5001): NOT READY" - The API failed to bind to port 5001

### 2. Check Windows Firewall

Windows Firewall might be blocking the API.

**How to fix:**
1. Open Windows Security
2. Go to Firewall & network protection
3. Click "Allow an app through firewall"
4. Look for Pitflix.API.exe or add it manually
5. Make sure both Private and Public networks are checked

### 3. Check if Port 5001 is Available

Another application might be using port 5001.

**How to check:**
1. Open PowerShell as Administrator
2. Run: `netstat -ano | findstr :5001`
3. If you see output, something is using port 5001

**How to fix:**
- Close the application using port 5001
- Or set a different port using environment variable: `ASPNETCORE_URLS=http://127.0.0.1:5002`

### 4. Check Folder Permissions

The API needs read access to your media folders.

**How to check:**
1. Right-click the folder you're trying to scan
2. Go to Properties > Security
3. Make sure your user account has "Read" permissions

**How to fix:**
- Add your user account with Read permissions
- Or run Pitflix as Administrator (not recommended for security)

### 5. Verify Folder Path

Make sure the folder path is correct and exists.

**Common issues:**
- Network drives (\\server\share) might not be accessible
- External drives might not be connected
- Folder was moved or deleted

### 6. Check API Logs

The API logs contain detailed error information.

**Where to find logs:**
- Desktop app: `%LOCALAPPDATA%\Pitflix\sidecar.log`
- Development: Check the terminal where you ran `dotnet run`

**What to look for:**
- "Cannot access folder" - Permission issues
- "Path not found" - Folder doesn't exist
- "Exception" - Unexpected errors

### 7. Use the API Health Check

The Settings page now includes an API Health Check indicator at the top.

**What it shows:**
- Green checkmark: API is connected and working
- Red warning: API is unreachable with troubleshooting tips
- Loading spinner: Checking connection

### 8. Check Browser Console (Web Version)

If using the web version:

1. Press F12 to open Developer Tools
2. Go to Console tab
3. Look for errors like:
   - "Network Error" - Cannot reach API
   - "ERR_CONNECTION_REFUSED" - API is not running
   - "timeout" - API is too slow or hung

### 9. Verify Library Paths Were Added

Before scanning, make sure folders were actually added to the library.

**How to check:**
1. Go to Settings page
2. Look at "Library folders" section
3. Your folders should be listed there

**If folders are missing:**
- Try adding them again
- Check if the "Add" button actually worked
- Look for error messages

### 10. Try Manual Scan from Settings

Instead of scanning during setup:

1. Complete the setup wizard (skip scan)
2. Go to Settings page
3. Add your library folders manually
4. Click "🔄 Scan Library" button
5. Watch for error messages below the button

## Common Error Messages

### "Cannot reach Pitflix API. Make sure it's running on port 5001."

**Cause:** The frontend cannot connect to the backend API.

**Solutions:**
1. Check if Pitflix.API.exe is running in Task Manager
2. Check Windows Firewall settings
3. Verify port 5001 is not blocked
4. Check sidecar.log for API startup errors

### "Add at least one library folder before scanning."

**Cause:** No folders have been added to the library.

**Solution:** Add at least one folder in Settings > Library folders before scanning.

### "Folder dialog failed in the desktop app. Check Tauri dialog permissions."

**Cause:** Tauri folder picker failed to open.

**Solutions:**
1. Check if another dialog is already open (Alt+Tab)
2. Try using manual path entry instead
3. Restart the application

### "That folder was not found on disk."

**Cause:** The folder path doesn't exist or isn't accessible.

**Solutions:**
1. Verify the path is correct
2. Check if the drive is connected
3. Check folder permissions
4. Try using Browse instead of manual entry

## Still Having Issues?

### Collect Diagnostic Information

1. **API Log:**
   - Location: `%LOCALAPPDATA%\Pitflix\sidecar.log`
   - Copy the last 100 lines

2. **Browser Console:**
   - Press F12 > Console tab
   - Copy any red error messages

3. **System Info:**
   - Windows version
   - Antivirus software
   - Network setup (local drives vs network drives)

4. **Folder Info:**
   - Full path of the folder you're trying to scan
   - Number of files in the folder
   - Drive type (internal, external, network)

### Reset and Try Again

If nothing works, try a clean start:

1. Close Pitflix completely
2. Delete: `%LOCALAPPDATA%\Pitflix\`
3. Restart Pitflix
4. Go through setup again

### Development Mode Testing

If you have access to the source code:

1. Run the API manually:
   ```powershell
   cd Pitflix.API
   dotnet run
   ```

2. Run the UI in dev mode:
   ```powershell
   cd Pitflix.UI
   npm run dev
   ```

3. Check both terminal outputs for errors

## Differences Between Your Device and Friend's Device

Common reasons why it works on one device but not another:

1. **Antivirus/Security Software:** Your friend might have stricter security software
2. **Windows Firewall:** Different firewall rules
3. **User Permissions:** Your friend might not be an Administrator
4. **Port Conflicts:** Something else using port 5001 on their device
5. **Network Configuration:** Different network settings
6. **Folder Locations:** Network drives vs local drives
7. **Windows Version:** Different Windows versions might have different security policies

## Prevention Tips

To avoid scan issues in the future:

1. Always check the API Health indicator in Settings
2. Use local drives instead of network drives when possible
3. Keep folder paths simple (avoid special characters)
4. Make sure you have read permissions on all media folders
5. Don't close the API while scanning
6. Check sidecar.log after any issues
