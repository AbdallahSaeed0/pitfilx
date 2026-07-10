import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Animated light-sweep over its child, used to dress up loading
/// placeholders so sections show moving skeleton cards instead of a bare
/// spinner.
class Shimmer extends StatefulWidget {
  final Widget child;

  const Shimmer({super.key, required this.child});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, child) => ShaderMask(
        blendMode: BlendMode.srcATop,
        shaderCallback: (bounds) {
          final t = _controller.value;
          return LinearGradient(
            begin: Alignment(-1.6 + t * 3.2, 0),
            end: Alignment(-0.6 + t * 3.2, 0),
            colors: const [
              AppColors.bgCard,
              Color(0xFF303030),
              AppColors.bgCard,
            ],
          ).createShader(bounds);
        },
        child: child,
      ),
      child: widget.child,
    );
  }
}

/// A single rounded placeholder block.
class ShimmerBox extends StatelessWidget {
  final double? width;
  final double height;
  final double radius;

  const ShimmerBox({
    super.key,
    this.width,
    required this.height,
    this.radius = 8,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}

/// Horizontal row of poster-sized placeholders, matching Home's poster rows.
class PosterRowSkeleton extends StatelessWidget {
  final double width;
  final double height;
  final int count;

  const PosterRowSkeleton({
    super.key,
    this.width = 110,
    this.height = 162,
    this.count = 4,
  });

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        itemCount: count,
        physics: const NeverScrollableScrollPhysics(),
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
        itemBuilder: (context, i) =>
            ShimmerBox(width: width, height: height, radius: 10),
      ),
    );
  }
}

/// Grid of poster-sized placeholders, matching List Detail's poster grid.
class PosterGridSkeleton extends StatelessWidget {
  final int count;

  const PosterGridSkeleton({super.key, this.count = 9});

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 3,
          crossAxisSpacing: 10,
          mainAxisSpacing: 10,
          childAspectRatio: 2 / 3,
        ),
        itemCount: count,
        itemBuilder: (context, i) =>
            ShimmerBox(height: double.infinity, radius: 10),
      ),
    );
  }
}

/// Stack of full-width, card-sized placeholder rows, matching Lists' rows.
class ListRowsSkeleton extends StatelessWidget {
  final int count;
  final double rowHeight;
  final EdgeInsets padding;

  const ListRowsSkeleton({
    super.key,
    this.count = 4,
    this.rowHeight = 68,
    this.padding = const EdgeInsets.fromLTRB(20, 16, 20, 20),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Shimmer(
        child: Column(
          children: [
            for (var i = 0; i < count; i++) ...[
              ShimmerBox(
                width: double.infinity,
                height: rowHeight,
                radius: AppSpacing.cardRadiusMax,
              ),
              if (i != count - 1) const SizedBox(height: 10),
            ],
          ],
        ),
      ),
    );
  }
}
