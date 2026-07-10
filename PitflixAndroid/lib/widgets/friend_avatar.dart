import 'package:flutter/material.dart';
import '../models/social_profile.dart';
import '../theme/app_theme.dart';
import 'poster_gradients.dart';

/// Gradient circle + initials — used everywhere a [SocialProfile] is shown
/// (list rows, profile header, activity feed).
class FriendAvatar extends StatelessWidget {
  final SocialProfile profile;
  final double size;

  const FriendAvatar({super.key, required this.profile, this.size = 48});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        gradient: PosterGradients.of(profile.gradientSeed),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        profile.initials,
        style: AppTextStyles.bebas(fontSize: size * 0.34, color: AppColors.accent),
      ),
    );
  }
}
