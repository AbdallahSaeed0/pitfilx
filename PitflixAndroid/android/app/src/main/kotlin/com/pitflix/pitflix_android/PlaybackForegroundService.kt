package com.pitflix.pitflix_android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat.MediaStyle

/**
 * Keeps My Device's video player audible after the app is backgrounded or the screen locks.
 * `video_player`'s ExoPlayer keeps decoding audio on its own once playback starts — the only
 * thing actually missing is Android not killing this process while backgrounded, which is what
 * `startForeground` + this ongoing notification buys. The notification's play/pause/stop buttons
 * don't touch playback directly (the real VideoPlayerController lives in Dart) — they just emit
 * an event through [PlaybackEvents] that `PlaybackService` (Dart) listens for and acts on, then
 * calls back into [ACTION_UPDATE_STATE] once it's actually toggled, so this notification is
 * always a mirror of Dart's state rather than a second source of truth.
 */
class PlaybackForegroundService : Service() {
    companion object {
        const val ACTION_START = "com.pitflix.pitflix_android.playback.START"
        const val ACTION_UPDATE_STATE = "com.pitflix.pitflix_android.playback.UPDATE_STATE"
        const val ACTION_STOP = "com.pitflix.pitflix_android.playback.STOP"
        const val ACTION_TAP_PLAY = "com.pitflix.pitflix_android.playback.TAP_PLAY"
        const val ACTION_TAP_PAUSE = "com.pitflix.pitflix_android.playback.TAP_PAUSE"
        const val ACTION_TAP_STOP = "com.pitflix.pitflix_android.playback.TAP_STOP"
        const val EXTRA_TITLE = "title"
        const val EXTRA_IS_PLAYING = "isPlaying"
        const val EXTRA_POSITION = "positionMs"
        const val EXTRA_DURATION = "durationMs"

        private const val CHANNEL_ID = "pitflix_playback"
        private const val NOTIFICATION_ID = 4201
    }

    private var mediaSession: MediaSessionCompat? = null
    private var title: String = "Pitflix"
    // -1 = unknown; the system "Now Playing" card needs a real duration in its
    // metadata to render the seek bar / total-time label, and a real position in
    // the playback state to render elapsed time. Held here so ACTION_UPDATE_STATE
    // can reuse the last known duration when Dart only sends a position.
    private var durationMs: Long = -1L

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        mediaSession = MediaSessionCompat(this, "PitflixPlayback").apply {
            // Android's own system media control (the lock-screen/quick-settings "Now
            // Playing" card rendered directly from this session, on Android 11+) invokes
            // these callbacks directly — it does NOT go through the notification's own
            // addAction PendingIntents at all. Without this callback registered, that
            // system-rendered card's play/pause/stop buttons look real but silently do
            // nothing, which is exactly what was happening before this fix.
            setCallback(object : MediaSessionCompat.Callback() {
                override fun onPlay() = emitEvent("play")
                override fun onPause() = emitEvent("pause")
                override fun onStop() {
                    emitEvent("stop")
                    stopPlaybackService()
                }
                // Dragging the system card's seek bar — forward the target
                // position (ms) to Dart, which seeks the real controller.
                override fun onSeekTo(pos: Long) = emitEvent("seek:$pos")
            })
            isActive = true
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                title = intent.getStringExtra(EXTRA_TITLE) ?: "Pitflix"
                durationMs = intent.getLongExtra(EXTRA_DURATION, -1L)
                updateMetadata()
                updatePlaybackState(true, intent.getLongExtra(EXTRA_POSITION, 0L))
                startForeground(NOTIFICATION_ID, buildNotification(true))
            }
            ACTION_UPDATE_STATE -> {
                val isPlaying = intent.getBooleanExtra(EXTRA_IS_PLAYING, true)
                // Only present when it actually changed (e.g. moved to the next
                // video); -1 default means "keep the duration we already have".
                val newDuration = intent.getLongExtra(EXTRA_DURATION, -1L)
                if (newDuration >= 0L) {
                    durationMs = newDuration
                    updateMetadata()
                }
                updatePlaybackState(isPlaying, intent.getLongExtra(EXTRA_POSITION, 0L))
                startForeground(NOTIFICATION_ID, buildNotification(isPlaying))
            }
            ACTION_STOP -> stopPlaybackService()
            ACTION_TAP_PLAY -> emitEvent("play")
            ACTION_TAP_PAUSE -> emitEvent("pause")
            ACTION_TAP_STOP -> {
                emitEvent("stop")
                stopPlaybackService()
            }
        }
        return START_NOT_STICKY
    }

    private fun stopPlaybackService() {
        mediaSession?.isActive = false
        mediaSession?.release()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
    }

    private fun updatePlaybackState(isPlaying: Boolean, positionMs: Long) {
        val state = PlaybackStateCompat.Builder()
            .setActions(
                PlaybackStateCompat.ACTION_PLAY or
                    PlaybackStateCompat.ACTION_PAUSE or
                    PlaybackStateCompat.ACTION_STOP or
                    PlaybackStateCompat.ACTION_SEEK_TO,
            )
            .setState(
                if (isPlaying) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED,
                positionMs.coerceAtLeast(0L),
                // Real playback speed while playing (1x) lets the system card
                // animate the seek bar forward on its own between position
                // updates; 0 while paused freezes it where it is.
                if (isPlaying) 1f else 0f,
            )
            .build()
        mediaSession?.setPlaybackState(state)
    }

    private fun updateMetadata() {
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
        // A negative/zero duration makes the system card hide the seek bar; only
        // set it once we actually know it.
        if (durationMs > 0L) {
            builder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs)
        }
        mediaSession?.setMetadata(builder.build())
    }

    private fun pendingIntentFor(action: String): PendingIntent {
        val intent = Intent(this, PlaybackForegroundService::class.java).setAction(action)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        return PendingIntent.getService(this, action.hashCode(), intent, flags)
    }

    private fun buildNotification(isPlaying: Boolean): Notification {
        val playPauseAction = if (isPlaying) {
            NotificationCompat.Action(
                android.R.drawable.ic_media_pause,
                "Pause",
                pendingIntentFor(ACTION_TAP_PAUSE),
            )
        } else {
            NotificationCompat.Action(
                android.R.drawable.ic_media_play,
                "Play",
                pendingIntentFor(ACTION_TAP_PLAY),
            )
        }
        val stopAction = NotificationCompat.Action(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Stop",
            pendingIntentFor(ACTION_TAP_STOP),
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(if (isPlaying) "Playing" else "Paused")
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setOngoing(isPlaying)
            .addAction(playPauseAction)
            .addAction(stopAction)
            .setStyle(
                MediaStyle()
                    .setMediaSession(mediaSession?.sessionToken)
                    .setShowActionsInCompactView(0, 1),
            )
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOnlyAlertOnce(true)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Playback",
                NotificationManager.IMPORTANCE_LOW,
            ).apply { description = "Controls for video playing in the background" }
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }

    private fun emitEvent(event: String) {
        Handler(Looper.getMainLooper()).post { PlaybackEvents.sink?.success(event) }
    }

    override fun onDestroy() {
        mediaSession?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
