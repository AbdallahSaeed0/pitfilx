# What's New - Settings Improvements

## 🎉 Three New Features Added!

---

## 1. 🧹 Better Cleanup - Removes Smart Match Ghosts

### What Changed?
The cleanup button now removes titles that smart match added but don't actually exist on your device.

### How to Use:
1. Go to **Settings**
2. Scroll to **Maintenance** section
3. Click **"🧹 Clean Up"**
4. All ghost entries will be removed!

### What Gets Removed:
- ✅ Movies that smart match added but have no file
- ✅ Shows that smart match added but have no episodes
- ✅ Movies whose files were deleted
- ✅ Shows whose folders were deleted

### Before vs After:
**Before:** Only removed titles if files were deleted after being scanned
**After:** Also removes titles that were added by smart match but never had files

---

## 2. 🎬 Smart Player Detection - No More Browsing!

### What Changed?
Pitflix now automatically finds all media players installed on your C: drive.

### How to Use:
1. Go to **Settings**
2. Scroll to **External player** section
3. See all your installed players automatically detected!
4. Click any player to select it instantly

### Detected Players:
- VLC (64-bit and 32-bit)
- mpv
- MPC-HC / MPC-BE
- PotPlayer
- KMPlayer
- SMPlayer
- GOM Player
- Windows Media Player
- ...and more!

### Before vs After:
**Before:** Had to click "Browse" and navigate through folders manually
**After:** Just click on your player from the list - done!

### Still Need to Browse?
The "Browse" button is still there if your player isn't auto-detected.

---

## 3. 🚀 Launch on Windows Startup

### What's New?
Toggle to make Pitflix start automatically when you log into Windows.

### How to Use:
1. Go to **Settings**
2. Find the new **"Application"** section (below External player)
3. Toggle **"Open when Windows starts"**
4. Done! Pitflix will launch automatically on login

### Toggle States:
- 🟢 **Green** = Enabled (will launch on startup)
- ⚪ **Gray** = Disabled (won't launch on startup)

### How It Works:
- Adds Pitflix to Windows Registry startup entries
- No admin rights required
- Only affects your user account
- Can be toggled on/off anytime

### Note:
This feature only works on Windows desktop app (not browser version).

---

## 📍 Where to Find Everything

### Settings Page Layout:

```
Settings
├── 🟢/🔴 API Health Check (at top)
│
├── Left Column:
│   ├── 📁 Library folders
│   ├── 🎬 External player (IMPROVED!)
│   └── 💻 Application (NEW!)
│       └── Toggle: Open when Windows starts
│
└── Right Column:
    ├── 📊 Library stats
    ├── 🔑 API keys
    ├── 👁️ Watch overview
    └── 🛠️ Maintenance
        └── 🧹 Clean Up (IMPROVED!)
```

---

## 🎯 Quick Start Guide

### First Time Setup:
1. **Add library folders** → Browse or type path
2. **Select media player** → Click on auto-detected player
3. **Enable autostart** → Toggle "Open when Windows starts"
4. **Scan library** → Click "🔄 Scan Library"

### Regular Maintenance:
1. **Clean up ghosts** → Click "🧹 Clean Up" monthly
2. **Check API health** → Look for green indicator at top
3. **Update player** → Reselect if you update your player

---

## 💡 Tips & Tricks

### Cleanup:
- Run cleanup after using smart match
- Run cleanup if you moved/deleted files
- Check the message to see what was removed

### Player Detection:
- Install players in standard locations for auto-detection
- If player not detected, use "Browse" button
- You can still type player name (e.g., "vlc") instead of full path

### Autostart:
- Disable if you want to control when Pitflix runs
- Enable for convenience if you use Pitflix daily
- Doesn't affect performance (app starts in background)

---

## 🐛 Troubleshooting

### Cleanup Not Removing Entries:
- Make sure entries actually have no files
- Check if folders still exist
- Try "Remove Title" for specific entries

### Player Not Detected:
- Check if player is installed in Program Files
- Try reinstalling player to default location
- Use "Browse" button as fallback

### Autostart Not Working:
- Check if toggle is green (enabled)
- Restart computer to test
- Check Windows Task Manager → Startup tab
- Verify in Registry: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`

### Autostart Toggle Not Visible:
- Only works on Windows
- Only works in desktop app (not browser)
- Update to latest version

---

## 📝 Technical Notes

### For Advanced Users:

**Cleanup Logic:**
- Checks `FilePath` and `FolderPath` fields
- Removes if null, empty, or file/folder doesn't exist
- Also removes orphan episodes

**Player Detection:**
- Scans `C:\Program Files` and `C:\Program Files (x86)`
- Looks 2 levels deep
- Caches results for 2 minutes

**Autostart Registry:**
- Location: `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Key: `Pitflix`
- Value: `"C:\Path\To\Pitflix.exe"`

---

## 🔄 Update Instructions

### To Get These Features:

1. **Pull latest code:**
   ```bash
   git pull origin main
   ```

2. **Build UI:**
   ```bash
   cd Pitflix.UI
   npm install
   npm run build
   ```

3. **Build Tauri app:**
   ```bash
   npm run tauri build
   ```

4. **Or run in dev mode:**
   ```bash
   npm run tauri dev
   ```

---

## ✅ Verification Checklist

After updating, verify:
- [ ] Settings page loads without errors
- [ ] API Health indicator shows green
- [ ] Library folders section works
- [ ] External player shows many options
- [ ] Application section appears (Windows only)
- [ ] Autostart toggle works
- [ ] Cleanup button removes ghost entries
- [ ] No console errors (F12)

---

## 🎊 Enjoy Your Improved Pitflix!

All three features are ready to use. No breaking changes, all existing functionality preserved.

Questions? Check `SETTINGS_IMPROVEMENTS_SUMMARY.md` for detailed technical information.
