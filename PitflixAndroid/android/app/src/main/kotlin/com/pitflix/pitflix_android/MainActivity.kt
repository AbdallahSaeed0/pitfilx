package com.pitflix.pitflix_android

import android.app.Activity
import android.app.PictureInPictureParams
import android.app.RecoverableSecurityException
import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.IntentSender
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Rational
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.FlutterEngineCache
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

/**
 * My Device's "Rename" action (see the three-dot menu in
 * MyDeviceFolderVideosScreen) needs to update a MediaStore video's
 * DISPLAY_NAME for files this app didn't create itself — almost always true,
 * since these are videos already on the phone (camera roll, downloads,
 * etc.) — which on API 29+ (Android 10+) requires one-time user consent via
 * a system dialog rather than a direct write.
 *
 * FlutterActivity extends plain android.app.Activity, not
 * androidx.activity.ComponentActivity, so the newer registerForActivityResult
 * API isn't available here; this uses the older startIntentSenderForResult +
 * onActivityResult pair instead. onActivityResult chains to super first,
 * since other plugins (e.g. image_picker's camera capture) already rely on
 * that same callback being delivered to them.
 */
class MainActivity : FlutterActivity() {
    companion object {
        // Reused across Activity instances via FlutterEngineCache — see provideFlutterEngine
        // and shouldDestroyEngineWithHost below.
        private const val ENGINE_ID = "pitflix_main_engine"

        // True only while My Device's background-playback session is active (set by the
        // pitflix.dev/playback_service channel's "start"/"stop" calls). Scopes the engine's
        // survival to exactly the case that needs it — every other app close still tears the
        // engine down normally, so this doesn't change behavior/memory footprint the rest of
        // the time.
        @Volatile
        var keepEngineAlive = false
    }

    private val mediaStoreEditChannel = "pitflix.dev/media_store_edit"
    private val renameRequestCode = 9001

    private var pendingRenameUri: Uri? = null
    private var pendingRenameName: String? = null
    private var pendingResult: MethodChannel.Result? = null

    // ── Picture-in-Picture (My Device player) ─────────────────────────────
    private val pipChannel = "pitflix.dev/pip"
    private val pipEventsChannel = "pitflix.dev/pip_events"
    private var pipEligible = false
    private var pipAspectNumerator = 16
    private var pipAspectDenominator = 9

    // ── Background playback (My Device player) ────────────────────────────
    private val playbackServiceChannel = "pitflix.dev/playback_service"
    private val playbackEventsChannel = "pitflix.dev/playback_events"

