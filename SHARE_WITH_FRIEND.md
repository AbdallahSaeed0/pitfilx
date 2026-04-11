# 📦 Pitflix Setup - For Your Friend

## 🚀 Quick Install Guide

### Step 1: Download & Install
1. Get the installer: `Pitflix_0.1.0_x64-setup.exe` (56.74 MB)
2. Double-click to run
3. Click "Yes" if Windows asks for permission
4. Follow the setup wizard
5. Done! Pitflix will launch automatically

### Step 2: First Setup
1. **TMDB API Key** (required):
   - Get free key at: https://www.themoviedb.org/settings/api
   - Paste in Pitflix setup wizard
   - Click "Verify key"

2. **OpenSubtitles Key** (optional):
   - Get free key at: https://www.opensubtitles.com/consumers
   - Or click "Skip for now"

3. **Add Media Folders**:
   - Click "Browse for folder"
   - Select your Movies or TV Shows folder
   - Or type the path manually
   - Add more folders if needed

4. **Scan Library**:
   - Click "Yes, scan now"
   - Wait for scan to complete
   - Your library is ready!

---

## ✨ New Features You'll Love

### 1. 🧹 Better Cleanup
**What it does:** Removes ghost entries that smart match added but don't exist
**How to use:** Settings → Maintenance → Click "🧹 Clean Up"

### 2. 🎬 Auto Player Detection
**What it does:** Finds all your media players automatically
**How to use:** Settings → External player → Just click on your player!

### 3. 🚀 Launch on Startup
**What it does:** Opens Pitflix when Windows starts
**How to use:** Settings → Application → Toggle "Open when Windows starts"

---

## 🎯 Quick Start

After installation:
1. ✅ Open Pitflix
2. ✅ Check green indicator at top of Settings (means API is working)
3. ✅ Add your media folders
4. ✅ Click "Scan Library"
5. ✅ Browse and enjoy!

---

## 🐛 If Scan Doesn't Work

### Check These:
1. **API Health Indicator** (Settings page, at top):
   - 🟢 Green = Good, everything working
   - 🔴 Red = Problem, follow the tips shown

2. **If Red Indicator**:
   - Check Windows Firewall (allow Pitflix.API.exe)
   - Restart Pitflix
   - Check if antivirus is blocking

3. **If Still Not Working**:
   - Press `Win + R`
   - Type: `%LOCALAPPDATA%\Pitflix`
   - Open `sidecar.log`
   - Look for errors at the bottom

---

## 💡 Pro Tips

### Media Players:
- Install VLC or mpv for best experience
- Pitflix will find them automatically
- No need to browse for the .exe file!

### Library Organization:
- Use separate folders for Movies and TV Shows
- Keep files organized (helps with matching)
- Run cleanup monthly to remove ghosts

### Performance:
- Enable "Open when Windows starts" for convenience
- Use local drives (not network) for better speed
- Keep media files on SSD if possible

---

## 📞 Need Help?

### Common Issues:

**"Scan does nothing"**
→ Check API Health indicator in Settings (should be green)

**"Can't find my player"**
→ Install player in default location, or use "Browse" button

**"Movies not matching"**
→ Make sure files are named properly (e.g., "Movie Name (2020).mkv")

**"API not starting"**
→ Check Windows Firewall, allow Pitflix.API.exe

### More Help:
- Check `TROUBLESHOOTING.md` for detailed solutions
- Check `QUICK_FIX_GUIDE.md` for scan issues
- Check `WHATS_NEW.md` for feature details

---

## 📂 Where Files Are Stored

### Application:
`C:\Program Files\Pitflix\`

### Your Data:
`%LOCALAPPDATA%\Pitflix\`
- Database: `Pitflix.db`
- Cached images: `Images\` folder
- Logs: `sidecar.log`

---

## 🎊 Enjoy Pitflix!

You now have:
- ✅ Smart cleanup (removes ghosts)
- ✅ Auto player detection (no browsing)
- ✅ Windows startup option (convenient)
- ✅ Better error messages (helpful)
- ✅ API health check (diagnostic)

**Have fun organizing your media library!** 🎬🍿

---

## 📋 Quick Checklist

After installing, verify:
- [ ] Pitflix opens without errors
- [ ] Settings shows green indicator (API working)
- [ ] Can add library folders
- [ ] Scan finds your media
- [ ] Can select media player
- [ ] Can play a movie/show
- [ ] Watch progress is tracked

If all checked ✅ = Everything working perfectly!

---

**Version:** 0.1.0  
**Build Date:** March 31, 2026  
**Installer Size:** 56.74 MB  
**Platform:** Windows 10/11 (64-bit)
