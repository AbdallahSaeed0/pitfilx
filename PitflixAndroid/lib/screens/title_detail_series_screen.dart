import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/cast_member.dart';
import '../models/episode.dart';
import '../models/season.dart';
import '../models/social_activity_item.dart';
import '../models/title_item.dart';
import '../services/ratings_service.dart';
import '../services/session_stats_store.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/favorites.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/widgets.dart';
import 'actor_screen.dart';
import '../widgets/pitflix_network_image.dart';

class TitleDetailSeriesScreen extends StatefulWidget {
  final TitleItem title;

  const TitleDetailSeriesScreen({super.key, required this.title});

  @override
  State<TitleDetailSeriesScreen> createState() =>
      _TitleDetailSeriesScreenState();
}

class _TitleDetailSeriesScreenState extends State<TitleDetailSeriesScreen> {
  int _tab = 0; // 0 Episodes, 1 About
  int? _expandedSeason;
  TitleItem? _enriched;
  Map<String, dynamic>? _ratings;

  /// True while the full TMDB detail lookup (episodes/cast/overview) is in
  /// flight — drives the loading skeleton below so a first open (or any
  /// open TMDB hasn't answered yet for) reads as "loading", not blank.
  /// Mirrors initState's own `shouldEnrich` condition.
  late bool _enriching =
      widget.title.needsDetailEnrichment ||
      (widget.title.seasons.isEmpty &&
          widget.title.tmdbId != null &&
          widget.title.tmdbId! > 0);

  /// Local overrides on top of the TMDB-sourced seasons (episode watch
  /// status/libraryId merged in, plus any in-session rating/rewatch/watched
  /// edits from the episode popup) — null until the first override happens,
  /// at which point it takes over from `t.seasons` entirely.
  List<Season>? _seasonsOverride;

  String? _favoritesListId;
  bool? _isFavorite;

  // Per-account custom poster/backdrop — see the movie screen's identical
  // fields for why these are re-applied on top of `_enriched` independently
  // of whichever async fetch (TMDB enrichment vs. Supabase) resolves last.
  String? _customPosterPath;
  String? _customBackdropPath;

  @override
  void initState() {
    super.initState();
    final inProgress = widget.title.seasons.where((s) => s.isInProgress);
    _expandedSeason = inProgress.isNotEmpty ? inProgress.first.number : null;
    // Real (TMDB-only) titles have no season/episode data yet — land on the
    // About tab instead of an empty Episodes list.
    if (widget.title.seasons.isEmpty) {
      _tab = 1;
    }
    final shouldEnrich =
        widget.title.needsDetailEnrichment ||
        (widget.title.seasons.isEmpty &&
            widget.title.tmdbId != null &&
            widget.title.tmdbId! > 0);
    if (shouldEnrich) {
      TmdbService.fetchDetails(widget.title.tmdbId!, TitleKind.show).then((
        full,
      ) {
        if (!mounted) return;
        if (full == null) {
          setState(() => _enriching = false);
          return;
        }
        setState(() {
          _enriched = _applyCustomArtwork(full);
          _enriching = false;
          if (full.seasons.isNotEmpty) {
            _tab = 0;
            _expandedSeason ??= full.seasons.first.number;
          }
        });
        _mergeWatchedEpisodes(full.seasons);
      });
    } else {
      _mergeWatchedEpisodes(widget.title.seasons);
    }
    if (widget.title.tmdbId != null) {
      _loadFavorite();
      _loadCustomArtwork();
      RatingsService.fetch(
        widget.title.tmdbId!,
        TitleKind.show,
        widget.title.rating,
      ).then((data) {
        if (mounted) setState(() => _ratings = data);
      });
    }
  }

  Future<void> _loadCustomArtwork() async {
    try {
      final row = await UserLibraryService.fetchCustomArtwork(
        widget.title.tmdbId!,
        'series',
      );
      if (!mounted || row == null) return;
      _customPosterPath = row['custom_poster_path'] as String?;
      _customBackdropPath = row['custom_backdrop_path'] as String?;
      setState(
        () => _enriched = _applyCustomArtwork(_enriched ?? widget.title),
      );
    } catch (_) {
      // Custom artwork is decorative — falls back to the TMDB default.
    }
  }

