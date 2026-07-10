import 'package:flutter/material.dart';
import '../models/cast_member.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import 'filter_chip_pill.dart';
import 'poster_gradients.dart';

/// Overview + cast row + genre chips — shared by Title Detail (series
/// "About" tab and movie detail body).
class TitleAboutSection extends StatelessWidget {
  final String overview;
  final List<CastMember> cast;
  final List<String> genres;
  final ValueChanged<CastMember>? onCastTap;

  const TitleAboutSection({
    super.key,
    required this.overview,
    required this.cast,
    required this.genres,
    this.onCastTap,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          overview,
          style: AppTextStyles.dmSans(
            fontSize: 13,
            height: 1.65,
            color: Colors.white.withValues(alpha: 0.7),
          ),
        ),
        if (cast.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sectionGap),
          Text('CAST', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 10),
          SizedBox(
            height: 168,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: cast.length,
              separatorBuilder: (_, _) => const SizedBox(width: 12),
              itemBuilder: (context, i) {
                final member = cast[i];
                final imageUrl = TmdbService.profileUrl(member.profilePath);
                return GestureDetector(
                  onTap: onCastTap == null ? null : () => onCastTap!(member),
                  child: SizedBox(
                    width: 88,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 88,
                          height: 118,
                          clipBehavior: Clip.antiAlias,
                          decoration: BoxDecoration(
                            gradient: PosterGradients.of(member.gradientSeed),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          alignment: Alignment.center,
                          child: imageUrl != null
                              ? Image.network(
                                  imageUrl,
                                  fit: BoxFit.cover,
                                  width: 88,
                                  height: 118,
                                  errorBuilder: (context, error, stackTrace) =>
                                      Text(
                                        member.initials,
                                        style: AppTextStyles.bebas(
                                          fontSize: 28,
                                        ),
                                      ),
                                )
                              : Text(
                                  member.initials,
                                  style: AppTextStyles.bebas(fontSize: 28),
                                ),
                        ),
                        const SizedBox(height: 6),
                        Text(
                          member.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.dmSans(
                            fontSize: 10,
                            fontWeight: FontWeight.w600,
                            color: Colors.white.withValues(alpha: 0.85),
                          ),
                        ),
                        if (member.character != null)
                          Text(
                            member.character!,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.dmSans(
                              fontSize: 9,
                              color: AppColors.textMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.sectionGap),
        Text('GENRES', style: AppTextStyles.sectionLabel()),
        const SizedBox(height: 10),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [for (final g in genres) GenreChip(label: g)],
        ),
      ],
    );
  }
}
