import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../models/supabase_rows.dart';
import '../services/local_backend_service.dart';
import '../services/session_stats_store.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../utils/format_minutes.dart';
import '../utils/reactions.dart';
import '../widgets/widgets.dart';

/// Real data: from the local Pitflix.API backend's `/api/stats/watch` +
/// `/api/history` (already-aggregated totals, plus real per-session
/// timestamps bucketed into a daily chart here) or Supabase's `watch_events`
/// table (aggregated client-side here), depending on
/// [AppConfig.useLocalBackend]. Both paths feed the same generic cards below.
class StatsScreen extends StatefulWidget {
  const StatsScreen({super.key});

  @override
  State<StatsScreen> createState() => _StatsScreenState();
}

class _StatsScreenState extends State<StatsScreen> {
  int _tab = 0; // 0 Shows, 1 Movies
  _StatsData? _data;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      _StatsData data;
      if (AppConfig.useLocalBackend) {
        final results = await Future.wait([
          LocalBackendService.fetchWatchStats(),
          LocalBackendService.fetchHistory(),
        ]);
        data = _StatsData.fromLocalBackendBundle(
          results[0] as Map<String, dynamic>,
          results[1] as List<Map<String, dynamic>>,
        );
      } else {
        data = _StatsData.fromSupabaseEvents(
          await SupabaseService.fetchWatchEvents(),
        );
      }
      if (!mounted) return;
      setState(() => _data = data);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  'Stats',
                  style: AppTextStyles.bebas(fontSize: 22, letterSpacing: 0.1),
                ),
              ),
            ),
            SegmentedTabBar(
              tabs: const ['Shows', 'Movies'],
              activeIndex: _tab,
              onChanged: (i) => setState(() => _tab = i),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load stats.\n$_error",
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 12),
              GestureDetector(
                onTap: _load,
                child: Text(
                  'Retry',
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
              ),
            ],
          ),
        ),
      );
    }

    final data = _data;
    if (data == null) {
      return const _StatsSkeleton();
    }

    final showTab = _tab == 0;
    final tabScoped = showTab ? data.shows : data.movies;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        _HeroMetricCard(
          label: data.heroLabel,
          value: tabScoped.heroValue,
          subLabel: tabScoped.heroSubLabel,
        ),
        const SizedBox(height: 14),
        _BarChartCard(
          title: 'LAST 7 DAYS',
          values: tabScoped.dailyValues,
          labels: tabScoped.dailyLabels,
        ),
        const SizedBox(height: 14),
        _CountCardsRow(
          leftLabel: 'THIS WEEK',
          leftValue: tabScoped.weekTotalLabel,
          rightLabel: 'THIS MONTH',
          rightValue: tabScoped.monthTotalLabel,
        ),
        const SizedBox(height: 14),
        _CountCardsRow(
          leftLabel: 'MOVIES',
          leftValue: '${data.movieCount}',
          rightLabel: 'TV SHOWS',
          rightValue: '${data.showCount}',
        ),
        const SizedBox(height: 14),
        _CountCardsRow(
          leftLabel: 'COMPLETED',
          leftValue: '${data.showCount}',
          rightLabel: 'MOVIES SEEN',
          rightValue: '${data.movieCount}',
        ),
        const SizedBox(height: 14),
        _RankedListCard(
          title: data.recentTitle,
          rows: tabScoped.recentRows,
          emptyText: 'Nothing here yet.',
        ),
        const SizedBox(height: 14),
        _ProgressListCard(
          title: data.rankedTitle,
          rows: tabScoped.rankedRows,
          emptyText: 'Nothing here yet.',
        ),
        const SizedBox(height: 14),
        ValueListenableBuilder<Map<int, int>>(
          valueListenable: SessionStatsStore.ratings,
          builder: (context, ratingsMap, _) =>
              _RatingDistributionCard(ratings: ratingsMap),
        ),
        const SizedBox(height: 14),
        ValueListenableBuilder<Map<String, int>>(
          valueListenable: SessionStatsStore.reactions,
          builder: (context, reactionsMap, _) =>
              _ReactionsCard(reactions: reactionsMap),
        ),
      ],
    );
  }
}