  TitleItem _applyCustomArtwork(TitleItem t) => t.copyWith(
    posterPath: _customPosterPath,
    backdropPath: _customBackdropPath,
  );

  Future<void> _loadFavorite() async {
    try {
      final listId = await findFavoritesListId();
      if (listId == null || !mounted) return;
      final isFav = await UserLibraryService.isInList(
        listId,
        widget.title.tmdbId!,
        'series',
      );
      if (!mounted) return;
      setState(() {
        _favoritesListId = listId;
        _isFavorite = isFav;
      });
    } catch (_) {
      // Decorative — heart button just stays hidden if this fails.
    }
  }

  Future<void> _toggleFavorite() async {
    final listId = _favoritesListId;
    final tmdbId = widget.title.tmdbId;
    if (listId == null || tmdbId == null || _isFavorite == null) return;
    final newValue = !_isFavorite!;
    setState(() => _isFavorite = newValue);
    try {
      if (newValue) {
        final t = _enriched ?? widget.title;
        await UserLibraryService.addToList(
          listId,
          tmdbId: tmdbId,
          mediaType: 'series',
          title: t.name,
          posterPath: t.posterPath,
        );
        SocialService.logActivity(
          action: SocialActivityAction.addedToFavorites,
          tmdbId: tmdbId,
          mediaType: 'series',
          title: t.name,
          posterPath: t.posterPath,
        );
      } else {
        await UserLibraryService.removeFromList(listId, tmdbId, 'series');
      }
    } catch (e) {
      if (!mounted) return;
      setState(() => _isFavorite = !newValue);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't update favorite: $e")));
    }
  }

  /// Cross-references TMDB-sourced [seasons] against this account's real
  /// per-episode watch status (keyed by TMDB show id + season/episode
  /// number — see UserLibraryService.fetchEpisodeWatchStatuses).
  Future<void> _mergeWatchedEpisodes(List<Season> seasons) async {
    final tmdbId = widget.title.tmdbId;
    if (tmdbId == null || seasons.isEmpty) return;
    try {
      final watchStatuses = await UserLibraryService.fetchEpisodeWatchStatuses(
        tmdbId,
      );
      if (watchStatuses.isEmpty || !mounted) return;
      setState(() {
        _seasonsOverride = seasons.map((season) {
          var updated = season;
          for (final ep in season.episodes) {
            final rewatchCount = watchStatuses['${season.number}-${ep.number}'];
            if (rewatchCount == null) continue;
            updated = updated.replaceEpisode(
              ep.number,
              (e) => e.copyWith(watched: true, rewatchCount: rewatchCount),
            );
          }
          return updated;
        }).toList();
      });
    } catch (_) {
      // Decorative enhancement only — episodes still show fine without it,
      // just without real watched-status persistence.
    }
  }

  /// Logs a real activity_events row for the whole series (not the
  /// individual episode) — matches how the desktop/other-friends' feeds
  /// think about "watched"/"rated" a show. Also upserts the account's
  /// watch_records row (Stats source data).
  void _logEpisodeActivity(Episode updated) {
    final tmdbId = widget.title.tmdbId;
    if (tmdbId == null) return;
    final t = _enriched ?? widget.title;
    SocialService.logActivity(
      action: updated.rating != null
          ? SocialActivityAction.rated
          : SocialActivityAction.watched,
      tmdbId: tmdbId,
      mediaType: 'series',
      title: t.name,
      posterPath: t.posterPath,
      rating: updated.rating,
    );
    UserLibraryService.logWatched(
      tmdbId: tmdbId,
      mediaType: 'series',
      title: t.name,
      posterPath: t.posterPath,
      genres: t.genres,
      releaseYear: t.year > 0 ? t.year : null,
      rating: updated.rating,
      estimatedMinutes: updated.durationMinutes,
      status: 'watching',
    );
  }

  void _onEpisodeUpdated(Season season, Episode updated) {
    final original = season.episodes.firstWhere(
      (e) => e.number == updated.number,
    );
    final tmdbId = widget.title.tmdbId;
    if (updated.watched != original.watched) {
      if (tmdbId != null) {
        UserLibraryService.setEpisodeWatched(
          tmdbId,
          season.number,
          updated.number,
          watched: updated.watched,
        );
      }
    }
    if (updated.rewatchCount != original.rewatchCount) {
      if (tmdbId != null) {
        UserLibraryService.setEpisodeRewatchCount(
          tmdbId,
          season.number,
          updated.number,
          updated.rewatchCount,
        );
      }
    }
    setState(() {
      final base = _seasonsOverride ?? (_enriched ?? widget.title).seasons;
      _seasonsOverride = base
          .map(
            (s) => s.number == season.number
                ? s.replaceEpisode(updated.number, (_) => updated)
                : s,
          )
          .toList();
    });
  }

