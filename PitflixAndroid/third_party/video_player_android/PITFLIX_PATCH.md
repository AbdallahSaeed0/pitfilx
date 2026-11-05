# Pitflix patch notes

This is a vendored copy of `video_player_android` 2.9.5 (from pub.dev), used via a
`dependency_overrides: { video_player_android: { path: ... } }` entry in
`PitflixAndroid/pubspec.yaml` instead of the pub.dev-hosted version.

## Why

My Device's local player needs volume boost past 100% (the standard "video_player" volume
slider caps at 1.0/100% because `VideoPlayer.setVolume` hard-clamps in native code — see
`android/src/main/java/io/flutter/plugins/videoplayer/VideoPlayer.java`). There's no way to
get real gain beyond 100% through the plugin's existing public API, so this vendors a copy
with one small addition instead of switching the whole app to a different playback engine.

## What's patched

Only `android/src/main/java/io/flutter/plugins/videoplayer/VideoPlayerPlugin.java`:

- Registers one extra, hand-written `MethodChannel` (`pitflix.dev/video_player_loudness`),
  completely separate from the plugin's own Pigeon-generated per-instance API channels — so
  none of the generated Pigeon code (`Messages.kt`, the `VideoPlayerInstanceApi` interface,
  etc.) needed touching, and nothing here can drift out of sync with upstream's wire format.
- `setLoudnessGain(playerId, gainMillibels)`: looks up the already-tracked `VideoPlayer` for
  that id (same `videoPlayers` map the rest of the plugin already uses), reads its
  `ExoPlayer`'s audio session id (`VideoPlayer.getExoPlayer().getAudioSessionId()` — already a
  public getter, no change needed there), and attaches/updates an
  `android.media.audiofx.LoudnessEnhancer` on that session for gain beyond what
  `AudioTrack`/`ExoPlayer` volume alone can do.
- Enhancers are tracked in a `playerId -> LoudnessEnhancer` map and released alongside the
  player itself, in both `dispose(long playerId)` and `disposeAllPlayers()`.

See `PitflixAndroid/lib/services/my_device_loudness_boost.dart` for the Dart side that calls
this channel, using `VideoPlayerController.playerId` (a public getter — confirmed to be the
exact same id `video_player_android`'s `create()` returns and keys its own maps by).

Also in `VideoPlayerPlugin.java` — embedded subtitle tracks:

- A second hand-written channel, `pitflix.dev/video_player_text_tracks`, so My Device can use
  subtitles stored inside MKV/MP4 files. ExoPlayer already extracts and decodes them; the plugin
  just never exposed text tracks, and it only renders the video surface.
- `getTextTracks(playerId)` lists `C.TRACK_TYPE_TEXT` tracks (language/label/mime/selected);
  `selectTextTrack(playerId, groupIndex, trackIndex)` applies a `TrackSelectionOverride` and
  re-enables the text type; `disableTextTracks(playerId)` turns text off; `attach(playerId)`
  starts forwarding cues.
- Cues go back to Dart as `onCues` calls from a per-player `Player.Listener`: text cues as
  strings, image cues (PGS/VobSub) as PNG bytes plus their position as fractions of the frame.
  Listeners are dropped with the player in `dispose`/`disposeAllPlayers`.

See `PitflixAndroid/lib/services/my_device_embedded_subtitles.dart` for the Dart side.

Also `android/src/main/java/io/flutter/plugins/videoplayer/VideoPlayer.java`:

- The constructor now calls `exoPlayer.setWakeMode(C.WAKE_MODE_LOCAL)` right after
  `setAudioAttributes(...)`. Needed for My Device's background-playback feature
  (`PlaybackForegroundService.kt`): a foreground service keeps the *process* from being killed
  once the app backgrounds/screen locks, but does nothing to stop the *CPU* from deep-sleeping,
  which independently halts ExoPlayer's decode thread. `WAKE_MODE_LOCAL` makes ExoPlayer itself
  hold a `PARTIAL_WAKE_LOCK` for as long as it's actually playing (released on pause/stop), which
  is the missing piece for local-file playback to actually survive the screen turning off.
  Requires the `android.permission.WAKE_LOCK` manifest permission (added in the main app's
  `AndroidManifest.xml`, not in this vendored package).

## Upgrading

If `video_player`/`video_player_android` ever needs a version bump, re-vendor from the new
pub.dev release and reapply these same patches to the new `VideoPlayerPlugin.java`/
`VideoPlayer.java` — the diffs are small and self-contained, not spread across the package.
