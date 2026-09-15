import 'package:flutter/material.dart';
import '../models/cast_member.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import 'filter_chip_pill.dart';
import 'poster_gradients.dart';
import 'pitflix_network_image.dart';

/// Overview + cast row + crew row + genre chips — shared by Title Detail (series
/// "About" tab and movie detail body).
class TitleAboutSection extends StatelessWidget {
  final String overview;
  final List<CastMember> cast;

  /// Director, writers, composer and so on — already merged one entry per person and ordered by
  /// role (see `TmdbService.fetchFullCredits`). Rendered with the same card as the cast, showing
  /// the job instead of the character.
  final List<CastMember> crew;

  final List<String> genres;
  final ValueChanged<CastMember>? onCastTap;

  /// Tapping a crew member opens the same person page as a cast member — TMDB treats both as
  /// people, so a director's page is just `/person/{id}` like an actor's.
  final ValueChanged<CastMember>? onCrewTap;

  const TitleAboutSection({
    super.key,
    required this.overview,
    required this.cast,
    required this.genres,
    this.crew = const [],
    this.onCastTap,
    this.onCrewTap,
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
          _PeopleRow(people: cast, onTap: onCastTap),
        ],
        if (crew.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sectionGap),
          Text('CREW', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 10),
          _PeopleRow(people: crew, onTap: onCrewTap),
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

/// Horizontal row of person cards — portrait, name, and the role beneath (character for cast, job
/// for crew, via [CastMember.roleLabel]).
class _PeopleRow extends StatelessWidget {
  final List<CastMember> people;
  final ValueChanged<CastMember>? onTap;

  const _PeopleRow({required this.people, this.onTap});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 168,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: people.length,
        separatorBuilder: (_, _) => const SizedBox(width: 12),
        itemBuilder: (context, i) {
          final member = people[i];
          final imageUrl = TmdbService.profileUrl(member.profilePath);
          final role = member.roleLabel;
          return GestureDetector(
            onTap: onTap == null ? null : () => onTap!(member),
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
                        ? PitflixNetworkImage(
                            imageUrl,
                            fit: BoxFit.cover,
                            width: 88,
                            height: 118,
                            errorBuilder: (context, error, stackTrace) => Text(
                              member.initials,
                              style: AppTextStyles.bebas(fontSize: 28),
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
                  if (role != null)
                    Text(
                      role,
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
    );
  }
}
