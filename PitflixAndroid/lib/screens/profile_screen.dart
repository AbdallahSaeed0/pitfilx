import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../data/mock_data.dart';
import '../models/title_item.dart';
import '../services/cover_photo_store.dart';
import '../services/local_backend_service.dart';
import '../services/profile_photo_store.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../services/friends_store.dart';
import '../utils/format_minutes.dart';
import '../utils/watch_later.dart';
import '../widgets/widgets.dart';
import 'edit_profile_screen.dart';
import 'friends_screen.dart';
import 'lists_screen.dart';
import 'settings_screen.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';

class ProfileScreen extends StatefulWidget {
  final VoidCallback onOpenStats;

  const ProfileScreen({super.key, required this.onOpenStats});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  List<TitleItem>? _watchLater;
  String? _watchLaterError;
  List<TitleItem>? _recentMovies;
  List<TitleItem>? _recentSeries;
  String? _recentError;
  int? _totalWatchTimeMinutes;
  int? _totalEpisodesWatched;
  int? _totalMoviesWatched;

  @override
  void initState() {
    super.initState();
    _loadWatchLater();
    _loadRecentlyWatched();
  }

  Future<void> _loadWatchLater({bool forceRefresh = false}) async {
    setState(() => _watchLaterError = null);
    try {
      final items = await fetchWatchLaterItems(forceRefresh: forceRefresh);
      if (!mounted) return;
      setState(() => _watchLater = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _watchLaterError = e.toString());
    }
  }

  Future<void> _loadRecentlyWatched() async {
    setState(() => _recentError = null);
    try {
      final result = await LocalBackendService.fetchRecentlyWatched();
      if (!mounted) return;
      setState(() {
        _recentMovies = result.movies;
        _recentSeries = result.series;
        _totalWatchTimeMinutes = result.totalWatchTimeMinutes;
        _totalEpisodesWatched = result.totalEpisodesWatched;
        _totalMoviesWatched = result.totalMoviesWatched;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _recentError = e.toString());
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

  void _openSettings() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const SettingsScreen()));
  }

