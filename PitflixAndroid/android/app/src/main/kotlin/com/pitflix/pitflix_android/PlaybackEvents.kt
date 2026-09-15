package com.pitflix.pitflix_android

import io.flutter.plugin.common.EventChannel

/**
 * Bridges native → Dart events that don't originate from an Activity method call — a
 * notification button tap (PlaybackForegroundService) or a system PiP transition
 * (MainActivity.onPictureInPictureModeChanged) — into whichever EventChannel stream Dart is
 * currently listening to. A plain top-level singleton (not a MainActivity field) because
 * PlaybackForegroundService is a separate Service instance in the same process and has no
 * reference to the current Activity.
 */
object PlaybackEvents {
    var sink: EventChannel.EventSink? = null
}

object PipEvents {
    var sink: EventChannel.EventSink? = null
}