  /// Upserts this show's `watch_records` row with `status: 'watching'` —
  /// without this, shows progressed via the quick mark-watched controls
  /// (rather than the episode rating sheet, which already does this via
  /// [_logEpisodeActivity]) never get a `watch_records` row at all, so they
  /// can never appear in Home's Currently Watching list even though the
  /// account has clearly started them.
  void _markShowWatching() {
    final tmdbId = widget.title.tmdbId;
    if (tmdbId == null) return;
    final t = _enriched ?? widget.title;
    UserLibraryService.logWatched(
      tmdbId: tmdbId,
      mediaType: 'series',
      title: t.name,
      posterPath: t.posterPath,
      genres: t.genres,
      releaseYear: t.year > 0 ? t.year : null,
      status: 'watching',
    );
  }

  /// Marks a single episode watched — persists to this account.
  Future<void> _markEpisodeWatched(Season season, Episode episode) async {
    final tmdbId = widget.title.tmdbId;
    if (tmdbId != null) {
      try {
        await UserLibraryService.setEpisodeWatched(
          tmdbId,
          season.number,
          episode.number,
          watched: true,
        );
        _markShowWatching();
      } catch (_) {
        // Best-effort — still reflect the change locally below.
      }
    }
    if (!mounted) return;
    _onEpisodeUpdated(season, episode.copyWith(watched: true));
  }

  /// Marks every episode in [season] watched in one go — persists each in
  /// parallel, then applies the result locally.
  Future<void> _markSeasonWatched(Season season) async {
    final tmdbId = widget.title.tmdbId;
    final toMark = season.episodes.where((e) => !e.watched).toList();
    if (tmdbId != null && toMark.isNotEmpty) {
      try {
        await Future.wait(
          toMark.map(
            (e) => UserLibraryService.setEpisodeWatched(
              tmdbId,
              season.number,
              e.number,
              watched: true,
            ),
          ),
        );
        _markShowWatching();
      } catch (_) {
        // Best-effort — still reflect the change locally below.
      }
    }
    if (!mounted) return;
    setState(() {
      final base = _seasonsOverride ?? (_enriched ?? widget.title).seasons;
      _seasonsOverride = base
          .map(
            (s) => s.number != season.number
                ? s
                : Season(
                    number: s.number,
                    name: s.name,
                    episodes: s.episodes
                        .map((e) => e.copyWith(watched: true))
                        .toList(),
                  ),
          )
          .toList();
    });
  }

