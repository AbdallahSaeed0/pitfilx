---
name: pitflix-mydevice
description: Conventions for the "My Device" on-device video feature in the PitflixAndroid Flutter app (local folder browsing, local player, local subtitles). Use this whenever adding or changing anything under lib/screens/my_device_*.dart, lib/services/my_device_*.dart, or lib/models/my_device_*.dart — new player settings, new bottom-sheet controls, new folder/video actions, selection UI, or anything touching MyDeviceScanner/MyDeviceSettings. Also use when the user says "My Device", "local videos", "on-device player", or asks to add a control to the PitflixAndroid video player.
---

# PitFlix "My Device" feature conventions

"My Device" is a self-contained, on-device video browser + player in `PitflixAndroid`
(folders → videos → player), fully isolated from the Supabase-synced library. It has
its own settings, its own player theme, and its own file layout. Match these patterns
instead of copying from the rest of the app.

## File layout

- `lib/screens/my_device_home_screen.dart` — folder grid ("My Device" tab root)
- `lib/screens/my_device_folder_videos_screen.dart` — video list inside a folder
- `lib/screens/my_device_player_screen.dart` — the player itself (biggest file;
  bottom sheets for subtitle style, sleep timer, etc. live here as private
  `_XxxSheet` widgets)
- `lib/services/my_device_settings.dart` — all persisted settings
- `lib/services/my_device_scanner.dart` — MediaStore folder/video scanning + disk cache
- `lib/services/my_device_favorites_store.dart`, `my_device_resume_store.dart`,
  `my_device_media_edit.dart`, `my_device_loudness_boost.dart`,
  `my_device_subtitle_service.dart` — feature-specific services
- `lib/models/my_device_folder.dart`, `my_device_video.dart`, `my_device_subtitle_cue.dart`

## Isolation rule (important)

My Device must never read from or write to `UserLibraryService`, `TmdbService`, or any
Supabase-synced table. It talks to the OS (`photo_manager`/MediaStore) and to its own
local cache/prefs only. See [[pitflix-android-decoupled-from-desktop]] memory for the
broader reasoning — new Android features generally shouldn't touch the desktop-synced
local library either, and My Device is the strictest example of that.

## Adding a new setting

Follow `MyDeviceSettings` (`lib/services/my_device_settings.dart`) exactly:

1. A `static const _xxxKey = 'mydevice_xxx';` SharedPreferences key — always prefixed
   `mydevice_`, never shared with `AppSettings`.
2. A `static final ValueNotifier<T> xxx = ValueNotifier(default);`
3. Read it back in `load()` (called once at app start).
4. A `static Future<void> setXxx(T value) async { xxx.value = value; final prefs = ...; await prefs.setXxx(_xxxKey, value); }` — always update the notifier *and* persist together.

Example already in the file: `subtitleFontSize`, `subtitlePosition`, `subtitleDelayMs`.

## Adding a player control (bottom sheet)

The player's settings UI is a set of `showModalBottomSheet` calls opened from icon
buttons in the control bar, each backed by a private `StatelessWidget` sheet class in
`my_device_player_screen.dart` (e.g. `_SubtitleStyleSheet`, `_SleepTimerSheet`). To add
a new one:

1. Add the setting to `MyDeviceSettings` per above.
2. Add a `Slider`/`ChoiceChip`/etc. inside the relevant `_XxxSheet`, wrapped in
   `ValueListenableBuilder<T>` bound to the `MyDeviceSettings` notifier, calling the
   `setXxx` method `onChanged`.
3. Style with `_PlayerColors` (the player's own purple palette — **not**
   `AppColors`/`AppTextStyles`, which is the rest-of-app theme) and `GoogleFonts.bebasNeue`
   /`GoogleFonts.dmSans` directly, matching the existing sheets.
4. If the control affects live playback (like subtitle delay shifting cue lookup), apply
   it by reading `MyDeviceSettings.xxx.value` inside `_onControllerUpdate` — don't mutate
   cached data (e.g. don't rewrite cue timestamps for a delay; offset the position you
   look up instead).

## Adding folder/video actions (rename, delete, share, multi-select, etc.)

Single-item actions go through the `_VideoActionsSheet` → `_VideoAction` enum →
`_openMenu` switch in `my_device_folder_videos_screen.dart`. Destructive actions
(delete) always confirm first via `AlertDialog` styled with `AppColors.destructive`.

Multi-select follows the pattern added for batch-delete:
- Track `Set<String> _selectedIds` in the screen's `State`; `_selecting = _selectedIds.isNotEmpty`.
- Long-press a row to start selecting; while selecting, tap toggles instead of opening
  the player/screen.
- Header swaps to "N SELECTED" + a close (✕) button (clears selection) + an action
  icon (e.g. delete) when `_selecting`.
- Wrap the `Scaffold` in `PopScope(canPop: !_selecting, onPopInvokedWithResult: ...)` so
  the system back button clears selection instead of leaving the screen.
- Pass `selecting`/`selected`/`onToggleSelected` down into the row widget; swap its
  trailing `IconButton` (menu) for a check-circle icon while selecting.

## Scanning / caching gotcha

`MyDeviceScanner` caches the folder list to disk (`mydevice_scan_cache.json`) purely so
the grid can paint instantly on open — it is not a source of truth. Any UI that reads
`MyDeviceScanner.folders` should trigger `MyDeviceScanner.rescan()` on load (not just
when the cache is empty) if it displays counts or other data that can go stale as files
change on disk. `videosForFolder()` is intentionally always a fresh, uncached MediaStore
query — don't add caching there without a real perf reason.

## Related memory

[[pitflix-android-decoupled-from-desktop]], [[pitflix-android-loading-perf]]