    // Backs My Device's background playback: FlutterActivity's default provideFlutterEngine()
    // creates a fresh engine every launch and always destroys it with the host Activity — fine
    // normally, but it means the ExoPlayer instance living inside video_player's plugin (which
    // is attached to that engine) gets torn down the moment the Activity is destroyed, e.g. when
    // the task is swiped from Recents. Reusing the same cached engine, kept alive only while
    // keepEngineAlive is true, lets that ExoPlayer (and the notification's play/pause round trip
    // to it) keep running headless with no Activity attached, then re-attach its existing,
    // still-playing widget tree to a new Activity instance if the user reopens the app.
    override fun provideFlutterEngine(context: Context): FlutterEngine {
        val cached = FlutterEngineCache.getInstance().get(ENGINE_ID)
        if (cached != null) return cached

        val engine = FlutterEngine(context)
        engine.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault())
        GeneratedPluginRegistrant.registerWith(engine)
        FlutterEngineCache.getInstance().put(ENGINE_ID, engine)
        return engine
    }

    override fun shouldDestroyEngineWithHost(): Boolean = !keepEngineAlive

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, mediaStoreEditChannel)
            .setMethodCallHandler { call, result ->
                if (call.method != "renameVideo") {
                    result.notImplemented()
                    return@setMethodCallHandler
                }
                val mediaId = call.argument<Number>("mediaId")?.toLong()
                val newName = call.argument<String>("newDisplayName")
                if (mediaId == null || newName.isNullOrBlank()) {
                    result.error("bad_args", "mediaId and newDisplayName are required", null)
                    return@setMethodCallHandler
                }
                val uri = ContentUris.withAppendedId(
                    MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    mediaId
                )
                attemptRename(uri, newName, result)
            }

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, pipChannel)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "setPipState" -> {
                        pipEligible = call.argument<Boolean>("eligible") ?: false
                        pipAspectNumerator = call.argument<Int>("numerator") ?: 16
                        pipAspectDenominator = call.argument<Int>("denominator") ?: 9
                        result.success(null)
                    }
                    "enterPip" -> {
                        enterPipMode()
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, pipEventsChannel)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    PipEvents.sink = events
                }
                override fun onCancel(arguments: Any?) {
                    PipEvents.sink = null
                }
            })

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, playbackServiceChannel)
            .setMethodCallHandler { call, result ->
                val intent = Intent(this, PlaybackForegroundService::class.java)
                when (call.method) {
                    "start" -> {
                        keepEngineAlive = true
                        intent.action = PlaybackForegroundService.ACTION_START
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_TITLE,
                            call.argument<String>("title") ?: "Pitflix",
                        )
                        // .toLong(): a Dart int arrives as Integer or Long over the
                        // channel depending on magnitude, so normalize before putExtra.
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_DURATION,
                            call.argument<Number>("durationMs")?.toLong() ?: -1L,
                        )
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_POSITION,
                            call.argument<Number>("positionMs")?.toLong() ?: 0L,
                        )
                        startForegroundServiceCompat(intent)
                        result.success(null)
                    }
                    "updateState" -> {
                        intent.action = PlaybackForegroundService.ACTION_UPDATE_STATE
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_IS_PLAYING,
                            call.argument<Boolean>("isPlaying") ?: true,
                        )
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_POSITION,
                            call.argument<Number>("positionMs")?.toLong() ?: 0L,
                        )
                        // -1 default (absent) tells the service to keep its current
                        // duration; only sent when it actually changed (next video).
                        intent.putExtra(
                            PlaybackForegroundService.EXTRA_DURATION,
                            call.argument<Number>("durationMs")?.toLong() ?: -1L,
                        )
                        startForegroundServiceCompat(intent)
                        result.success(null)
                    }
                    "stop" -> {
                        keepEngineAlive = false
                        intent.action = PlaybackForegroundService.ACTION_STOP
                        startForegroundServiceCompat(intent)
                        result.success(null)
                    }
                    else -> result.notImplemented()
                }
            }
        EventChannel(flutterEngine.dartExecutor.binaryMessenger, playbackEventsChannel)
            .setStreamHandler(object : EventChannel.StreamHandler {
                override fun onListen(arguments: Any?, events: EventChannel.EventSink) {
                    PlaybackEvents.sink = events
                }
                override fun onCancel(arguments: Any?) {
                    PlaybackEvents.sink = null
                }
            })
    }

    private fun startForegroundServiceCompat(intent: Intent) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
    }

    private fun enterPipMode() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        try {
            val ratio = Rational(pipAspectNumerator.coerceAtLeast(1), pipAspectDenominator.coerceAtLeast(1))
            enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(ratio).build())
        } catch (_: Exception) {
            // Device/state doesn't support entering PiP right now — no-op.
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pipEligible) enterPipMode()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        PipEvents.sink?.success(isInPictureInPictureMode)
    }

    private fun attemptRename(uri: Uri, newDisplayName: String, result: MethodChannel.Result) {
        try {
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, newDisplayName)
            }
            val updated = contentResolver.update(uri, values, null, null)
            if (updated > 0) {
                result.success(null)
            } else {
                result.error("rename_failed", "No row updated", null)
            }
        } catch (e: RecoverableSecurityException) {
            // API 29 — file isn't owned by this app; ask for one-time write access, then retry.
            requestWriteAccessThenRename(uri, newDisplayName, result, e.userAction.actionIntent.intentSender)
        } catch (e: SecurityException) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                // API 30+ — proactively request a write grant instead of relying on the
                // exception above (which can still fire on 30+, but this is the documented
                // primary path for that OS level).
                val pendingIntent = MediaStore.createWriteRequest(contentResolver, listOf(uri))
                requestWriteAccessThenRename(uri, newDisplayName, result, pendingIntent.intentSender)
            } else {
                result.error("rename_failed", e.message, null)
            }
        } catch (e: Exception) {
            result.error("rename_failed", e.message, null)
        }
    }

    private fun requestWriteAccessThenRename(
        uri: Uri,
        newDisplayName: String,
        result: MethodChannel.Result,
        intentSender: IntentSender
    ) {
        pendingRenameUri = uri
        pendingRenameName = newDisplayName
        pendingResult = result
        startIntentSenderForResult(intentSender, renameRequestCode, null, 0, 0, 0)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != renameRequestCode) return
        val uri = pendingRenameUri
        val name = pendingRenameName
        val result = pendingResult
        pendingRenameUri = null
        pendingRenameName = null
        pendingResult = null
        if (resultCode == Activity.RESULT_OK && uri != null && name != null) {
            attemptRename(uri, name, result ?: return)
        } else {
            result?.error("rename_cancelled", "User denied rename permission", null)
        }
    }
}
