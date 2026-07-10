import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

/// Poster grid for a single list's items — real, per-account data from
/// Supabase's `user_list_items` (see UserLibraryService).
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
    try {
      final resolvedItems = await UserLibraryService.fetchListItems(
        widget.listId,
      );
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

  Future<void> _removeItem(TitleItem item) async {
    final removed = item;
    final index = _items!.indexOf(item);
    setState(() => _items!.remove(item));
    try {
      await UserLibraryService.removeFromList(
        widget.listId,
        removed.tmdbId!,
        removed.isShow ? 'series' : 'movie',
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _items!.insert(index, removed));
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't remove: $e")));
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
      return ErrorRetry(
        message: "Couldn't load this list.\n$_error",
        onRetry: _load,
      );
    }
    if (_items == null) {
      return const PosterGridSkeleton();
    }
    if (_items!.isEmpty) {
      return const EmptyState(message: 'Nothing in this list yet.');
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
        final poster = PosterCard(
          title: t.name,
          subtitle: '${t.year}',
          gradientSeed: t.gradientSeed,
          imageUrl: TmdbService.posterUrl(t.posterPath),
          onTap: () => _openTitle(t),
        );
        return Dismissible(
          key: ValueKey(t.id),
          direction: DismissDirection.horizontal,
          background: _DismissBackground(alignment: Alignment.centerLeft),
          secondaryBackground: _DismissBackground(
            alignment: Alignment.centerRight,
          ),
          onDismissed: (_) => _removeItem(t),
          child: poster,
        );
      },
    );
  }
}

class _DismissBackground extends StatelessWidget {
  final Alignment alignment;

  const _DismissBackground({required this.alignment});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.destructive.withValues(alpha: 0.85),
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
      ),
      alignment: alignment,
      padding: const EdgeInsets.symmetric(horizontal: 14),
      child: const Icon(
        Icons.delete_outline,
        color: AppColors.textPrimary,
        size: 20,
      ),
    );
  }
}
