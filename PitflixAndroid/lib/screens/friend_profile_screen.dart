import 'package:flutter/material.dart';
import '../models/social_activity_item.dart';
import '../models/social_profile.dart';
import '../models/title_item.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/format_minutes.dart';
import '../utils/list_marks.dart';
import '../utils/time_ago.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/friend_avatar.dart';
import '../widgets/widgets.dart';
import 'list_detail_screen.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';
import '../widgets/pitflix_network_image.dart';

/// Real data — identity from [SocialProfile], that friend's real activity
/// feed, and their actual watched movies/series + TV time/episodes +
/// playlists — readable thanks to the friends-visibility policies in
/// `011_pitflix_friend_library_visibility.sql` and
/// `013_pitflix_friend_watch_time_visibility.sql` (see
/// SocialService.fetchFriendLibrarySummary), matching own Profile's stat
/// cards exactly.
class FriendProfileScreen extends StatefulWidget {
  final SocialProfile profile;

  const FriendProfileScreen({super.key, required this.profile});

  @override
  State<FriendProfileScreen> createState() => _FriendProfileScreenState();
}

typedef _LibrarySummary = ({
  List<TitleItem> recentMovies,
  List<TitleItem> recentSeries,
  int totalMoviesWatched,
  int totalSeriesWatched,
  int totalWatchTimeMinutes,
  int totalEpisodesWatched,
  List<({String id, String name, String? icon, String type, int itemCount})>
  playlists,
});

