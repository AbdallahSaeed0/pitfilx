// Copyright 2013 The Flutter Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

package io.flutter.plugins.videoplayer;

import android.content.Context;
import android.graphics.Bitmap;
import android.media.audiofx.LoudnessEnhancer;
import android.util.LongSparseArray;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import io.flutter.FlutterInjector;
import io.flutter.Log;
import io.flutter.embedding.engine.plugins.FlutterPlugin;
import io.flutter.plugin.common.BinaryMessenger;
import io.flutter.plugin.common.MethodChannel;
import io.flutter.plugins.videoplayer.platformview.PlatformVideoViewFactory;
import io.flutter.plugins.videoplayer.platformview.PlatformViewVideoPlayer;
import io.flutter.plugins.videoplayer.texture.TextureVideoPlayer;
import io.flutter.view.TextureRegistry;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Android platform implementation of the VideoPlayerPlugin. */
public class VideoPlayerPlugin implements FlutterPlugin, AndroidVideoPlayerApi {
  private static final String TAG = "VideoPlayerPlugin";

  // ── Pitflix patch — see PITFLIX_PATCH.md ──────────────────────────────────
  // A separate, hand-written channel (not Pigeon-generated, unlike everything else in this
  // file) for volume boost past the 100% ceiling VideoPlayer.setVolume hard-clamps to. Kept
  // fully independent of the generated AndroidVideoPlayerApi/VideoPlayerInstanceApi so the
  // generated code never needs touching.
  private static final String LOUDNESS_CHANNEL = "pitflix.dev/video_player_loudness";
  private final LongSparseArray<LoudnessEnhancer> loudnessEnhancers = new LongSparseArray<>();
  private MethodChannel loudnessChannel;

  // Embedded subtitle tracks (MKV/MP4 text and image subtitles). ExoPlayer already extracts and
  // decodes these, but the plugin renders only the video surface and exposes no text-track API,
  // so they were unreachable. This lists/selects them and forwards decoded cues to Dart, which
  // draws them in the player's own subtitle overlay (same place external .srt cues go).
  private static final String TEXT_TRACKS_CHANNEL = "pitflix.dev/video_player_text_tracks";
  private final LongSparseArray<Player.Listener> cueListeners = new LongSparseArray<>();
  private MethodChannel textTracksChannel;
  // ── End Pitflix patch ──────────────────────────────────────────────────────

  private final LongSparseArray<VideoPlayer> videoPlayers = new LongSparseArray<>();
  private FlutterState flutterState;
  private final VideoPlayerOptions sharedOptions = new VideoPlayerOptions();
  private long nextPlayerIdentifier = 1;

  /** Register this with the v2 embedding for the plugin to respond to lifecycle callbacks. */
  public VideoPlayerPlugin() {}

  @Override
  public void onAttachedToEngine(@NonNull FlutterPluginBinding binding) {
    final FlutterInjector injector = FlutterInjector.instance();
    this.flutterState =
        new FlutterState(
            binding.getApplicationContext(),
            binding.getBinaryMessenger(),
            injector.flutterLoader()::getLookupKeyForAsset,
            injector.flutterLoader()::getLookupKeyForAsset,
            binding.getTextureRegistry());
    flutterState.startListening(this, binding.getBinaryMessenger());

    binding
        .getPlatformViewRegistry()
        .registerViewFactory(
            "plugins.flutter.dev/video_player_android",
            new PlatformVideoViewFactory(videoPlayers::get));

    // Pitflix patch — see PITFLIX_PATCH.md.
    loudnessChannel = new MethodChannel(binding.getBinaryMessenger(), LOUDNESS_CHANNEL);
    loudnessChannel.setMethodCallHandler(this::onLoudnessMethodCall);
    textTracksChannel = new MethodChannel(binding.getBinaryMessenger(), TEXT_TRACKS_CHANNEL);
    textTracksChannel.setMethodCallHandler(this::onTextTracksMethodCall);
  }

  @Override
  public void onDetachedFromEngine(@NonNull FlutterPluginBinding binding) {
    if (flutterState == null) {
      Log.wtf(TAG, "Detached from the engine before registering to it.");
    }
    flutterState.stopListening(binding.getBinaryMessenger());
    flutterState = null;
    if (loudnessChannel != null) {
      loudnessChannel.setMethodCallHandler(null);
      loudnessChannel = null;
    }
    if (textTracksChannel != null) {
      textTracksChannel.setMethodCallHandler(null);
      textTracksChannel = null;
    }
    onDestroy();
  }

