import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/favorites.dart';
import '../widgets/widgets.dart';
import '../widgets/pitflix_network_image.dart';

/// Lets Profile's cover photo be set from a favorite movie/series' backdrop
/// instead of only the phone's gallery. Two steps: pick which favorite title
/// (all of them, movies and series alike), then pick one of that title's
/// several TMDB backdrops (same gallery [ImagePickerScreen]'s "Change
/// Backdrop" uses) — not just a single backdrop per title. Unlike the
/// gallery flow (Profile._pickCover), there's no upload step: the chosen
/// backdrop is already TMDB-hosted, so this just writes the full backdrop
/// URL straight to `profiles.cover_url` via [SocialService.updateProfile]
/// and pops with that URL for the caller to reflect immediately.
class CoverBackdropPickerScreen extends StatefulWidget {
  const CoverBackdropPickerScreen({super.key});

  @override
  State<CoverBackdropPickerScreen> createState() =>
      _CoverBackdropPickerScreenState();
}

class _CoverBackdropPickerScreenState
    extends State<CoverBackdropPickerScreen> {
  List<TitleItem>? _favorites;
  String? _favoritesError;

  TitleItem? _selectedTitle;
  List<Map<String, dynamic>>? _backdrops;
  String? _backdropsError;
  String? _savingPath;

  @override
  void initState() {
    super.initState();
    _loadFavorites();
  }

  Future<void> _loadFavorites() async {
    setState(() => _favoritesError = null);
    try {
      final listId = await findFavoritesListId();
      final items = listId == null
          ? const <TitleItem>[]
          : await UserLibraryService.fetchListItems(listId);
      if (!mounted) return;
      setState(() => _favorites = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _favoritesError = e.toString());
    }
  }

  Future<void> _openTitle(TitleItem title) async {
    setState(() {
      _selectedTitle = title;
      _backdrops = null;
      _backdropsError = null;
    });
    try {
      final images = await TmdbService.fetchImages(
        title.tmdbId!,
        title.kind,
        backdrops: true,
      );
      if (!mounted) return;
      setState(() => _backdrops = images);
    } catch (e) {
      if (!mounted) return;
      setState(() => _backdropsError = e.toString());
    }
  }

  Future<void> _select(String filePath) async {
    setState(() => _savingPath = filePath);
    try {
      final url = TmdbService.backdropUrl(filePath)!;
      await SocialService.updateProfile(coverUrl: url);
      if (!mounted) return;
      Navigator.of(context).pop(url);
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingPath = null);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save cover: $e")));
    }
  }

  void _back() {
    if (_selectedTitle != null) {
      setState(() {
        _selectedTitle = null;
        _backdrops = null;
        _backdropsError = null;
      });
    } else {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final title = _selectedTitle;
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
                    onTap: _back,
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      title == null
                          ? 'CHOOSE FROM FAVORITES'
                          : title.name.toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.bebas(
                        fontSize: 18,
                        letterSpacing: 0.1,
                        color: AppColors.logoAccent,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: title == null ? _buildFavoritesGrid() : _buildBackdrops(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFavoritesGrid() {
    if (_favoritesError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load favorites.\n$_favoritesError",
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 12),
              GestureDetector(
                onTap: _loadFavorites,
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

    final favorites = _favorites;
    if (favorites == null) {
      return const PosterGridSkeleton();
    }

    if (favorites.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Text(
            'Add movies or series to Favorites to pick a cover from them.',
            textAlign: TextAlign.center,
            style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
          ),
        ),
      );
    }

    return GridView.builder(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 2 / 3,
      ),
      itemCount: favorites.length,
      itemBuilder: (context, i) {
        final t = favorites[i];
        return GestureDetector(
          onTap: t.tmdbId == null ? null : () => _openTitle(t),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.posterRadius),
            child: Stack(
              fit: StackFit.expand,
              children: [
                const ColoredBox(color: AppColors.bgCard),
                if (t.posterPath != null)
                  PitflixNetworkImage(
                    TmdbService.posterUrl(t.posterPath) ?? '',
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const SizedBox.shrink(),
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(6, 16, 6, 6),
                    decoration: const BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: [Color(0x00000000), Color(0xCC000000)],
                      ),
                    ),
                    child: Text(
                      t.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildBackdrops() {
    if (_backdropsError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load images.\n$_backdropsError",
                textAlign: TextAlign.center,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textMuted,
                ),
              ),
              const SizedBox(height: 12),
              GestureDetector(
                onTap: () => _openTitle(_selectedTitle!),
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

    final backdrops = _backdrops;
    if (backdrops == null) {
      return const ListRowsSkeleton(rowHeight: 100, count: 5);
    }

    if (backdrops.isEmpty) {
      return Center(
        child: Text(
          'No images available.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: backdrops.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) => _backdropTile(backdrops[i]),
    );
  }

  Widget _backdropTile(Map<String, dynamic> image) {
    final path = image['filePath'] as String? ?? '';
    final saving = _savingPath == path;
    return GestureDetector(
      onTap: saving ? null : () => _select(path),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
        child: SizedBox(
          height: 100,
          child: Stack(
            fit: StackFit.expand,
            children: [
              const ColoredBox(color: AppColors.bgCard),
              PitflixNetworkImage(
                TmdbService.backdropUrl(path) ?? '',
                fit: BoxFit.cover,
                errorBuilder: (context, error, stackTrace) =>
                    const SizedBox.shrink(),
              ),
              if (saving)
                const ColoredBox(
                  color: Color(0x99000000),
                  child: Center(
                    child: CircularProgressIndicator(
                      color: AppColors.accent,
                      strokeWidth: 2,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