class _FriendProfileScreenState extends State<FriendProfileScreen> {
  List<SocialActivityItem>? _activity;
  _LibrarySummary? _summary;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await SocialService.fetchActivityFeed(
        profileId: widget.profile.id,
      );
      final summary = await SocialService.fetchFriendLibrarySummary(
        widget.profile.id,
      );
      if (!mounted) return;
      setState(() {
        _activity = items;
        _summary = summary;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  String _verb(SocialActivityAction action) => switch (action) {
    SocialActivityAction.watched => 'Watched',
    SocialActivityAction.rated => 'Rated',
    SocialActivityAction.addedToWatchlist => 'Added to Watch Later',
    SocialActivityAction.addedToFavorites => 'Added to Favorites',
  };

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
    final profile = widget.profile;

    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: Column(
          children: [
            SizedBox(
              height: 206,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  SizedBox(
                    height: 150,
                    width: double.infinity,
                    child: profile.coverUrl != null
                        ? PitflixNetworkImage(
                            profile.coverUrl!,
                            fit: BoxFit.cover,
                            errorBuilder: (context, error, stackTrace) =>
                                Container(
                                  decoration: BoxDecoration(
                                    gradient: PosterGradients.of(
                                      profile.gradientSeed,
                                    ),
                                  ),
                                ),
                          )
                        : Container(
                            decoration: BoxDecoration(
                              gradient: PosterGradients.of(
                                profile.gradientSeed,
                              ),
                            ),
                          ),
                  ),
                  Positioned(
                    top: 14,
                    left: 16,
                    child: CircleIconButton(
                      icon: Icons.arrow_back_ios_new,
                      onTap: () => Navigator.of(context).pop(),
                    ),
                  ),
                  Positioned(
                    left: 20,
                    top: 106,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: AppColors.bgBase,
                      ),
                      child: FriendAvatar(profile: profile, size: 88),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
                children: [
                  Text(
                    profile.name,
                    style: AppTextStyles.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (profile.username != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      '@${profile.username}',
                      style: AppTextStyles.dmSans(
                        fontSize: 12,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ],
                  const SizedBox(height: AppSpacing.sectionGap),
                  Row(
                    children: [
                      Expanded(
                        child: _StatTile(
                          label: 'TV TIME',
                          value: _summary != null
                              ? formatMinutes(_summary!.totalWatchTimeMinutes)
                              : '—',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          label: 'EPISODES',
                          value: _summary != null
                              ? '${_summary!.totalEpisodesWatched}'
                              : '—',
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: _StatTile(
                          label: 'MOVIES',
                          value: _summary != null
                              ? '${_summary!.totalMoviesWatched}'
                              : '—',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.sectionGap),
                  SectionHeader(title: 'Movies'),
                  SizedBox(
                    height: 132,
                    child: _buildPosterRow(_summary?.recentMovies),
                  ),
                  const SizedBox(height: AppSpacing.sectionGap),
                  SectionHeader(title: 'Series'),
                  SizedBox(
                    height: 132,
                    child: _buildPosterRow(_summary?.recentSeries),
                  ),
                  const SizedBox(height: AppSpacing.sectionGap),
                  Text('PLAYLISTS', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 10),
                  _buildPlaylists(),
                  const SizedBox(height: AppSpacing.sectionGap),
                  Text('ACTIVITY', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 10),
                  _buildActivity(),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPosterRow(List<TitleItem>? items) {
    if (_error != null) {
      return InlineErrorRetry(
        message: "Couldn't load: $_error",
        onRetry: _load,
      );
    }
    if (items == null) {
      return const PosterRowSkeleton(width: 90, height: 132);
    }
    if (items.isEmpty) {
      return const EmptyState(message: 'Nothing here yet.');
    }
    return ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: items.length,
      separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.posterGap),
      itemBuilder: (context, i) {
        final t = items[i];
        return PosterCard(
          width: 90,
          height: 132,
          title: t.name,
          gradientSeed: t.gradientSeed,
          imageUrl: TmdbService.posterUrl(t.posterPath),
          tmdbId: t.tmdbId,
          kind: t.kind,
          onTap: () => _openTitle(t),
          onLongPress: () => showTitleActionsSheet(context, t, (_) {}),
        );
      },
    );
  }

  Widget _buildPlaylists() {
    final playlists = _summary?.playlists;
    if (_error != null) {
      return InlineErrorRetry(
        message: "Couldn't load: $_error",
        onRetry: _load,
      );
    }
    if (playlists == null) {
      return const ListRowsSkeleton(rowHeight: 52);
    }
    if (playlists.isEmpty) {
      return const EmptyState(message: 'No playlists yet.');
    }
    return Column(
      children: [
        for (final p in playlists) ...[
          GestureDetector(
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => ListDetailScreen(
                  listId: p.id,
                  listName: p.name,
                  readOnly: true,
                ),
              ),
            ),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              decoration: BoxDecoration(
                color: AppColors.bgCard,
                borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
              ),
              child: Row(
                children: [
                  Icon(
                    // A custom list's own chosen icon (e.g. the "::film::"
                    // prefix decoded off its name) wins over the generic
                    // type-based icon, matching how Lists/List Detail render
                    // it for the owner.
                    (p.icon != null ? ListMarks.icons[p.icon] : null) ??
                        (p.type == 'favorites'
                            ? Icons.favorite
                            : p.type == 'watchlist'
                            ? Icons.bookmark
                            : Icons.playlist_play),
                    size: 18,
                    color: AppColors.accent,
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      p.name,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  Text(
                    '${p.itemCount}',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.textMuted,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(
                    Icons.chevron_right,
                    size: 16,
                    color: Color(0x40FFFFFF),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 8),
        ],
      ],
    );
  }

  Widget _buildActivity() {
    if (_error != null) {
      return ErrorRetry(message: "Couldn't load activity.\n$_error", onRetry: _load);
    }
    final items = _activity;
    if (items == null) {
      return const ListRowsSkeleton();
    }
    if (items.isEmpty) {
      return const EmptyState(message: 'Nothing here yet.');
    }
    return Column(
      children: [
        for (final item in items) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: Container(
                    width: 32,
                    height: 46,
                    decoration: BoxDecoration(
                      gradient: PosterGradients.of(item.tmdbId % 6),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_verb(item.action)} ${item.title ?? 'something'}',
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        timeAgo(item.createdAt),
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (item.action == SocialActivityAction.rated &&
                    item.rating != null)
                  Text(
                    '${item.rating}★',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.star,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }
}

class _StatTile extends StatelessWidget {
  final String label;
  final String value;

  const _StatTile({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 16, 14, 14),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 4),
          Text(value, style: AppTextStyles.bebas(fontSize: 22)),
        ],
      ),
    );
  }
}