  // ── Pitflix patch — see PITFLIX_PATCH.md ──────────────────────────────────
  private void onLoudnessMethodCall(
      @NonNull io.flutter.plugin.common.MethodCall call, @NonNull MethodChannel.Result result) {
    if (!"setLoudnessGain".equals(call.method)) {
      result.notImplemented();
      return;
    }
    try {
      Number playerIdArg = call.argument("playerId");
      Number gainArg = call.argument("gainMillibels");
      if (playerIdArg == null || gainArg == null) {
        result.error("bad_args", "playerId and gainMillibels are required", null);
        return;
      }
      setLoudnessGain(playerIdArg.longValue(), gainArg.intValue());
      result.success(null);
    } catch (Exception e) {
      result.error("loudness_error", e.getMessage(), null);
    }
  }

  /**
   * Attaches (on first use) or updates a {@link LoudnessEnhancer} on the given player's ExoPlayer
   * audio session, for gain beyond what {@link VideoPlayer#setVolume} alone can reach (that
   * method hard-clamps to [0, 1] — see VideoPlayer.java). [gainMillibels] of 0 disables the
   * boost (falls back to whatever VideoPlayer.setVolume is already doing) without tearing the
   * enhancer down, since it'll likely be turned back on again as the user keeps adjusting volume.
   */
  private void setLoudnessGain(long playerId, int gainMillibels) {
    VideoPlayer player = getPlayer(playerId);
    LoudnessEnhancer enhancer = loudnessEnhancers.get(playerId);
    if (enhancer == null) {
      int sessionId = player.getExoPlayer().getAudioSessionId();
      enhancer = new LoudnessEnhancer(sessionId);
      loudnessEnhancers.put(playerId, enhancer);
    }
    enhancer.setTargetGain(gainMillibels);
    enhancer.setEnabled(gainMillibels > 0);
  }

  @OptIn(markerClass = UnstableApi.class)
  private void onTextTracksMethodCall(
      @NonNull io.flutter.plugin.common.MethodCall call, @NonNull MethodChannel.Result result) {
    try {
      Number playerIdArg = call.argument("playerId");
      if (playerIdArg == null) {
        result.error("bad_args", "playerId is required", null);
        return;
      }
      long playerId = playerIdArg.longValue();
      ExoPlayer exoPlayer = getPlayer(playerId).getExoPlayer();
      switch (call.method) {
        case "attach":
          attachCueListener(playerId, exoPlayer);
          result.success(null);
          return;
        case "getTextTracks":
          result.success(listTextTracks(exoPlayer));
          return;
        case "selectTextTrack":
          {
            Number groupArg = call.argument("groupIndex");
            Number trackArg = call.argument("trackIndex");
            if (groupArg == null || trackArg == null) {
              result.error("bad_args", "groupIndex and trackIndex are required", null);
              return;
            }
            attachCueListener(playerId, exoPlayer);
            selectTextTrack(exoPlayer, groupArg.intValue(), trackArg.intValue());
            result.success(null);
            return;
          }
        case "disableTextTracks":
          exoPlayer.setTrackSelectionParameters(
              exoPlayer
                  .getTrackSelectionParameters()
                  .buildUpon()
                  .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                  .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                  .build());
          result.success(null);
          return;
        default:
          result.notImplemented();
      }
    } catch (Exception e) {
      result.error("text_tracks_error", e.getMessage(), null);
    }
  }

  @OptIn(markerClass = UnstableApi.class)
  private static List<Map<String, Object>> listTextTracks(ExoPlayer exoPlayer) {
    List<Map<String, Object>> out = new ArrayList<>();
    Tracks tracks = exoPlayer.getCurrentTracks();
    for (int g = 0; g < tracks.getGroups().size(); g++) {
      Tracks.Group group = tracks.getGroups().get(g);
      if (group.getType() != C.TRACK_TYPE_TEXT) continue;
      for (int t = 0; t < group.length; t++) {
        Format format = group.getTrackFormat(t);
        // Subtitles parsed during extraction (media3's default) report a generic cue mime type
        // and keep the original codec in `codecs`.
        String mime =
            MimeTypes.APPLICATION_MEDIA3_CUES.equals(format.sampleMimeType)
                ? format.codecs
                : format.sampleMimeType;
        Map<String, Object> track = new HashMap<>();
        track.put("groupIndex", g);
        track.put("trackIndex", t);
        track.put("label", format.label);
        track.put("language", format.language);
        track.put("mimeType", mime);
        track.put("supported", group.isTrackSupported(t));
        track.put("selected", group.isTrackSelected(t));
        track.put("forced", (format.selectionFlags & C.SELECTION_FLAG_FORCED) != 0);
        track.put("isDefault", (format.selectionFlags & C.SELECTION_FLAG_DEFAULT) != 0);
        out.add(track);
      }
    }
    return out;
  }

