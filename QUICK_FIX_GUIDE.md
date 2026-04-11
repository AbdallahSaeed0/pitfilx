# Quick Fix Guide - Scan Not Working

## For Your Friend: 3 Steps to Fix Scan Issues

### Step 1: Check the API Health Indicator

After updating the app, go to **Settings** page. At the top, you'll see one of these:

**✅ Green Box: "API connected"**
- Everything is working! Go to Step 3.

**🔴 Red Box: "Cannot connect to API"**
- The backend is not running. Go to Step 2.

---

### Step 2: Fix API Connection Issues

If you see the red box, try these in order:

#### A. Check if API is Running
1. Press `Ctrl + Shift + Esc` to open Task Manager
2. Look for `Pitflix.API.exe` in the Processes tab
3. **If you DON'T see it:**
   - Close Pitflix completely
   - Restart Pitflix
   - Wait 10 seconds for API to start
   - Check Task Manager again

#### B. Check Windows Firewall
1. Open Windows Security (search in Start menu)
2. Click "Firewall & network protection"
3. Click "Allow an app through firewall"
4. Look for "Pitflix.API.exe"
5. **If not listed:**
   - Click "Change settings" (requires admin)
   - Click "Allow another app"
   - Browse to Pitflix.API.exe
   - Check both Private and Public
   - Click Add

#### C. Check the Log File
1. Press `Win + R`
2. Type: `%LOCALAPPDATA%\Pitflix`
3. Open `sidecar.log`
4. Look at the last few lines
5. **Common errors:**
   - "did NOT find bundled sidecar exe" → API file is missing, reinstall app
   - "API port readiness: NOT READY" → Port 5001 is blocked or in use
   - "sidecar exited early" → API crashed, check if .NET is installed

---

### Step 3: Add Folders and Scan

Once you see the **green indicator**:

1. In Settings, scroll to "Library folders"
2. Click **"Browse"** button
3. Select your media folder
4. The folder should appear in the list
5. Scroll down to "Maintenance" section
6. Click **"🔄 Scan Library"**
7. You should see: "Scan started successfully."
8. A progress overlay will appear in the bottom-right

---

## Still Not Working?

### Check These:

**1. Antivirus Software**
- Some antivirus programs block Pitflix.API.exe
- Try adding Pitflix to your antivirus exceptions

**2. Port 5001 in Use**
- Open PowerShell as Admin
- Run: `netstat -ano | findstr :5001`
- If you see output, another program is using port 5001
- Close that program or change Pitflix port

**3. Folder Permissions**
- Right-click your media folder
- Properties > Security
- Make sure your user has "Read" permission

**4. Network Drives**
- Network drives (\\server\share) might not work
- Try with a local folder first (C:\, D:\, etc.)

---

## Error Messages Explained

### "Cannot reach Pitflix API. Make sure it's running on port 5001."
→ The backend is not running. Follow Step 2 above.

### "Add at least one library folder before scanning."
→ You need to add folders first. Follow Step 3 above.

### "Folder dialog failed in the desktop app."
→ The folder picker failed. Try typing the path manually instead.

### "That folder was not found on disk."
→ The path doesn't exist. Check spelling and make sure the drive is connected.

---

## Quick Diagnostic Checklist

Before asking for help, check:

- [ ] API Health indicator in Settings (green or red?)
- [ ] Pitflix.API.exe running in Task Manager?
- [ ] Windows Firewall allows Pitflix.API.exe?
- [ ] Folders added to library in Settings?
- [ ] Any error messages shown in the app?
- [ ] Checked sidecar.log for errors?
- [ ] Tried restarting Pitflix?

---

## Get More Help

If none of this works:

1. Take a screenshot of:
   - Settings page (showing API Health indicator)
   - Task Manager (showing processes)
   - Any error messages

2. Copy the last 50 lines from:
   - `%LOCALAPPDATA%\Pitflix\sidecar.log`

3. Note:
   - Windows version
   - Antivirus software name
   - Where your media is (local drive, external, network?)

4. Share this information for detailed help

---

## Why It Works on One Device But Not Another

Common reasons:

1. **Firewall Settings:** Your friend's firewall is stricter
2. **Antivirus:** Different antivirus software
3. **Permissions:** Your friend isn't an admin
4. **Port Conflict:** Something else using port 5001
5. **Missing Files:** API executable didn't copy correctly
6. **Network Setup:** Different network configuration

The new error messages will help identify which one!