  /// Scans [seasons] in order for the first unwatched episode — drives the
  /// dynamic "Continue Tracking" card instead of a static mock field.
  ({Season season, Episode episode})? _findNextUnwatched(List<Season> seasons) {
    for (final season in seasons) {
      for (final ep in season.episodes) {
        if (!ep.watched) return (season: season, episode: ep);
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final t = _enriched ?? widget.title;
    final seasons = _seasonsOverride ?? t.seasons;
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            TitleHeroHeader(
              title: t.name,
              metaLine:
                  '${t.year} · ${t.seasons.length} Seasons · ${t.network}',
              rating: t.rating,
              gradientSeed: t.gradientSeed,
              imageUrl: TmdbService.backdropUrl(t.backdropPath),
              posterUrl: TmdbService.posterUrl(t.posterPath),
              isFavorite: _isFavorite,
              onFavoriteToggled: _toggleFavorite,
              onMorePressed: () => showTitleActionsSheet(
                context,
                t,
                (updated) => setState(() => _enriched = updated),
              ),
            ),
            SegmentedTabBar(
              tabs: const ['Episodes', 'About'],
              activeIndex: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Ratings land from their own MDBList fetch after the
                    // page is already up; revealing them via [_RevealSection]
                    // animates the layout open instead of hard-popping the row
                    // in and shoving the tab content down.
                    _RevealSection(
                      visible: _ratings != null,
                      child: _ratings == null
                          ? const SizedBox.shrink()
                          : Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                RatingsRow(ratings: _ratings!),
                                const SizedBox(height: 18),
                              ],
                            ),
                    ),
                    AnimatedSwitcher(
                      duration: const Duration(milliseconds: 200),
                      transitionBuilder: (child, anim) =>
                          FadeTransition(opacity: anim, child: child),
                      child: _enriching
                          ? const KeyedSubtree(
                              key: ValueKey('loading'),
                              child: _DetailLoadingSkeleton(),
                            )
                          : KeyedSubtree(
                              key: ValueKey(_tab),
                              child: _tab == 0
                                  ? _buildEpisodesTab(t, seasons)
                                  : _buildAboutTab(t),
                            ),
                    ),
                  ],
                ),
              ),
            ),
            const PushedScreenBottomNav(active: MainTab.discover),
          ],
        ),
      ),
    );
  }

  Widget _buildEpisodesTab(TitleItem t, List<Season> seasons) {
    final unreleased = t.isUnreleased;
    final next = unreleased ? null : _findNextUnwatched(seasons);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (unreleased) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
            ),
            child: Text(
              'COMING SOON',
              textAlign: TextAlign.center,
              style: AppTextStyles.bebas(
                fontSize: 18,
                letterSpacing: 0.1,
                color: AppColors.textSecondary,
              ),
            ),
          ),
          const SizedBox(height: 18),
        ],
        if (next != null) ...[
          _ContinueTrackingCard(
            episodeLabel:
                'S${next.season.number} · E${next.episode.number} — ${next.episode.title}',
            durationLabel: '${next.episode.durationMinutes} min',
            onTap: () async {
              final updated = await showEpisodeActionsSheet(
                context,
                episode: next.episode,
                label: 'S${next.season.number} · E${next.episode.number}',
                cast: t.cast,
              );
              if (updated != null) {
                SessionStatsStore.logRating(updated.rating, null, isShow: true);
                SessionStatsStore.logReaction(updated.reaction, isShow: true);
                _logEpisodeActivity(updated);
                _onEpisodeUpdated(next.season, updated);
              }
            },
            onMarkWatched: () => _markEpisodeWatched(next.season, next.episode),
          ),
          const SizedBox(height: 18),
        ],
        for (final season in seasons)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _SeasonCard(
              season: season,
              expanded: _expandedSeason == season.number,
              onToggle: () => setState(() {
                _expandedSeason = _expandedSeason == season.number
                    ? null
                    : season.number;
              }),
              onEpisodeTap: unreleased
                  ? null
                  : (ep) async {
                      final updated = await showEpisodeActionsSheet(
                        context,
                        episode: ep,
                        label: 'S${season.number} · E${ep.number}',
                        cast: t.cast,
                      );
                      if (updated != null) {
                        SessionStatsStore.logRating(
                          updated.rating,
                          null,
                          isShow: true,
                        );
                        SessionStatsStore.logReaction(
                          updated.reaction,
                          isShow: true,
                        );
                        _logEpisodeActivity(updated);
                        _onEpisodeUpdated(season, updated);
                      }
                    },
              onMarkAllWatched: unreleased || season.isComplete
                  ? null
                  : () => _markSeasonWatched(season),
            ),
          ),
      ],
    );
  }

  Widget _buildAboutTab(TitleItem t) {
    return TitleAboutSection(
      overview: t.overview,
      cast: t.cast.isNotEmpty
          ? t.cast
          : t.castActorIds
                .map(MockData.actorById)
                .map(CastMember.fromMockActor)
                .toList(),
      crew: t.crew,
      genres: t.genres,
      onCastTap: (member) => _openActor(context, member),
      onCrewTap: (member) => _openActor(context, member),
    );
  }
}

/// Smoothly reveals a section that arrives asynchronously (the ratings row)
/// rather than hard-popping it into the layout and shoving the tab content
/// down. Height animates from zero and the content fades in together; while
/// [visible] is false it occupies no vertical space.
class _RevealSection extends StatelessWidget {
  final bool visible;
  final Widget child;

  const _RevealSection({required this.visible, required this.child});

