import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/actor.dart';
import '../models/cast_member.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Actor detail — either the app's mock [Actor] data, or a real cast member
/// backed by the local Pitflix.API's `/api/people/{tmdbId}` (same data the
/// desktop app's actor page shows: bio, birthday, filmography).
class ActorScreen extends StatefulWidget {
  final Actor? actor;
  final CastMember? castMember;

  const ActorScreen.mock({super.key, required this.actor}) : castMember = null;

  const ActorScreen.real({super.key, required this.castMember}) : actor = null;

  @override
  State<ActorScreen> createState() => _ActorScreenState();
}

class _ActorScreenState extends State<ActorScreen> {
  Map<String, dynamic>? _person;
  bool _loading = false;
  bool _failed = false;

  bool get _isReal => widget.castMember != null;

  @override
  void initState() {
    super.initState();
    final personId = widget.castMember?.tmdbPersonId;
    if (personId != null) {
      _loading = true;
      LocalBackendService.fetchPerson(personId).then((data) {
        if (!mounted) return;
        setState(() {
          _person = data;
          _loading = false;
          _failed = data == null;
        });
      });
    }
  }

  void _openTitle(TitleItem title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => title.isShow
            ? TitleDetailSeriesScreen(title: title)
            : TitleDetailMovieScreen(title: title),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return _isReal ? _buildReal(context) : _buildMock(context);
  }

  // ── mock path ────────────────────────────────────────────────────────────

  Widget _buildMock(BuildContext context) {
    final actor = widget.actor!;
    final filmography = MockData.byIds(actor.filmographyTitleIds);
    return _scaffold(
      name: actor.name,
      subtitle: '${actor.birthDate} · ${actor.birthPlace}',
      initials: actor.initials,
      imageUrl: null,
      body: [
        Text(
          actor.bio,
          style: AppTextStyles.dmSans(
            fontSize: 13,
            height: 1.65,
            color: Colors.white.withValues(alpha: 0.65),
          ),
        ),
        const SizedBox(height: AppSpacing.sectionGap),
        Text('FILMOGRAPHY', style: AppTextStyles.sectionLabel()),
        const SizedBox(height: 12),
        _filmographyGrid(
          filmography
              .map(
                (t) => (
                  name: t.name,
                  gradientSeed: t.gradientSeed,
                  imageUrl: null,
                  onTap: () => _openTitle(t),
                ),
              )
              .toList(),
        ),
      ],
    );
  }

  // ── real (backend-backed) path ──────────────────────────────────────────

  Widget _buildReal(BuildContext context) {
    final member = widget.castMember!;
    final person = _person?['person'] as Map<String, dynamic>?;
    final name = person?['name'] as String? ?? member.name;
    final bio = person?['biography'] as String?;
    final birthday = person?['birthday'] as String?;
    final placeOfBirth = person?['placeOfBirth'] as String?;
    final subtitleParts = [
      if (birthday != null && birthday.isNotEmpty) birthday,
      if (placeOfBirth != null && placeOfBirth.isNotEmpty) placeOfBirth,
    ];
    // Backend may return a full HTTPS URL or a raw TMDB path — only use
    // the backend value when it's a real network URL, otherwise fall through
    // to the TMDB path from credits.
    final fromBackend = person?['profileImageUrl'] as String?;
    final rawTmdbPath = person?['profilePath'] as String?;
    final imageUrl =
        (fromBackend != null && fromBackend.startsWith('http'))
            ? TmdbService.profileUrl(fromBackend)
            : (rawTmdbPath != null
                  ? TmdbService.profileUrl(rawTmdbPath)
                  : null) ??
              TmdbService.profileUrl(member.profilePath);
    final knownFor = (person?['knownFor'] as List? ?? [])
        .cast<Map<String, dynamic>>();

    return _scaffold(
      name: name,
      subtitle: subtitleParts.isEmpty ? member.character : subtitleParts.join(' · '),
      initials: member.initials,
      imageUrl: imageUrl,
      body: [
        if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: CircularProgressIndicator(color: AppColors.logoAccent),
            ),
          )
        else if (_failed)
          Text(
            "Couldn't load full bio — showing what's available.",
            style: AppTextStyles.dmSans(
              fontSize: 12,
              color: AppColors.textMuted,
            ),
          )
        else if (bio != null && bio.isNotEmpty)
          Text(
            bio,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              height: 1.65,
              color: Colors.white.withValues(alpha: 0.65),
            ),
          ),
        if (knownFor.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sectionGap),
          Text('FILMOGRAPHY', style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 12),
          _filmographyGrid(
            knownFor.map((k) {
              final mediaTmdbId = (k['mediaTmdbId'] as num?)?.toInt() ?? 0;
              final kind = TmdbService.kindFromMediaType(
                k['mediaType'] as String? ?? 'movie',
              );
              final title = k['title'] as String? ?? 'Untitled';
              final posterPath = k['posterPath'] as String?;
              return (
                name: title,
                gradientSeed: mediaTmdbId % 6,
                imageUrl: TmdbService.posterUrl(posterPath),
                onTap: () => _openTitle(
                  TitleItem(
                    id: 'tmdb-$mediaTmdbId-${kind.name}',
                    name: title,
                    kind: kind,
                    year: 0,
                    network: kind == TitleKind.movie ? 'Theaters' : 'TV',
                    rating: 0,
                    genres: const [],
                    overview: '',
                    gradientSeed: mediaTmdbId % 6,
                    posterPath: posterPath,
                    tmdbId: mediaTmdbId,
                    isSummaryOnly: true,
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ],
    );
  }

  // ── shared filmography grid ──────────────────────────────────────────────

  Widget _filmographyGrid(
    List<
      ({String name, int gradientSeed, String? imageUrl, VoidCallback onTap})
    >
    items,
  ) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2 / 3,
      ),
      itemCount: items.length,
      itemBuilder: (context, i) {
        final item = items[i];
        return PosterCard(
          title: item.name,
          gradientSeed: item.gradientSeed,
          imageUrl: item.imageUrl,
          onTap: item.onTap,
        );
      },
    );
  }

  // ── shared chrome ────────────────────────────────────────────────────────

  Widget _scaffold({
    required String name,
    required String? subtitle,
    required String initials,
    required String? imageUrl,
    required List<Widget> body,
  }) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            // Header: back button + portrait + name
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  CircleIconButton(
                    icon: Icons.arrow_back_ios_new,
                    background: AppColors.bgCard,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 14),
                  // Portrait
                  Container(
                    width: 56,
                    height: 76,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: AppColors.avatarBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppColors.borderInput,
                        width: 1.5,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: imageUrl != null
                        ? Image.network(
                            imageUrl,
                            fit: BoxFit.cover,
                            width: 56,
                            height: 76,
                            errorBuilder: (context, err, st) => Text(
                              initials,
                              style: AppTextStyles.bebas(
                                fontSize: 22,
                                color: AppColors.logoAccent,
                              ),
                            ),
                          )
                        : Text(
                            initials,
                            style: AppTextStyles.bebas(
                              fontSize: 22,
                              color: AppColors.logoAccent,
                            ),
                          ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          name.toUpperCase(),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.bebas(
                            fontSize: 24,
                            letterSpacing: 0.08,
                            color: AppColors.logoAccent,
                          ),
                        ),
                        if (subtitle != null && subtitle.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.dmSans(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                children: body,
              ),
            ),
            const PushedScreenBottomNav(active: MainTab.discover),
          ],
        ),
      ),
    );
  }
}