/// Placeholder layout shown while stats are loading — mirrors the loaded
/// card stack (hero metric, bar chart, count cards, ranked list) instead of
/// a bare spinner.
class _StatsSkeleton extends StatelessWidget {
  const _StatsSkeleton();

  @override
  Widget build(BuildContext context) {
    return Shimmer(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          ShimmerBox(width: double.infinity, height: 110, radius: 16),
          const SizedBox(height: 14),
          ShimmerBox(width: double.infinity, height: 180, radius: 16),
          const SizedBox(height: 14),
          Row(
            children: const [
              Expanded(child: ShimmerBox(height: 80, radius: 16)),
              SizedBox(width: 10),
              Expanded(child: ShimmerBox(height: 80, radius: 16)),
            ],
          ),
          const SizedBox(height: 14),
          ShimmerBox(width: double.infinity, height: 200, radius: 16),
        ],
      ),
    );
  }
}

/// One row of a [_RankedListCard] — a primary label and a short secondary
/// value shown on the right (a rating, a year, ...).
typedef _RankedRow = (String primary, String secondary);

/// One row of a [_ProgressListCard] — a label, a right-aligned value, and
/// a 0-1 fraction driving the progress bar width.
typedef _ProgressRow = (String label, String rightText, double fraction);

const _dayLabels = ['6d', '5d', '4d', '3d', '2d', '1d', 'Today'];

class _TabScopedStats {
  final String heroValue;
  final String heroSubLabel;
  final List<int> dailyValues; // 7 entries, oldest → today
  final List<String> dailyLabels; // 7 entries
  final String weekTotalLabel;
  final String monthTotalLabel;
  final List<_RankedRow> recentRows;
  final List<_ProgressRow> rankedRows;

  const _TabScopedStats({
    required this.heroValue,
    required this.heroSubLabel,
    required this.dailyValues,
    required this.dailyLabels,
    required this.weekTotalLabel,
    required this.monthTotalLabel,
    required this.recentRows,
    required this.rankedRows,
  });
}

/// Normalizes either data source into the shapes the (source-agnostic) card
/// widgets need.
class _StatsData {
  final String heroLabel;
  final String recentTitle;
  final String rankedTitle;
  final int movieCount;
  final int showCount;
  final _TabScopedStats shows;
  final _TabScopedStats movies;

  const _StatsData({
    required this.heroLabel,
    required this.recentTitle,
    required this.rankedTitle,
    required this.movieCount,
    required this.showCount,
    required this.shows,
    required this.movies,
  });

  /// Buckets real per-session minutes into the last 7 calendar days.
  static List<int> _dailyMinutesFromHistory(
    List<Map<String, dynamic>> history,
    bool wantShows,
  ) {
    final buckets = List<int>.filled(7, 0);
    final now = DateTime.now();
    for (final row in history) {
      final mediaType = row['mediaType'] as String? ?? '';
      if (isSeriesMediaType(mediaType) != wantShows) continue;
      final openedAt = DateTime.tryParse(row['openedAt'] as String? ?? '');
      if (openedAt == null) continue;
      final daysAgo = now.difference(openedAt).inDays;
      if (daysAgo < 0 || daysAgo > 6) continue;
      final seconds =
          (row['trustedResumeSeconds'] as num?)?.toInt() ??
          (row['estimatedSeconds'] as num?)?.toInt() ??
          0;
      buckets[6 - daysAgo] += seconds ~/ 60;
    }
    return buckets;
  }

