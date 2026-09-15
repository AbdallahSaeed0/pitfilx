import 'package:flutter/material.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';
import '../widgets/pitflix_network_image.dart';

/// Grid of TMDB poster/backdrop candidates for a title — reached from the
/// Title Detail "..." menu's "Change Poster"/"Change Backdrop" actions.
/// Candidates come straight from TMDB (no desktop backend involved), so this
/// works for any title with a tmdbId, not just ones matched in the desktop's
/// local scanned-media library. Selecting one saves it to this account's
/// `user_title_customizations` row in Supabase, then pops with the chosen
/// relative path so the caller can update its UI.
class ImagePickerScreen extends StatefulWidget {
  final int tmdbId;
  final TitleKind kind;
  final bool isBackdrop;

  const ImagePickerScreen({
    super.key,
    required this.tmdbId,
    required this.kind,
    required this.isBackdrop,
  });

  @override
  State<ImagePickerScreen> createState() => _ImagePickerScreenState();
}

class _ImagePickerScreenState extends State<ImagePickerScreen> {
  List<Map<String, dynamic>>? _images;
  String? _error;
  String? _savingPath;

  String get _mediaType => widget.kind == TitleKind.movie ? 'movie' : 'series';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final images = await TmdbService.fetchImages(
        widget.tmdbId,
        widget.kind,
        backdrops: widget.isBackdrop,
      );
      if (!mounted) return;
      setState(() => _images = images);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Future<void> _select(String filePath) async {
    setState(() => _savingPath = filePath);
    try {
      if (widget.isBackdrop) {
        await UserLibraryService.setCustomBackdrop(
          widget.tmdbId,
          _mediaType,
          filePath,
        );
      } else {
        await UserLibraryService.setCustomPoster(
          widget.tmdbId,
          _mediaType,
          filePath,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(filePath);
    } catch (e) {
      if (!mounted) return;
      setState(() => _savingPath = null);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save: $e")));
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
                  Text(
                    widget.isBackdrop ? 'CHANGE BACKDROP' : 'CHANGE POSTER',
                    style: AppTextStyles.bebas(
                      fontSize: 20,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
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
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load images.\n$_error",
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

    if (_images == null) {
      return widget.isBackdrop
          ? const ListRowsSkeleton(rowHeight: 100, count: 5)
          : const PosterGridSkeleton();
    }

    if (_images!.isEmpty) {
      return Center(
        child: Text(
          'No images available.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }

    if (widget.isBackdrop) {
      return ListView.separated(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
        itemCount: _images!.length,
        separatorBuilder: (_, _) => const SizedBox(height: 10),
        itemBuilder: (context, i) => _backdropTile(_images![i]),
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
      itemCount: _images!.length,
      itemBuilder: (context, i) => _posterTile(_images![i]),
    );
  }

  Widget _posterTile(Map<String, dynamic> image) {
    final path = image['filePath'] as String? ?? '';
    final saving = _savingPath == path;
    return GestureDetector(
      onTap: saving ? null : () => _select(path),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(AppSpacing.posterRadius),
        child: Stack(
          fit: StackFit.expand,
          children: [
            const ColoredBox(color: AppColors.bgCard),
            PitflixNetworkImage(
              TmdbService.posterUrl(path) ?? '',
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
