import 'dart:async';
import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/app_settings.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Persists the last search across SearchScreen instances so re-opening the
/// page restores the previous results without re-fetching.
abstract class _SearchCache {
  static String query = '';
  static int filter = 0;
  static List<TitleItem>? results;
}

/// Real data: searches TMDB directly (`/search/movie`, `/search/tv`, or
/// `/search/multi` for "All") as you type, debounced so it doesn't fire a
/// request per keystroke.
class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  late final TextEditingController _controller =
      TextEditingController(text: _SearchCache.query);
  late int _filter = _SearchCache.filter;
  Timer? _debounce;
  int _requestId = 0;

  List<TitleItem>? _results = _SearchCache.results;
  String? _error;
  bool _loading = false;

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  TitleKind? get _kindFilter => switch (_filter) {
    1 => TitleKind.movie,
    2 => TitleKind.show,
    _ => null,
  };

  void _onQueryChanged() {
    setState(() {});
    _debounce?.cancel();
    final query = _controller.text.trim();
    if (query.isEmpty) {
      _SearchCache.query = '';
      _SearchCache.results = null;
      setState(() {
        _results = null;
        _error = null;
        _loading = false;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), _runSearch);
  }

  Future<void> _runSearch() async {
    final query = _controller.text.trim();
    if (query.isEmpty) return;
    final myRequestId = ++_requestId;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final results = await TmdbService.search(query, kindFilter: _kindFilter);
      if (!mounted || myRequestId != _requestId) return;
      _SearchCache.query = query;
      _SearchCache.filter = _filter;
      _SearchCache.results = results;
      AppSettings.addSearchTerm(query);
      setState(() {
        _results = results;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || myRequestId != _requestId) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  void _setFilter(int filter) {
    setState(() => _filter = filter);
    if (_controller.text.trim().isNotEmpty) _runSearch();
  }

  void _searchFor(String term) {
    _controller.text = term;
    _controller.selection = TextSelection.collapsed(offset: term.length);
    _debounce?.cancel();
    setState(() {});
    _runSearch();
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
    final query = _controller.text.trim();
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Container(
                height: 46,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: AppColors.bgCard,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: AppColors.borderInput, width: 1.5),
                ),
                child: Row(
                  children: [
                    const Icon(
                      Icons.search,
                      size: 18,
                      color: AppColors.textMuted,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: TextField(
                        controller: _controller,
                        onChanged: (_) => _onQueryChanged(),
                        style: AppTextStyles.dmSans(
                          fontSize: 15,
                          color: AppColors.textPrimary,
                        ),
                        decoration: const InputDecoration(
                          isDense: true,
                          border: InputBorder.none,
                          hintText: 'Search movies & shows',
                        ),
                      ),
                    ),
                    if (query.isNotEmpty)
                      GestureDetector(
                        onTap: () {
                          _controller.clear();
                          _onQueryChanged();
                        },
                        child: const Icon(
                          Icons.close,
                          size: 16,
                          color: AppColors.textMuted,
                        ),
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  FilterChipPill(
                    label: 'All',
                    active: _filter == 0,
                    onTap: () => _setFilter(0),
                  ),
                  const SizedBox(width: 8),
                  FilterChipPill(
                    label: 'Movies',
                    active: _filter == 1,
                    onTap: () => _setFilter(1),
                  ),
                  const SizedBox(width: 8),
                  FilterChipPill(
                    label: 'Shows',
                    active: _filter == 2,
                    onTap: () => _setFilter(2),
                  ),
                ],
              ),
            ),
            Expanded(child: _buildBody(query)),
            const PushedScreenBottomNav(active: MainTab.discover),
          ],
        ),
      ),
    );
  }

  Widget _buildRecentSearches() {
    return ValueListenableBuilder<List<String>>(
      valueListenable: AppSettings.searchHistory,
      builder: (context, history, _) {
        if (history.isEmpty) {
          return Center(
            child: Text(
              'Type to search TMDB',
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textMuted,
              ),
            ),
          );
        }
        return ListView(
          padding: const EdgeInsets.fromLTRB(20, 18, 20, 20),
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('RECENT SEARCHES', style: AppTextStyles.sectionLabel()),
                GestureDetector(
                  onTap: AppSettings.clearSearchHistory,
                  child: Text(
                    'Clear',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            for (final term in history)
              GestureDetector(
                onTap: () => _searchFor(term),
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.history,
                        size: 16,
                        color: AppColors.textMuted,
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          term,
                          style: AppTextStyles.dmSans(
                            fontSize: 14,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  Widget _buildBody(String query) {
    if (query.isEmpty) {
      return _buildRecentSearches();
    }

    if (_error != null) {
      return ErrorRetry(message: "Couldn't search: $_error", onRetry: _runSearch);
    }

    if (_loading && _results == null) {
      return const Center(
        child: CircularProgressIndicator(color: AppColors.accent),
      );
    }

    final results = _results ?? const [];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
          child: Text(
            '${results.length} results for "$query"',
            style: AppTextStyles.dmSans(
              fontSize: 12,
              color: Colors.white.withValues(alpha: 0.3),
            ),
          ),
        ),
        Expanded(
          child: results.isEmpty
              ? Center(
                  child: Text(
                    'No results.',
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      color: AppColors.textMuted,
                    ),
                  ),
                )
              : GridView.builder(
                  padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 3,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                    childAspectRatio: 2 / 3,
                  ),
                  itemCount: results.length,
                  itemBuilder: (context, i) {
                    final t = results[i];
                    return PosterCard(
                      title: t.name,
                      subtitle: t.year > 0 ? '${t.year}' : null,
                      gradientSeed: t.gradientSeed,
                      imageUrl: TmdbService.posterUrl(t.posterPath),
                      onTap: () => _openTitle(t),
                    );
                  },
                ),
        ),
      ],
    );
  }
}