  /// Pitflix.API's `/api/stats/watch` (aggregated totals) + `/api/history`
  /// (real per-session timestamps, bucketed into the daily chart here).
  factory _StatsData.fromLocalBackendBundle(
    Map<String, dynamic> b,
    List<Map<String, dynamic>> history,
  ) {
    int asInt(dynamic v) => (v as num?)?.toInt() ?? 0;

    List<_ProgressRow> genreRows(String key) {
      final list = (b[key] as List? ?? []).cast<Map<String, dynamic>>();
      final maxCount = list.isEmpty
          ? 1
          : list
                .map((g) => asInt(g['count']))
                .reduce((a, c) => a > c ? a : c)
                .clamp(1, 1 << 30);
      return list
          .take(5)
          .map<_ProgressRow>(
            (g) => (
              g['genre'] as String? ?? '',
              '${asInt(g['count'])}',
              asInt(g['count']) / maxCount,
            ),
          )
          .toList();
    }

    List<_RankedRow> recentRows(String key) {
      final list = (b[key] as List? ?? []).cast<Map<String, dynamic>>();
      return list
          .take(5)
          .map<_RankedRow>(
            (c) => (
              c['title'] as String? ?? 'Untitled',
              c['year'] != null ? '${c['year']}' : '',
            ),
          )
          .toList();
    }

    final shows = _TabScopedStats(
      heroValue: formatMinutes(asInt(b['seriesWatchTimeMinutes'])),
      heroSubLabel:
          '+${formatMinutes(asInt(b['seriesWatchTimeMinutesWeek']))} in the last 7 days',
      dailyValues: _dailyMinutesFromHistory(history, true),
      dailyLabels: _dayLabels,
      weekTotalLabel: formatMinutes(asInt(b['seriesWatchTimeMinutesWeek'])),
      monthTotalLabel: formatMinutes(asInt(b['seriesWatchTimeMinutesMonth'])),
      recentRows: recentRows('recentlyCompletedSeries'),
      rankedRows: genreRows('topSeriesGenres'),
    );

    final movies = _TabScopedStats(
      heroValue: formatMinutes(asInt(b['movieWatchTimeMinutes'])),
      heroSubLabel:
          '+${formatMinutes(asInt(b['movieWatchTimeMinutesWeek']))} in the last 7 days',
      dailyValues: _dailyMinutesFromHistory(history, false),
      dailyLabels: _dayLabels,
      weekTotalLabel: formatMinutes(asInt(b['movieWatchTimeMinutesWeek'])),
      monthTotalLabel: formatMinutes(asInt(b['movieWatchTimeMinutesMonth'])),
      recentRows: recentRows('recentlyCompletedMovies'),
      rankedRows: genreRows('topMovieGenres'),
    );

    return _StatsData(
      heroLabel: 'TIME WATCHED',
      recentTitle: 'RECENTLY COMPLETED',
      rankedTitle: 'TOP GENRES',
      movieCount: asInt(b['totalMoviesWatched']),
      showCount: asInt(b['totalSeriesCompleted']),
      shows: shows,
      movies: movies,
    );
  }

  /// Supabase's `watch_events` — aggregated here, client-side. There's no
  /// duration data in this table (just discrete "watched" events), so here
  /// "week/month/daily" mean *counts* of titles watched, not time.
  factory _StatsData.fromSupabaseEvents(List<SupabaseWatchEventRow> all) {
    _TabScopedStats scoped(bool wantShows) {
      final events = all
          .where((e) => isSeriesMediaType(e.mediaType) == wantShows)
          .toList();
      final now = DateTime.now();
      final last7d = events
          .where((e) => now.difference(e.watchedAt).inDays < 7)
          .length;
      final last30d = events
          .where((e) => now.difference(e.watchedAt).inDays < 30)
          .length;

      final daily = List<int>.filled(7, 0);
      for (final e in events) {
        final daysAgo = now.difference(e.watchedAt).inDays;
        if (daysAgo < 0 || daysAgo > 6) continue;
        daily[6 - daysAgo]++;
      }

      final recentSorted = [...events]
        ..sort((a, b) => b.watchedAt.compareTo(a.watchedAt));
      final recentRows = recentSorted
          .take(5)
          .map<_RankedRow>(
            (e) => (
              e.title ?? 'TMDB ${e.tmdbId}',
              e.rating != null ? '${e.rating} ★' : _relativeLabel(e.watchedAt),
            ),
          )
          .toList();

      final rated = events.where((e) => e.rating != null).toList()
        ..sort((a, b) => b.rating!.compareTo(a.rating!));
      final rankedRows = rated
          .take(5)
          .map<_ProgressRow>(
            (e) =>
                (e.title ?? 'TMDB ${e.tmdbId}', '${e.rating}/5', e.rating! / 5),
          )
          .toList();

      return _TabScopedStats(
        heroValue: '${events.length}',
        heroSubLabel: '+$last7d in the last 7 days',
        dailyValues: daily,
        dailyLabels: _dayLabels,
        weekTotalLabel: '$last7d title${last7d == 1 ? '' : 's'}',
        monthTotalLabel: '$last30d title${last30d == 1 ? '' : 's'}',
        recentRows: recentRows,
        rankedRows: rankedRows,
      );
    }

    return _StatsData(
      heroLabel: 'TITLES WATCHED',
      recentTitle: 'RECENTLY WATCHED',
      rankedTitle: 'TOP RATED',
      movieCount: all.where((e) => !isSeriesMediaType(e.mediaType)).length,
      showCount: all.where((e) => isSeriesMediaType(e.mediaType)).length,
      shows: scoped(true),
      movies: scoped(false),
    );
  }

