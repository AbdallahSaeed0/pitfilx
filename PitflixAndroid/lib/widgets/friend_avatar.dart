import 'package:flutter/material.dart';
import '../models/social_profile.dart';
import '../theme/app_theme.dart';
import 'poster_gradients.dart';
import 'pitflix_network_image.dart';

/// That friend's real `avatar_url` photo when set, else a gradient circle +
/// initials — used everywhere a [SocialProfile] is shown (list rows, profile
/// header, activity feed).
class FriendAvatar extends StatelessWidget {
  final SocialProfile profile;
  final double size;

  const FriendAvatar({super.key, required this.profile, this.size = 48});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        gradient: PosterGradients.of(profile.gradientSeed),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: profile.avatarUrl != null
          ? PitflixNetworkImage(
              profile.avatarUrl!,
              fit: BoxFit.cover,
              width: size,
              height: size,
              errorBuilder: (context, error, stackTrace) => Text(
                profile.initials,
                style: AppTextStyles.bebas(
                  fontSize: size * 0.34,
                  color: AppColors.accent,
                ),
              ),
            )
          : Text(
              profile.initials,
              style: AppTextStyles.bebas(
                fontSize: size * 0.34,
                color: AppColors.accent,
              ),
            ),
    );
  }
}
