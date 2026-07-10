import 'dart:async';
import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// "PITFLIX" wordmark that animates in letter-by-letter (slide up + fade),
/// per the original design spec. Used on the Splash screen and Login.
class AnimatedWordmark extends StatefulWidget {
  final double fontSize;
  final bool loop;

  const AnimatedWordmark({super.key, this.fontSize = 52, this.loop = false});

  @override
  State<AnimatedWordmark> createState() => _AnimatedWordmarkState();
}

class _AnimatedWordmarkState extends State<AnimatedWordmark>
    with SingleTickerProviderStateMixin {
  static const _word = 'PITFLIX';

  late final AnimationController _controller;
  Timer? _loopTimer;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: 500 + _word.length * 90),
    );
    _controller.forward();
    if (widget.loop) {
      _controller.addStatusListener(_onStatus);
    }
  }

  void _onStatus(AnimationStatus status) {
    if (status != AnimationStatus.completed) return;
    // Short pause — long enough to read as a beat, not so long it reads as
    // the animation having stopped (which a lingering static gap would, in
    // Splash's short on-screen window especially).
    _loopTimer = Timer(const Duration(milliseconds: 400), () {
      if (mounted) _controller.forward(from: 0);
    });
  }

  @override
  void dispose() {
    _loopTimer?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // FittedBox guards against overflow on very narrow widths (small/split-
    // screen devices) — the Row below has no Expanded/Flexible children and
    // won't wrap on its own otherwise.
    return FittedBox(
      fit: BoxFit.scaleDown,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [for (var i = 0; i < _word.length; i++) _buildLetter(i)],
      ),
    );
  }

  Widget _buildLetter(int index) {
    final slotCount = _word.length + 2;
    final start = (index / slotCount).clamp(0.0, 1.0);
    final end = ((index + 3) / slotCount).clamp(0.0, 1.0);
    final animation = CurvedAnimation(
      parent: _controller,
      curve: Interval(start, end, curve: Curves.easeOutCubic),
    );
    return AnimatedBuilder(
      animation: animation,
      builder: (context, child) => Opacity(
        opacity: animation.value,
        child: Transform.translate(
          offset: Offset(0, (1 - animation.value) * 18),
          child: child,
        ),
      ),
      child: Text(
        _word[index],
        style: AppTextStyles.bebas(
          fontSize: widget.fontSize,
          color: AppColors.logoAccent,
          letterSpacing: 0.1,
        ),
      ),
    );
  }
}