  static String _relativeLabel(DateTime dt) {
    final days = DateTime.now().difference(dt).inDays;
    if (days <= 0) return 'Today';
    if (days == 1) return 'Yesterday';
    if (days < 30) return '${days}d ago';
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }
}

class _StatCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry padding;

  const _StatCard({
    required this.child,
    this.padding = const EdgeInsets.fromLTRB(20, 22, 20, 18),
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: child,
    );
  }
}

class _HeroMetricCard extends StatelessWidget {
  final String label;
  final String value;
  final String subLabel;

  const _HeroMetricCard({
    required this.label,
    required this.value,
    required this.subLabel,
  });

  @override
  Widget build(BuildContext context) {
    return _StatCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 8),
          Text(
            value,
            style: AppTextStyles.bebas(fontSize: 34, letterSpacing: 0.02),
          ),
          const SizedBox(height: 6),
          Text(
            subLabel,
            style: AppTextStyles.dmSans(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: AppColors.accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _BarChartCard extends StatelessWidget {
  final String title;
  final List<int> values;
  final List<String> labels;

  const _BarChartCard({
    required this.title,
    required this.values,
    required this.labels,
  });

  @override
  Widget build(BuildContext context) {
    final maxVal = values.isEmpty
        ? 1
        : values.reduce((a, b) => a > b ? a : b).clamp(1, 1 << 30);
    return _StatCard(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 16),
          SizedBox(
            height: 60,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                for (var i = 0; i < values.length; i++)
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 3),
                      child: FractionallySizedBox(
                        alignment: Alignment.bottomCenter,
                        heightFactor: values[i] / maxVal,
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            color: i == values.length - 1
                                ? AppColors.accent
                                : AppColors.progressTrack,
                            borderRadius: const BorderRadius.vertical(
                              top: Radius.circular(3),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              for (final label in labels)
                Expanded(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: AppTextStyles.dmSans(
                      fontSize: 8,
                      color: AppColors.textFaint,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

class _CountCardsRow extends StatelessWidget {
  final String leftLabel;
  final String leftValue;
  final String rightLabel;
  final String rightValue;

  const _CountCardsRow({
    required this.leftLabel,
    required this.leftValue,
    required this.rightLabel,
    required this.rightValue,
  });

  @override
  Widget build(BuildContext context) {
    Widget tile(String label, String value) => Expanded(
      child: _StatCard(
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: AppTextStyles.sectionLabel()),
            const SizedBox(height: 4),
            Text(value, style: AppTextStyles.bebas(fontSize: 24)),
          ],
        ),
      ),
    );

    return Row(
      children: [
        tile(leftLabel, leftValue),
        const SizedBox(width: 10),
        tile(rightLabel, rightValue),
      ],
    );
  }
}

/// Generic "rank + primary + secondary" list card (Recently Watched / Recently Completed).
class _RankedListCard extends StatelessWidget {
  final String title;
  final List<_RankedRow> rows;
  final String emptyText;

  const _RankedListCard({
    required this.title,
    required this.rows,
    required this.emptyText,
  });

  @override
  Widget build(BuildContext context) {
    return _StatCard(
      padding: EdgeInsets.zero,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(title, style: AppTextStyles.sectionLabel()),
            ),
          ),
          if (rows.isEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
              child: Text(
                emptyText,
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            ),
          for (var i = 0; i < rows.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: i == rows.length - 1
                    ? null
                    : const Border(bottom: BorderSide(color: AppColors.border)),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      rows[i].$1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    rows[i].$2,
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.accent,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Generic "label + progress bar + right value" list card (Top Rated / Top Genres).
class _ProgressListCard extends StatelessWidget {
  final String title;
  final List<_ProgressRow> rows;
  final String emptyText;

  const _ProgressListCard({
    required this.title,
    required this.rows,
    required this.emptyText,
  });

  @override
  Widget build(BuildContext context) {
    return _StatCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppTextStyles.sectionLabel()),
          const SizedBox(height: 14),
          if (rows.isEmpty)
            Text(
              emptyText,
              style: AppTextStyles.dmSans(
                fontSize: 12,
                color: AppColors.textMuted,
              ),
            ),
          for (var i = 0; i < rows.length; i++)
            Padding(
              padding: EdgeInsets.only(bottom: i == rows.length - 1 ? 0 : 14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          rows[i].$1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.dmSans(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                      Text(
                        rows[i].$2,
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(3),
                    child: SizedBox(
                      height: 3,
                      child: Stack(
                        children: [
                          const ColoredBox(color: AppColors.progressTrack),
                          FractionallySizedBox(
                            widthFactor: rows[i].$3.clamp(0.0, 1.0),
                            child: const ColoredBox(color: AppColors.accent),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Rating distribution bar chart — shows how many times each star value
/// was given. Session-only (see [SessionStatsStore]).
class _RatingDistributionCard extends StatelessWidget {
  final Map<int, int> ratings;

  const _RatingDistributionCard({required this.ratings});

  @override
  Widget build(BuildContext context) {
    final maxCount = ratings.isEmpty
        ? 1
        : ratings.values.reduce((a, b) => a > b ? a : b).clamp(1, 1 << 30);
    final sortedKeys = ratings.keys.toList()..sort((a, b) => b.compareTo(a));

    return _StatCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('YOUR RATINGS', style: AppTextStyles.sectionLabel()),
              Text(
                '\${ratings.values.fold(0, (a, b) => a + b)} rated',
                style: AppTextStyles.dmSans(
                  fontSize: 11,
                  color: AppColors.textMuted,
                ),
              ),
            ],
          ),
          if (ratings.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Rate some titles to see your breakdown.',
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            )
          else ...[
            const SizedBox(height: 14),
            for (final star in sortedKeys)
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Row(
                  children: [
                    SizedBox(
                      width: 32,
                      child: Row(
                        children: [
                          const Icon(
                            Icons.star_rounded,
                            size: 12,
                            color: AppColors.star,
                          ),
                          const SizedBox(width: 2),
                          Text(
                            '\$star',
                            style: AppTextStyles.dmSans(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(3),
                        child: SizedBox(
                          height: 6,
                          child: Stack(
                            children: [
                              const ColoredBox(color: AppColors.progressTrack),
                              FractionallySizedBox(
                                widthFactor: (ratings[star]! / maxCount).clamp(
                                  0.0,
                                  1.0,
                                ),
                                child: const ColoredBox(color: AppColors.star),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    SizedBox(
                      width: 24,
                      child: Text(
                        '\${ratings[star]}',
                        textAlign: TextAlign.end,
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

/// Session reactions leaderboard — emoji chips ordered by use count.
/// Session-only (see [SessionStatsStore]).
class _ReactionsCard extends StatelessWidget {
  final Map<String, int> reactions;

  const _ReactionsCard({required this.reactions});

  @override
  Widget build(BuildContext context) {
    final sorted = reactions.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final emojiMap = {for (final (e, l) in kReactions) l: e};

    return _StatCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('YOUR REACTIONS', style: AppTextStyles.sectionLabel()),
          if (reactions.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(
                'Log reactions when watching to see them here.',
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            )
          else ...[
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final entry in sorted)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.avatarBg,
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(color: AppColors.borderInput),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          emojiMap[entry.key] ?? '',
                          style: const TextStyle(fontSize: 16),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          entry.key,
                          style: AppTextStyles.dmSans(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.buttonPurple,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            '\${entry.value}',
                            style: AppTextStyles.dmSans(
                              fontSize: 10,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
