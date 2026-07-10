import 'package:flutter/material.dart';
import '../models/profile_highlights.dart';
import '../services/session_stats_store.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/format_minutes.dart';
import '../utils/reactions.dart';
import '../widgets/widgets.dart';

/// Real, per-account data — from Supabase's `watch_records`/`watch_log`
/// (see UserLibraryService.fetchStatsSource). Watch streak/longest-marathon/
/// rewatch-session-detection aren't computable from this schema (that logic
/// depends on the desktop's full local library metadata, which the mobile
/// app has no equivalent source for) — those sections simply show what's
/// genuinely available and stay empty otherwise, rather than showing fake
/// data. Network breakdown IS computable, but only for series synced via
/// Settings' desktop import (mobile-only series have no `network`).
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
    UserLibraryService.libraryVersion.addListener(_load);
  }

  @override
  void dispose() {
    UserLibraryService.libraryVersion.removeListener(_load);
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final source = await UserLibraryService.fetchStatsSource();
      final data = _StatsData.fromUserLibrary(
        source.watchRecords,
        source.watchLog,
        source.episodeRewatches,
      );
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
      return ErrorRetry(message: "Couldn't load stats.\n$_error", onRetry: _load);
    }

    final data = _data;
    if (data == null) {
      return const _StatsSkeleton();
    }

    final showTab = _tab == 0;
    final tabScoped = showTab ? data.shows : data.movies;

    final highlights = data.highlights;
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 18, 20, 24),
      children: [
        if (highlights != null && !highlights.isEmpty) ...[
          SizedBox(height: 84, child: _buildHighlightsRow(highlights)),
          const SizedBox(height: 14),
        ],
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
          leftLabel: showTab ? 'SERIES COMPLETED' : 'MOVIES SEEN',
          leftValue: '${tabScoped.completedCount}',
          rightLabel: showTab ? 'TOTAL SERIES' : 'TOTAL MOVIES',
          rightValue: '${tabScoped.totalCount}',
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
        if (data.hasBackendExtras) ...[
          const SizedBox(height: 14),
          _CountCardsRow(
            leftLabel: 'AVG RATING',
            leftValue: tabScoped.averageRating != null && tabScoped.averageRating! > 0
                ? '${tabScoped.averageRating!.toStringAsFixed(1)}★'
                : '—',
            rightLabel: 'REWATCH SESSIONS',
            rightValue: '${data.rewatchSessionsApprox ?? 0}',
          ),
          const SizedBox(height: 14),
          _ProgressListCard(
            title: 'MOVIES VS SERIES',
            rows: [
              (
                'Movies',
                '${(data.moviePercent ?? 0).toStringAsFixed(0)}%',
                (data.moviePercent ?? 0) / 100,
              ),
              (
                'Series',
                '${(data.seriesPercent ?? 0).toStringAsFixed(0)}%',
                (data.seriesPercent ?? 0) / 100,
              ),
            ],
            emptyText: 'Nothing here yet.',
          ),
          const SizedBox(height: 14),
          _ProgressListCard(
            title: 'TOP NETWORKS',
            rows: data.networkRows,
            emptyText: 'Nothing here yet.',
          ),
          const SizedBox(height: 14),
          _ProgressListCard(
            title: 'BY DECADE',
            rows: tabScoped.decadeRows,
            emptyText: 'Nothing here yet.',
          ),
        ],
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

  Widget _buildHighlightsRow(ProfileHighlights h) {
    final chips = <(IconData, String, String)>[
      if (h.watchStreak > 0)
        (
          Icons.local_fire_department,
          '${h.watchStreak}-day streak',
          'Watch Streak',
        ),
      if (h.longestMarathonEpisodes > 0)
        (
          Icons.movie_filter_outlined,
          '${h.longestMarathonEpisodes} eps'
              '${h.longestMarathonShowTitle != null ? ' · ${h.longestMarathonShowTitle}' : ''}',
          'Longest Marathon',
        ),
      if (h.favoriteDecade != null)
        (Icons.calendar_month_outlined, h.favoriteDecade!, 'Favorite Decade'),
      if (h.topNetwork != null)
        (Icons.live_tv_outlined, h.topNetwork!, 'Top Network'),
      if (h.mostWatchedGenre != null)
        (Icons.theater_comedy_outlined, h.mostWatchedGenre!, 'Top Genre'),
    ];

    return ListView.separated(
      scrollDirection: Axis.horizontal,
      itemCount: chips.length,
      separatorBuilder: (_, _) => const SizedBox(width: 10),
      itemBuilder: (context, i) {
        final (icon, value, label) = chips[i];
        return _HighlightChip(icon: icon, value: value, label: label);
      },
    );
  }
}