  void _openEditProfile() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const EditProfileScreen()));
  }

  Future<void> _pickCover() async {
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.bgCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(
                Icons.photo_camera_outlined,
                color: AppColors.textPrimary,
              ),
              title: Text(
                'Take Photo',
                style: AppTextStyles.dmSans(fontSize: 15),
              ),
              onTap: () => Navigator.of(context).pop(ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(
                Icons.photo_library_outlined,
                color: AppColors.textPrimary,
              ),
              title: Text(
                'Choose from Gallery',
                style: AppTextStyles.dmSans(fontSize: 15),
              ),
              onTap: () => Navigator.of(context).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      final picked = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1080,
        maxHeight: 400,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      CoverPhotoStore.photoBytes.value = bytes;
    } catch (_) {
      // Picker dismissed or permission denied — silently ignore.
    }
  }

  void _openFriends() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const FriendsScreen()));
  }

  void _openLists() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const ListsScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        bottom: false,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            SizedBox(
              height: 146,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  ValueListenableBuilder<Uint8List?>(
                    valueListenable: CoverPhotoStore.photoBytes,
                    builder: (context, coverBytes, _) => GestureDetector(
                      onTap: _pickCover,
                      child: SizedBox(
                        height: 104,
                        width: double.infinity,
                        child: Stack(
                          fit: StackFit.expand,
                          children: [
                            if (coverBytes != null)
                              Image.memory(coverBytes, fit: BoxFit.cover)
                            else
                              const DecoratedBox(
                                decoration: BoxDecoration(
                                  gradient: LinearGradient(
                                    begin: Alignment.topLeft,
                                    end: Alignment.bottomRight,
                                    colors: [
                                      AppColors.logoAccentDim,
                                      Color(0xFF1A0D2E),
                                    ],
                                  ),
                                ),
                              ),
                            Positioned(
                              right: 12,
                              bottom: 10,
                              child: Container(
                                width: 30,
                                height: 30,
                                decoration: const BoxDecoration(
                                  color: Color(0xBB000000),
                                  shape: BoxShape.circle,
                                ),
                                child: const Icon(
                                  Icons.camera_alt_outlined,
                                  size: 15,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  Positioned(
                    left: 20,
                    top: 66,
                    child: ValueListenableBuilder<Uint8List?>(
                      valueListenable: ProfilePhotoStore.photoBytes,
                      builder: (context, bytes, _) => Container(
                        padding: const EdgeInsets.all(4),
                        decoration: const BoxDecoration(
                          shape: BoxShape.circle,
                          color: AppColors.bgBase,
                        ),
                        child: Container(
                          width: 64,
                          height: 64,
                          clipBehavior: Clip.antiAlias,
                          decoration: const BoxDecoration(
                            color: AppColors.avatarBg,
                            shape: BoxShape.circle,
                          ),
                          alignment: Alignment.center,
                          child: bytes != null
                              ? Image.memory(
                                  bytes,
                                  fit: BoxFit.cover,
                                  width: 64,
                                  height: 64,
                                )
                              : Text(
                                  MockData.userInitials,
                                  style: AppTextStyles.bebas(
                                    fontSize: 26,
                                    color: AppColors.accent,
                                  ),
                                ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          MockData.userName,
                          style: AppTextStyles.dmSans(
                            fontSize: 18,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          MockData.userEmail,
                          style: AppTextStyles.dmSans(
                            fontSize: 12,
                            color: AppColors.textMuted,
                          ),
                        ),
                      ],
                    ),
                  ),
                  GestureDetector(
                    onTap: _openFriends,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.avatarBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppColors.borderInput,
                          width: 1,
                        ),
                      ),
                      child: ValueListenableBuilder(
                        valueListenable: FriendsStore.incoming,
                        builder: (context, incoming, _) => Stack(
                          clipBehavior: Clip.none,
                          children: [
                            const Icon(
                              Icons.people_outline,
                              size: 18,
                              color: AppColors.textPrimary,
                            ),
                            if (incoming.isNotEmpty)
                              Positioned(
                                right: -4,
                                top: -4,
                                child: Container(
                                  width: 8,
                                  height: 8,
                                  decoration: const BoxDecoration(
                                    color: AppColors.destructive,
                                    shape: BoxShape.circle,
                                  ),
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: _openEditProfile,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.avatarBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppColors.borderInput,
                          width: 1,
                        ),
                      ),
                      child: Text(
                        'Edit',
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  GestureDetector(
                    onTap: _openSettings,
                    child: Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: AppColors.avatarBg,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppColors.borderInput,
                          width: 1,
                        ),
                      ),
                      child: const Icon(
                        Icons.settings_outlined,
                        size: 18,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 0),
              child: Row(
                children: [
                  Expanded(
                    child: _QuickStatTile(
                      label: 'TV TIME',
                      value: _totalWatchTimeMinutes != null
                          ? formatMinutes(_totalWatchTimeMinutes!)
                          : '—',
                      onTap: widget.onOpenStats,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _QuickStatTile(
                      label: 'EPISODES',
                      value: _totalEpisodesWatched != null
                          ? '$_totalEpisodesWatched'
                          : '—',
                      onTap: widget.onOpenStats,
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _QuickStatTile(
                      label: 'MOVIES',
                      value: _totalMoviesWatched != null
                          ? '$_totalMoviesWatched'
                          : '—',
                      onTap: widget.onOpenStats,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: AppSpacing.sectionGap),
            SectionHeader(title: 'Watch Later', onSeeAll: _openLists),
            SizedBox(
              height: 132,
              child: _buildPosterRow(
                items: _watchLater,
                error: _watchLaterError,
                onRetry: _loadWatchLater,
              ),
            ),
            const SizedBox(height: AppSpacing.sectionGap),
            SectionHeader(title: 'Movies'),
            SizedBox(
              height: 132,
              child: _buildPosterRow(
                items: _recentMovies,
                error: _recentError,
                onRetry: _loadRecentlyWatched,
              ),
            ),
            const SizedBox(height: AppSpacing.sectionGap),
            SectionHeader(title: 'Series'),
            SizedBox(
              height: 132,
              child: _buildPosterRow(
                items: _recentSeries,
                error: _recentError,
                onRetry: _loadRecentlyWatched,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPosterRow({
    required List<TitleItem>? items,
    required String? error,
    required VoidCallback onRetry,
  }) {
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                "Couldn't load: $error",
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  color: AppColors.textMuted,
                ),
              ),
            ),
            GestureDetector(
              onTap: onRetry,
              child: Text(
                'Retry',
                style: AppTextStyles.dmSans(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.accent,
                ),
              ),
            ),
          ],
        ),
      );
    }

    if (items == null) {
      return const PosterRowSkeleton(width: 90, height: 132);
    }

    if (items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.screenPadding,
        ),
        child: Text(
          'Nothing here yet.',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: AppSpacing.screenPadding),
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
          onTap: () => _openTitle(t),
        );
      },
    );
  }
}

class _QuickStatTile extends StatelessWidget {
  final String label;
  final String value;
  final VoidCallback onTap;

  const _QuickStatTile({
    required this.label,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
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
            const SizedBox(height: 4),
            Text(
              'View stats',
              style: AppTextStyles.dmSans(
                fontSize: 10,
                color: AppColors.accent,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