  @override
  Widget build(BuildContext context) {
    return AnimatedSize(
      duration: const Duration(milliseconds: 240),
      curve: Curves.easeOutCubic,
      alignment: Alignment.topCenter,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 240),
        opacity: visible ? 1 : 0,
        child: visible
            ? child
            : const SizedBox(width: double.infinity, height: 0),
      ),
    );
  }
}

/// Shown in place of the Episodes/About tab content while TMDB's full
/// detail lookup (seasons/cast/overview) is still in flight — makes a slow
/// first open read as "loading" instead of an empty-looking page.
class _DetailLoadingSkeleton extends StatelessWidget {
  const _DetailLoadingSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Loading details…',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
        const SizedBox(height: 12),
        const ListRowsSkeleton(
          count: 4,
          rowHeight: 64,
          padding: EdgeInsets.zero,
        ),
      ],
    );
  }
}

void _openActor(BuildContext context, CastMember member) {
  Navigator.of(context).push(
    MaterialPageRoute(
      builder: (_) => member.tmdbPersonId != null
          ? ActorScreen.real(castMember: member)
          : ActorScreen.mock(actor: MockData.actorById(member.mockActorId!)),
    ),
  );
}

class _ContinueTrackingCard extends StatefulWidget {
  final String episodeLabel;
  final String durationLabel;
  final VoidCallback onTap;
  final VoidCallback onMarkWatched;

  const _ContinueTrackingCard({
    required this.episodeLabel,
    required this.durationLabel,
    required this.onTap,
    required this.onMarkWatched,
  });

  @override
  State<_ContinueTrackingCard> createState() => _ContinueTrackingCardState();
}

class _ContinueTrackingCardState extends State<_ContinueTrackingCard> {
  bool _marking = false;

  Future<void> _handleMark() async {
    setState(() => _marking = true);
    widget.onMarkWatched();
    if (mounted) setState(() => _marking = false);
  }

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: widget.onTap,
      borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.bgCard,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                gradient: PosterGradients.of(1),
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: const Icon(
                Icons.play_arrow_rounded,
                color: AppColors.accent,
                size: 18,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'CONTINUE TRACKING',
                    style: AppTextStyles.sectionLabel(),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    widget.episodeLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  Text(
                    widget.durationLabel,
                    style: AppTextStyles.dmSans(
                      fontSize: 11,
                      color: Colors.white.withValues(alpha: 0.45),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            GestureDetector(
              onTap: _marking ? null : _handleMark,
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: 14,
                  vertical: 8,
                ),
                decoration: BoxDecoration(
                  color: AppColors.buttonPurple,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: _marking
                    ? const SizedBox(
                        width: 14,
                        height: 14,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.textPrimary,
                        ),
                      )
                    : Text(
                        'Mark',
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeasonCard extends StatelessWidget {
  final Season season;
  final bool expanded;
  final VoidCallback onToggle;
  final ValueChanged<Episode>? onEpisodeTap;

  /// Null hides the "Mark All" action (season is already complete).
  final VoidCallback? onMarkAllWatched;

  const _SeasonCard({
    required this.season,
    required this.expanded,
    required this.onToggle,
    required this.onEpisodeTap,
    this.onMarkAllWatched,
  });

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
      child: DecoratedBox(
        decoration: const BoxDecoration(color: AppColors.bgCard),
        child: Column(
          children: [
            InkWell(
              onTap: onToggle,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 16,
                  vertical: 14,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                season.name,
                                style: AppTextStyles.dmSans(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                '${season.watchedCount} of ${season.episodes.length} episodes',
                                style: AppTextStyles.dmSans(
                                  fontSize: 11,
                                  color: Colors.white.withValues(alpha: 0.4),
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (onMarkAllWatched != null) ...[
                          _MarkAllButton(onTap: onMarkAllWatched!),
                          const SizedBox(width: 10),
                        ],
                        _SeasonStatusIcon(season: season),
                      ],
                    ),
                    const SizedBox(height: 10),
                    _SeasonProgressBar(season: season),
                  ],
                ),
              ),
            ),
            if (expanded)
              for (final ep in season.episodes)
                _EpisodeRow(
                  episode: ep,
                  onTap: onEpisodeTap == null ? null : () => onEpisodeTap!(ep),
                ),
          ],
        ),
      ),
    );
  }
}

class _MarkAllButton extends StatelessWidget {
  final VoidCallback onTap;

