import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

/// Drop-in replacement for [Image.network] that caches to disk.
///
/// Flutter's [Image.network] only ever caches decoded frames in the in-memory [ImageCache], which is
/// capped (~100 MB / 1000 entries), evicted under memory pressure, and gone the moment the process
/// dies. On Android the OS reclaims backgrounded apps constantly, so in practice every poster,
/// backdrop, still and avatar was re-downloaded from TMDB on each cold start — which is most of why
/// the app felt slower than other catalogue apps, none of which re-fetch artwork they've already seen.
///
/// [CachedNetworkImage] was already a dependency but only [PosterCard] used it. This wrapper mirrors
/// the slice of `Image.network`'s API the app actually uses so call sites stay as they were, and
/// adapts `errorBuilder` to the `errorWidget` shape underneath.
class PitflixNetworkImage extends StatelessWidget {
  final String url;
  final BoxFit? fit;
  final double? width;
  final double? height;

  /// Same signature as [Image.network]'s `errorBuilder`. The stack trace is always null here — the
  /// underlying loader reports an error object without one — but it's kept so existing callbacks
  /// compile untouched.
  final Widget Function(BuildContext context, Object error, StackTrace? stackTrace)? errorBuilder;

  /// Shown while the image is in flight. Defaults to a plain transparent box: most call sites sit on
  /// top of a gradient or coloured container that already reads as a placeholder.
  final Widget? placeholder;

  const PitflixNetworkImage(
    this.url, {
    super.key,
    this.fit,
    this.width,
    this.height,
    this.errorBuilder,
    this.placeholder,
  });

  @override
  Widget build(BuildContext context) {
    return CachedNetworkImage(
      imageUrl: url,
      fit: fit,
      width: width,
      height: height,
      // Decode to the display size rather than the source size. A w342 poster drawn into a ~110 px
      // grid cell otherwise allocates the full-resolution bitmap for every visible card.
      memCacheWidth: _cacheWidth(context),
      fadeInDuration: const Duration(milliseconds: 150),
      placeholder: placeholder == null ? null : (context, _) => placeholder!,
      errorWidget: errorBuilder == null
          ? null
          : (context, _, error) => errorBuilder!(context, error, null),
    );
  }

  /// Target decode width in device pixels, or null when the widget has no fixed width (the parent
  /// sizes it, so we can't know better than the source).
  int? _cacheWidth(BuildContext context) {
    final w = width;
    if (w == null || !w.isFinite || w <= 0) return null;
    return (w * MediaQuery.devicePixelRatioOf(context)).round();
  }
}