  private static void selectTextTrack(ExoPlayer exoPlayer, int groupIndex, int trackIndex) {
    Tracks tracks = exoPlayer.getCurrentTracks();
    if (groupIndex < 0 || groupIndex >= tracks.getGroups().size()) {
      throw new IllegalArgumentException("groupIndex out of bounds: " + groupIndex);
    }
    Tracks.Group group = tracks.getGroups().get(groupIndex);
    if (group.getType() != C.TRACK_TYPE_TEXT || trackIndex < 0 || trackIndex >= group.length) {
      throw new IllegalArgumentException("not a text track: " + groupIndex + "/" + trackIndex);
    }
    exoPlayer.setTrackSelectionParameters(
        exoPlayer
            .getTrackSelectionParameters()
            .buildUpon()
            .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            .setOverrideForType(
                new TrackSelectionOverride(group.getMediaTrackGroup(), trackIndex))
            .build());
  }

  /** Forwards every decoded cue change for this player to Dart as an "onCues" call. */
  private void attachCueListener(long playerId, ExoPlayer exoPlayer) {
    if (cueListeners.get(playerId) != null) return;
    Player.Listener listener =
        new Player.Listener() {
          @Override
          public void onCues(@NonNull CueGroup cueGroup) {
            MethodChannel channel = textTracksChannel;
            if (channel == null) return;
            Map<String, Object> args = new HashMap<>();
            args.put("playerId", playerId);
            args.put("cues", serializeCues(cueGroup.cues));
            channel.invokeMethod("onCues", args);
          }
        };
    exoPlayer.addListener(listener);
    cueListeners.put(playerId, listener);
  }

  /**
   * Text cues as plain strings; image cues (PGS/VobSub) as PNG bytes plus their placement, as
   * fractions of the video frame the way media3 reports them for bitmap subtitles.
   */
  private static List<Map<String, Object>> serializeCues(List<Cue> cues) {
    List<Map<String, Object>> out = new ArrayList<>();
    for (Cue cue : cues) {
      Map<String, Object> c = new HashMap<>();
      if (cue.bitmap != null) {
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        cue.bitmap.compress(Bitmap.CompressFormat.PNG, 100, png);
        c.put("png", png.toByteArray());
        c.put("left", cue.position == Cue.DIMEN_UNSET ? 0.25 : (double) cue.position);
        c.put("top", cue.line == Cue.DIMEN_UNSET ? 0.8 : (double) cue.line);
        c.put("width", cue.size == Cue.DIMEN_UNSET ? 0.5 : (double) cue.size);
        c.put("height", cue.bitmapHeight == Cue.DIMEN_UNSET ? -1.0 : (double) cue.bitmapHeight);
      } else if (cue.text != null) {
        c.put("text", cue.text.toString());
      } else {
        continue;
      }
      out.add(c);
    }
    return out;
  }

  private void releaseLoudnessEnhancer(long playerId) {
    LoudnessEnhancer enhancer = loudnessEnhancers.get(playerId);
    if (enhancer != null) {
      enhancer.release();
      loudnessEnhancers.remove(playerId);
    }
  }
  // ── End Pitflix patch ──────────────────────────────────────────────────────

  private void disposeAllPlayers() {
    for (int i = 0; i < videoPlayers.size(); i++) {
      videoPlayers.valueAt(i).dispose();
    }
    videoPlayers.clear();
    // Pitflix patch — see PITFLIX_PATCH.md.
    for (int i = 0; i < loudnessEnhancers.size(); i++) {
      loudnessEnhancers.valueAt(i).release();
    }
    loudnessEnhancers.clear();
    cueListeners.clear();
  }

  public void onDestroy() {
    // The whole FlutterView is being destroyed. Here we release resources acquired for all
    // instances
    // of VideoPlayer. Once https://github.com/flutter/flutter/issues/19358 is resolved this may
    // be replaced with just asserting that videoPlayers.isEmpty().
    // https://github.com/flutter/flutter/issues/20989 tracks this.
    disposeAllPlayers();
  }

  @Override
  public void initialize() {
    disposeAllPlayers();
  }

  @OptIn(markerClass = UnstableApi.class)
  @Override
  public long createForPlatformView(@NonNull CreationOptions options) {
    final VideoAsset videoAsset = videoAssetWithOptions(options);

    long id = nextPlayerIdentifier++;
    final String streamInstance = Long.toString(id);
    VideoPlayer videoPlayer =
        PlatformViewVideoPlayer.create(
            flutterState.applicationContext,
            VideoPlayerEventCallbacks.bindTo(flutterState.binaryMessenger, streamInstance),
            videoAsset,
            sharedOptions);

    registerPlayerInstance(videoPlayer, id);
    return id;
  }