  const _MarkAllButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        decoration: BoxDecoration(
          color: AppColors.avatarBg,
          borderRadius: BorderRadius.circular(6),
          border: Border.all(color: AppColors.borderInput),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.done_all, size: 12, color: AppColors.textMuted),
            const SizedBox(width: 4),
            Text(
              'Mark All',
              style: AppTextStyles.dmSans(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SeasonProgressBar extends StatelessWidget {
  final Season season;

  const _SeasonProgressBar({required this.season});

  @override
  Widget build(BuildContext context) {
    final total = season.episodes.length;
    final fraction = total == 0 ? 0.0 : season.watchedCount / total;
    return Container(
      height: 8,
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: AppColors.progressTrack,
        borderRadius: BorderRadius.circular(4),
      ),
      child: FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: fraction.clamp(0.0, 1.0),
        child: const ColoredBox(color: AppColors.logoAccent),
      ),
    );
  }
}

class _SeasonStatusIcon extends StatelessWidget {
  final Season season;

  const _SeasonStatusIcon({required this.season});

  @override
  Widget build(BuildContext context) {
    if (season.isComplete) {
      return Container(
        width: 22,
        height: 22,
        decoration: BoxDecoration(
          color: AppColors.successBg,
          shape: BoxShape.circle,
          border: Border.all(color: AppColors.success, width: 1.5),
        ),
        child: const Icon(Icons.check, size: 13, color: AppColors.success),
      );
    }
    return Container(
      width: 22,
      height: 22,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.accent, width: 1.5),
      ),
      child: const Icon(Icons.check, size: 13, color: AppColors.accent),
    );
  }
}

class _EpisodeRow extends StatelessWidget {
  final Episode episode;
  final VoidCallback? onTap;

  const _EpisodeRow({required this.episode, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final watched = episode.watched;
    final stillUrl = TmdbService.stillUrl(episode.stillPath);
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: AppColors.border)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 128,
                height: 72,
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    DecoratedBox(
                      decoration: BoxDecoration(
                        gradient: PosterGradients.of(episode.number % 6),
                      ),
                    ),
                    if (stillUrl != null)
                      PitflixNetworkImage(
                        stillUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) =>
                            const SizedBox.shrink(),
                      ),
                    Positioned(
                      right: 5,
                      bottom: 5,
                      child: Container(
                        width: 22,
                        height: 22,
                        decoration: BoxDecoration(
                          color: watched
                              ? AppColors.successBg
                              : const Color(0x99000000),
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: watched
                                ? AppColors.success
                                : Colors.white.withValues(alpha: 0.7),
                            width: 1.5,
                          ),
                        ),
                        child: watched
                            ? const Icon(
                                Icons.check,
                                size: 12,
                                color: AppColors.success,
                              )
                            : null,
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'E${episode.number}',
                    style: AppTextStyles.dmSans(
                      fontSize: 10,
                      color: Colors.white.withValues(alpha: 0.35),
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    episode.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      Text(
                        '${episode.durationMinutes} min',
                        style: AppTextStyles.dmSans(
                          fontSize: 10,
                          color: Colors.white.withValues(alpha: 0.35),
                        ),
                      ),
                      if (episode.rating != null)
                        _MetaBadge(
                          icon: Icons.star_rounded,
                          text: '${episode.rating}',
                          color: AppColors.star,
                        ),
                      if (episode.rewatchCount > 0)
                        _MetaBadge(
                          icon: Icons.replay,
                          text: '×${episode.rewatchCount}',
                          color: AppColors.textMuted,
                        ),
                      if (episode.reaction != null)
                        Text(
                          episode.reaction!,
                          style: AppTextStyles.dmSans(
                            fontSize: 10,
                            color: AppColors.textMuted,
                          ),
                        ),
                      if (episode.favoritePerson != null)
                        _MetaBadge(
                          icon: Icons.favorite,
                          text: episode.favoritePerson!.name,
                          color: AppColors.destructive,
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MetaBadge extends StatelessWidget {
  final IconData icon;
  final String text;
  final Color color;

  const _MetaBadge({
    required this.icon,
    required this.text,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: color),
        const SizedBox(width: 2),
        Text(text, style: AppTextStyles.dmSans(fontSize: 10, color: color)),
      ],
    );
  }
}
