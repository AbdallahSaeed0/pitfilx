import 'package:flutter/material.dart';
import '../models/friend.dart';
import '../theme/app_theme.dart';
import 'poster_gradients.dart';

/// Gradient circle + initials + online dot — used everywhere a [Friend] is
/// shown (list rows, profile header, activity feed).
class FriendAvatar extends StatelessWidget {
  final Friend friend;
  final double size;

  const FriendAvatar({super.key, required this.friend, this.size = 48});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: size,
            height: size,
            decoration: BoxDecoration(
              gradient: PosterGradients.of(friend.gradientSeed),
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              friend.initials,
              style: AppTextStyles.bebas(
                fontSize: size * 0.34,
                color: AppColors.accent,
              ),
            ),
          ),
          if (friend.isOnline)
            Positioned(
              right: -1,
              bottom: -1,
              child: Container(
                width: size * 0.28,
                height: size * 0.28,
                decoration: BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.bgBase, width: 2),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