  @OptIn(markerClass = UnstableApi.class)
  @Override
  public @NonNull TexturePlayerIds createForTextureView(@NonNull CreationOptions options) {
    final VideoAsset videoAsset = videoAssetWithOptions(options);

    long id = nextPlayerIdentifier++;
    final String streamInstance = Long.toString(id);
    TextureRegistry.SurfaceProducer handle = flutterState.textureRegistry.createSurfaceProducer();
    VideoPlayer videoPlayer =
        TextureVideoPlayer.create(
            flutterState.applicationContext,
            VideoPlayerEventCallbacks.bindTo(flutterState.binaryMessenger, streamInstance),
            handle,
            videoAsset,
            sharedOptions);

    registerPlayerInstance(videoPlayer, id);
    return new TexturePlayerIds(id, handle.id());
  }

  private @NonNull VideoAsset videoAssetWithOptions(@NonNull CreationOptions options) {
    final @NonNull String uri = options.getUri();
    if (uri.startsWith("asset:")) {
      return VideoAsset.fromAssetUrl(uri);
    } else if (uri.startsWith("rtsp:")) {
      return VideoAsset.fromRtspUrl(uri);
    } else {
      VideoAsset.StreamingFormat streamingFormat = VideoAsset.StreamingFormat.UNKNOWN;
      PlatformVideoFormat formatHint = options.getFormatHint();
      if (formatHint != null) {
        switch (formatHint) {
          case SS:
            streamingFormat = VideoAsset.StreamingFormat.SMOOTH;
            break;
          case DASH:
            streamingFormat = VideoAsset.StreamingFormat.DYNAMIC_ADAPTIVE;
            break;
          case HLS:
            streamingFormat = VideoAsset.StreamingFormat.HTTP_LIVE;
            break;
        }
      }
      return VideoAsset.fromRemoteUrl(
          uri, streamingFormat, options.getHttpHeaders(), options.getUserAgent());
    }
  }

  private void registerPlayerInstance(VideoPlayer player, long id) {
    // Set up the instance-specific API handler, and make sure it is removed when the player is
    // disposed.
    BinaryMessenger messenger = flutterState.binaryMessenger;
    final String channelSuffix = Long.toString(id);
    VideoPlayerInstanceApi.Companion.setUp(messenger, player, channelSuffix);
    player.setDisposeHandler(
        () -> VideoPlayerInstanceApi.Companion.setUp(messenger, null, channelSuffix));

    videoPlayers.put(id, player);
  }

  @NonNull
  private VideoPlayer getPlayer(long playerId) {
    VideoPlayer player = videoPlayers.get(playerId);

    // Avoid a very ugly un-debuggable NPE that results in returning a null player.
    if (player == null) {
      String message = "No player found with playerId <" + playerId + ">";
      if (videoPlayers.size() == 0) {
        message += " and no active players created by the plugin.";
      }
      throw new IllegalStateException(message);
    }

    return player;
  }

  @Override
  public void dispose(long playerId) {
    VideoPlayer player = getPlayer(playerId);
    player.dispose();
    videoPlayers.remove(playerId);
    releaseLoudnessEnhancer(playerId); // Pitflix patch — see PITFLIX_PATCH.md.
    cueListeners.remove(playerId); // Pitflix patch — released along with the player.
  }

  @Override
  public void setMixWithOthers(boolean mixWithOthers) {
    sharedOptions.mixWithOthers = mixWithOthers;
  }

  @Override
  public @NonNull String getLookupKeyForAsset(@NonNull String asset, @Nullable String packageName) {
    return packageName == null
        ? flutterState.keyForAsset.get(asset)
        : flutterState.keyForAssetAndPackageName.get(asset, packageName);
  }

  private interface KeyForAssetFn {
    String get(String asset);
  }

  private interface KeyForAssetAndPackageName {
    String get(String asset, String packageName);
  }

  private static final class FlutterState {
    final Context applicationContext;
    final BinaryMessenger binaryMessenger;
    final KeyForAssetFn keyForAsset;
    final KeyForAssetAndPackageName keyForAssetAndPackageName;
    final TextureRegistry textureRegistry;

    FlutterState(
        Context applicationContext,
        BinaryMessenger messenger,
        KeyForAssetFn keyForAsset,
        KeyForAssetAndPackageName keyForAssetAndPackageName,
        TextureRegistry textureRegistry) {
      this.applicationContext = applicationContext;
      this.binaryMessenger = messenger;
      this.keyForAsset = keyForAsset;
      this.keyForAssetAndPackageName = keyForAssetAndPackageName;
      this.textureRegistry = textureRegistry;
    }

    void startListening(VideoPlayerPlugin methodCallHandler, BinaryMessenger messenger) {
      AndroidVideoPlayerApi.Companion.setUp(messenger, methodCallHandler);
    }

    void stopListening(BinaryMessenger messenger) {
      AndroidVideoPlayerApi.Companion.setUp(messenger, null);
    }
  }
}