/// Small "quick glance" badge for Stats' Highlights row — a stat that's
/// interesting on its own but not deep enough to warrant a full card (see
/// [ProfileHighlights]).
class _HighlightChip extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;

  const _HighlightChip({
    required this.icon,
    required this.value,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 132,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 16, color: AppColors.logoAccent),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.dmSans(fontSize: 10, color: AppColors.textMuted),
          ),
        ],
      ),
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

  /// Completed / total counts *for this tab only* (e.g. completed series
  /// and total series tracked when this is the Shows tab) — used for the
  /// "X SEEN"/"TOTAL" overview row so it never shows the other tab's data.
  final int completedCount;
  final int totalCount;

  /// Extras only populated on the local-backend path — null/empty on the
  /// Supabase path, which doesn't compute them.
  final double? averageRating;
  final List<_ProgressRow> decadeRows;

  const _TabScopedStats({
    required this.heroValue,
    required this.heroSubLabel,
    required this.dailyValues,
    required this.dailyLabels,
    required this.weekTotalLabel,
    required this.monthTotalLabel,
    required this.recentRows,
    required this.rankedRows,
    required this.completedCount,
    required this.totalCount,
    this.averageRating,
    this.decadeRows = const [],
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

  /// Extras only populated on the local-backend path (see
  /// [_TabScopedStats]'s doc) — the Stats screen renders their sections
  /// conditionally on [hasBackendExtras].
  final double? moviePercent;
  final double? seriesPercent;
  final int? rewatchSessionsApprox;
  final List<_ProgressRow> networkRows;
  final int? seriesCompletionPercent;
  final ProfileHighlights? highlights;

  bool get hasBackendExtras => moviePercent != null;

  const _StatsData({
    required this.heroLabel,
    required this.recentTitle,
    required this.rankedTitle,
    required this.movieCount,
    required this.showCount,
    required this.shows,
    required this.movies,
    this.moviePercent,
    this.seriesPercent,
    this.rewatchSessionsApprox,
    this.networkRows = const [],
    this.seriesCompletionPercent,
    this.highlights,
  });

  /// Buckets watch_log minutes into the last 7 calendar days.
  static List<int> _dailyMinutesFromLog(
    List<Map<String, dynamic>> log,
    String mediaType,
  ) {
    final buckets = List<int>.filled(7, 0);
    final now = DateTime.now();
    for (final row in log) {
      if (row['media_type'] != mediaType) continue;
      final loggedAt = DateTime.tryParse(row['logged_at'] as String? ?? '');
      if (loggedAt == null) continue;
      final daysAgo = now.difference(loggedAt).inDays;
      if (daysAgo < 0 || daysAgo > 6) continue;
      buckets[6 - daysAgo] += (row['minutes'] as num?)?.toInt() ?? 0;
    }
    return buckets;
  }

  /// Supabase's `watch_records`/`watch_log`/`episode_watch_status` (see
  /// UserLibraryService.fetchStatsSource) — aggregated here, client-side.
  factory _StatsData.fromUserLibrary(
    List<Map<String, dynamic>> watchRecords,
    List<Map<String, dynamic>> watchLog,
    List<Map<String, dynamic>> episodeRewatches,
  ) {
    int asInt(dynamic v) => (v as num?)?.toInt() ?? 0;

    _TabScopedStats scoped(String mediaType) {
      final records = watchRecords
          .where((r) => r['media_type'] == mediaType)
          .toList();
      final completed = records
          .where((r) => r['status'] == 'completed')
          .toList()
        ..sort(
          (a, b) => (b['updated_at'] as String).compareTo(
            a['updated_at'] as String,
          ),
        );
      final log = watchLog.where((r) => r['media_type'] == mediaType);
      final now = DateTime.now();
      final logMinutes = (DateTime cutoff) => log
          .where(
            (r) =>
                DateTime.tryParse(
                  r['logged_at'] as String? ?? '',
                )?.isAfter(cutoff) ??
                false,
          )
          .fold<int>(0, (sum, r) => sum + asInt(r['minutes']));
      final totalMinutes = log.fold<int>(
        0,
        (sum, r) => sum + asInt(r['minutes']),
      );
      final weekMinutes = logMinutes(now.subtract(const Duration(days: 7)));
      final monthMinutes = logMinutes(now.subtract(const Duration(days: 30)));

      // Genre breakdown — flatten genres[] across all of this tab's records.
      final genreCounts = <String, int>{};
      for (final r in records) {
        for (final g in (r['genres'] as List? ?? const [])) {
          genreCounts[g as String] = (genreCounts[g] ?? 0) + 1;
        }
      }
      final sortedGenres = genreCounts.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value));
      final maxGenreCount = sortedGenres.isEmpty ? 1 : sortedGenres.first.value;
      final genreRows = sortedGenres
          .take(5)
          .map<_ProgressRow>((e) => (e.key, '${e.value}', e.value / maxGenreCount))
          .toList();

      // Decade breakdown.
      final decadeCounts = <String, int>{};
      for (final r in records) {
        final year = (r['release_year'] as num?)?.toInt();
        if (year == null || year <= 0) continue;
        final decade = '${(year ~/ 10) * 10}s';
        decadeCounts[decade] = (decadeCounts[decade] ?? 0) + 1;
      }
      final sortedDecades = decadeCounts.entries.toList()
        ..sort((a, b) => b.value.compareTo(a.value));
      final maxDecadeCount = sortedDecades.isEmpty
          ? 1
          : sortedDecades.first.value;
      final decadeRows = sortedDecades
          .take(5)
          .map<_ProgressRow>(
            (e) => (e.key, '${e.value}', e.value / maxDecadeCount),
          )
          .toList();

      final ratings = records
          .map((r) => (r['rating'] as num?)?.toInt())
          .whereType<int>()
          .toList();
      final averageRating = ratings.isEmpty
          ? null
          : ratings.reduce((a, b) => a + b) / ratings.length;

      return _TabScopedStats(
        heroValue: formatMinutes(totalMinutes),
        heroSubLabel: '+${formatMinutes(weekMinutes)} in the last 7 days',
        dailyValues: _dailyMinutesFromLog(watchLog, mediaType),
        dailyLabels: _dayLabels,
        weekTotalLabel: formatMinutes(weekMinutes),
        monthTotalLabel: formatMinutes(monthMinutes),
        recentRows: completed
            .take(5)
            .map<_RankedRow>(
              (r) => (
                r['title'] as String? ?? 'Untitled',
                (r['release_year'] as num?) != null
                    ? '${r['release_year']}'
                    : '',
              ),
            )
            .toList(),
        rankedRows: genreRows,
        completedCount: completed.length,
        totalCount: records.length,
        averageRating: averageRating,
        decadeRows: decadeRows,
      );
    }

    final movieCount = watchRecords
        .where((r) => r['media_type'] == 'movie' && r['status'] == 'completed')
        .length;
    final seriesRecords = watchRecords.where((r) => r['media_type'] == 'series');
    final seriesCompletedCount = seriesRecords
        .where((r) => r['status'] == 'completed')
        .length;
    final totalTitles = movieCount + seriesRecords.length;
    final moviePercent = totalTitles == 0
        ? 0.0
        : movieCount / totalTitles * 100;
    final seriesPercent = totalTitles == 0
        ? 0.0
        : seriesRecords.length / totalTitles * 100;
    final seriesCompletionPercent = seriesRecords.isEmpty
        ? 0
        : (seriesCompletedCount / seriesRecords.length * 100).round();

    // Network breakdown — only series carry a `network` (set on desktop-
    // import; mobile-only series won't have one, and are simply excluded).
    final networkCounts = <String, int>{};
    for (final r in seriesRecords) {
      final network = r['network'] as String?;
      if (network == null || network.isEmpty) continue;
      networkCounts[network] = (networkCounts[network] ?? 0) + 1;
    }
    final sortedNetworks = networkCounts.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));
    final maxNetworkCount = sortedNetworks.isEmpty
        ? 1
        : sortedNetworks.first.value;
    final networkRows = sortedNetworks
        .take(5)
        .map<_ProgressRow>(
          (e) => (e.key, '${e.value}', e.value / maxNetworkCount),
        )
        .toList();

    return _StatsData(
      heroLabel: 'TIME WATCHED',
      recentTitle: 'RECENTLY COMPLETED',
      rankedTitle: 'TOP GENRES',
      movieCount: movieCount,
      showCount: seriesCompletedCount,
      shows: scoped('series'),
      movies: scoped('movie'),
      moviePercent: moviePercent,
      seriesPercent: seriesPercent,
      rewatchSessionsApprox: episodeRewatches.fold<int>(
        0,
        (sum, r) => sum + asInt(r['rewatch_count']),
      ),
      networkRows: networkRows,
      seriesCompletionPercent: seriesCompletionPercent,
      highlights: ProfileHighlights.fromUserLibraryBundle(watchRecords),
    );
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
