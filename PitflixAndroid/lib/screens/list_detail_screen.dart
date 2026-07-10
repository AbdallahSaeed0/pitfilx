import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../models/title_item.dart';
import '../services/local_backend_service.dart';
import '../services/supabase_service.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Poster grid for a single list's items — real data, from either the local
/// Pitflix.API backend (already fully resolved, no TMDB call needed) or
/// Supabase's list_items (each resolved into a title via TMDB), depending on
/// [AppConfig.useLocalBackend].
class ListDetailScreen extends StatefulWidget {
  final String listId;
  final String listName;

  const ListDetailScreen({
    super.key,
    required this.listId,
    required this.listName,
  });

  @override
  State<ListDetailScreen> createState() => _ListDetailScreenState();
}

class _ListDetailScreenState extends State<ListDetailScreen> {
  List<TitleItem>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (widget.listId.startsWith('local-')) {
      // Created via "Create List" this session — not persisted to Supabase yet.
      setState(() {
        _items = const [];
        _error = null;
      });
      return;
    }

    try {
      List<TitleItem> resolvedItems;
      if (AppConfig.useLocalBackend) {
        resolvedItems = await LocalBackendService.fetchListItems(
          int.parse(widget.listId),
        );
      } else {
        final rows = await SupabaseService.fetchListItems(widget.listId);
        final resolved = await Future.wait(
          rows.map((row) async {
            final kind = TmdbService.kindFromMediaType(row.mediaType);
            return TmdbService.fetchDetails(row.tmdbId, kind);
          }),
        );
        resolvedItems = resolved.whereType<TitleItem>().toList();
      }
      if (!mounted) return;
      setState(() {
        _items = resolvedItems;
        _error = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
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
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
              child: Row(
                children: [
                  CircleIconButton(
                    icon: Icons.arrow_back_ios_new,
                    background: AppColors.bgCard,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      widget.listName.toUpperCase(),
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.bebas(
                        fontSize: 22,
                        letterSpacing: 0.1,
                        color: AppColors.logoAccent,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(child: _buildBody()),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return _CenteredMessage(
        text: "Couldn't load this list.\n$_error",
        onRetry: _load,
      );
    }
    if (_items == null) {
      return const PosterGridSkeleton();
    }
    if (_items!.isEmpty) {
      return const _CenteredMessage(text: 'Nothing in this list yet.');
    }

    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2 / 3,
      ),
      itemCount: _items!.length,
      itemBuilder: (context, i) {
        final t = _items![i];
        return PosterCard(
          title: t.name,
          subtitle: '${t.year}',
          gradientSeed: t.gradientSeed,
          imageUrl: TmdbService.posterUrl(t.posterPath),
          onTap: () => _openTitle(t),
        );
      },
    );
  }
}

class _CenteredMessage extends StatelessWidget {
  final String text;
  final VoidCallback? onRetry;

  const _CenteredMessage({required this.text, this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              text,
              textAlign: TextAlign.center,
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textMuted,
              ),
            ),
            if (onRetry != null) ...[
              const SizedBox(height: 12),
              GestureDetector(
                onTap: onRetry,
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
          ],
        ),
      ),
    );
  }
}
