import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/season.dart';
import '../models/title_item.dart';
import '../services/app_settings.dart';
import '../services/cover_photo_store.dart';
import '../services/profile_photo_store.dart';
import '../services/social_service.dart';
import '../services/tmdb_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/crop_image.dart';
import '../utils/favorites.dart';
import '../widgets/widgets.dart';
import 'import_data_screen.dart';
import 'root_shell.dart';
import '../widgets/pitflix_network_image.dart';

/// First-run tour shown once, right after sign-up (see
/// SignUpScreen._signUp) — never on a plain login. Each step is skippable
/// individually via "Skip" (top-right, exits the whole wizard immediately)
/// or completable via its own action; every step is best-effort (a failed
/// upload/save here just moves on, since none of this is required to use
/// the app — Profile/Edit Profile/Settings all offer the same actions again
/// later).
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _pageController = PageController();
  int _page = 0;
  static const _totalPages = 6;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _finish() {
    Navigator.of(
      context,
    ).pushReplacement(MaterialPageRoute(builder: (_) => const RootShell()));
  }

  void _next() {
    if (_page >= _totalPages - 1) {
      _finish();
      return;
    }
    _pageController.nextPage(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeOutCubic,
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
                  Expanded(
                    child: Row(
                      children: [
                        for (var i = 0; i < _totalPages; i++) ...[
                          if (i > 0) const SizedBox(width: 6),
                          Expanded(
                            child: Container(
                              height: 4,
                              decoration: BoxDecoration(
                                color: i <= _page
                                    ? AppColors.accent
                                    : AppColors.progressTrack,
                                borderRadius: BorderRadius.circular(2),
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: 14),
                  GestureDetector(
                    onTap: _finish,
                    child: Text(
                      'Skip',
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: PageView(
                controller: _pageController,
                physics: const NeverScrollableScrollPhysics(),
                onPageChanged: (i) => setState(() => _page = i),
                children: [
                  _WelcomeAvatarStep(onNext: _next),
                  _CoverStep(onNext: _next),
                  _GenresStep(onNext: _next),
                  _FavoritesStep(onNext: _next),
                  _CurrentlyWatchingStep(onNext: _next),
                  _ImportIntroStep(onFinish: _finish),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Shared step chrome — icon-free header block + a bottom continue button,
/// used by every step below so they read as one consistent wizard instead
/// of six differently-laid-out screens.
class _StepScaffold extends StatelessWidget {
  final String title;
  final String subtitle;
  final Widget child;
  final String buttonLabel;
  final VoidCallback onContinue;

  const _StepScaffold({
    required this.title,
    required this.subtitle,
    required this.child,
    required this.onContinue,
    this.buttonLabel = 'Continue',
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: AppTextStyles.bebas(fontSize: 26, letterSpacing: 0.1),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              color: AppColors.textSecondary,
              height: 1.4,
            ),
          ),
          const SizedBox(height: 24),
          Expanded(child: child),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: onContinue,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.buttonPurple,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: Text(
                buttonLabel.toUpperCase(),
                style: AppTextStyles.bebas(
                  fontSize: 18,
                  letterSpacing: 0.1,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _WelcomeAvatarStep extends StatefulWidget {
  final VoidCallback onNext;

  const _WelcomeAvatarStep({required this.onNext});

  @override
  State<_WelcomeAvatarStep> createState() => _WelcomeAvatarStepState();
}

class _WelcomeAvatarStepState extends State<_WelcomeAvatarStep> {
  bool _uploading = false;

  Future<void> _pick() async {
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
              title: Text('Take Photo', style: AppTextStyles.dmSans(fontSize: 15)),
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
    if (source == null || !mounted) return;
    try {
      final picked = await ImagePicker().pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
      );
      if (picked == null || !mounted) return;
      final bytes = await cropPickedImage(
        context,
        picked.path,
        isCircle: true,
      );
      if (bytes == null || !mounted) return; // Cancelled out of the cropper.
      ProfilePhotoStore.photoBytes.value = bytes;
      setState(() => _uploading = true);
      final url = await SocialService.uploadProfileImage(
        bytes: bytes,
        isCover: false,
        contentType: 'image/jpeg',
      );
      ProfilePhotoStore.avatarUrl.value = url;
      if (!mounted) return;
      setState(() => _uploading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save photo: $e")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      title: 'Welcome to Pitflix',
      subtitle: "Let's set a few things up — this only takes a minute.",
      onContinue: widget.onNext,
      buttonLabel: 'Continue',
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            GestureDetector(
              onTap: _uploading ? null : _pick,
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  ValueListenableBuilder<Uint8List?>(
                    valueListenable: ProfilePhotoStore.photoBytes,
                    builder: (context, bytes, _) => Container(
                      width: 120,
                      height: 120,
                      clipBehavior: Clip.antiAlias,
                      decoration: BoxDecoration(
                        color: AppColors.avatarBg,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.borderInput, width: 2),
                      ),
                      alignment: Alignment.center,
                      child: bytes != null
                          ? Image.memory(bytes, fit: BoxFit.cover, width: 120, height: 120)
                          : const Icon(
                              Icons.person_outline,
                              size: 48,
                              color: AppColors.textMuted,
                            ),
                    ),
                  ),
                  if (_uploading)
                    const Positioned.fill(
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: Color(0x99000000),
                          shape: BoxShape.circle,
                        ),
                        child: Center(
                          child: SizedBox(
                            width: 22,
                            height: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: AppColors.textPrimary,
                            ),
                          ),
                        ),
                      ),
                    ),
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: const BoxDecoration(
                        color: AppColors.accent,
                        shape: BoxShape.circle,
                      ),
                      alignment: Alignment.center,
                      child: const Icon(
                        Icons.camera_alt_outlined,
                        size: 16,
                        color: AppColors.bgBase,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Add a profile picture so friends recognize you',
              textAlign: TextAlign.center,
              style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
            ),
          ],
        ),
      ),
    );
  }
}

class _CoverStep extends StatefulWidget {
  final VoidCallback onNext;

  const _CoverStep({required this.onNext});

  @override
  State<_CoverStep> createState() => _CoverStepState();
}

class _CoverStepState extends State<_CoverStep> {
  bool _uploading = false;

  Future<void> _pick() async {
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
              title: Text('Take Photo', style: AppTextStyles.dmSans(fontSize: 15)),
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
    if (source == null || !mounted) return;
    try {
      // NOT constrained to the cover's own tiny display size — a portrait
      // source photo scaled down to fit a short max height before cropping
      // would leave a genuinely low-resolution result that looks blurry
      // once stretched across the full-width cover. Picking at full
      // resolution and letting the cropper produce the actual cover-shaped
      // rectangle keeps real detail in the final image.
      final picked = await ImagePicker().pickImage(
        source: source,
        maxWidth: 2160,
        maxHeight: 2160,
      );
      if (picked == null || !mounted) return;
      final bytes = await cropPickedImage(
        context,
        picked.path,
        aspectRatio: 1080 / 400,
      );
      if (bytes == null || !mounted) return; // Cancelled out of the cropper.
      CoverPhotoStore.photoBytes.value = bytes;
      setState(() => _uploading = true);
      await SocialService.uploadProfileImage(
        bytes: bytes,
        isCover: true,
        contentType: 'image/jpeg',
      );
      if (!mounted) return;
      setState(() => _uploading = false);
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save cover: $e")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      title: 'Add a cover photo',
      subtitle: 'Shown at the top of your profile — pick something you love.',
      onContinue: widget.onNext,
      child: Center(
        child: GestureDetector(
          onTap: _uploading ? null : _pick,
          child: ValueListenableBuilder<Uint8List?>(
            valueListenable: CoverPhotoStore.photoBytes,
            builder: (context, bytes, _) => Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  height: 150,
                  width: double.infinity,
                  clipBehavior: Clip.antiAlias,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
                    gradient: const LinearGradient(
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                      colors: [AppColors.logoAccentDim, Color(0xFF1A0D2E)],
                    ),
                  ),
                  child: bytes != null
                      ? Image.memory(bytes, fit: BoxFit.cover)
                      : null,
                ),
                if (bytes == null)
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.add_photo_alternate_outlined,
                        size: 28,
                        color: AppColors.textPrimary,
                      ),
                      const SizedBox(height: 6),
                      Text(
                        'Tap to choose',
                        style: AppTextStyles.dmSans(
                          fontSize: 12,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ],
                  ),
                if (_uploading)
                  const Positioned.fill(
                    child: DecoratedBox(
                      decoration: BoxDecoration(color: Color(0x99000000)),
                      child: Center(
                        child: SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2.4,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

const _genreOptions = [
  (name: 'Action & Adventure', id: 28),
  (name: 'Comedy', id: 35),
  (name: 'Drama', id: 18),
  (name: 'Sci-Fi & Fantasy', id: 878),
  (name: 'Animation', id: 16),
  (name: 'Crime', id: 80),
  (name: 'Mystery', id: 9648),
  (name: 'Documentary', id: 99),
  (name: 'Family', id: 10751),
  (name: 'Horror', id: 27),
  (name: 'Romance', id: 10749),
];

class _GenresStep extends StatefulWidget {
  final VoidCallback onNext;

  const _GenresStep({required this.onNext});

  @override
  State<_GenresStep> createState() => _GenresStepState();
}

class _GenresStepState extends State<_GenresStep> {
  final Set<int> _selected = {};

  void _continue() {
    if (_selected.isNotEmpty) AppSettings.setFavoriteGenreIds(_selected);
    widget.onNext();
  }

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      title: 'Pick a few genres',
      subtitle: 'Discover puts these front and center for you. Pick as many as you like.',
      onContinue: _continue,
      child: Wrap(
        spacing: 10,
        runSpacing: 10,
        children: [
          for (final genre in _genreOptions)
            GestureDetector(
              onTap: () => setState(() {
                if (!_selected.remove(genre.id)) _selected.add(genre.id);
              }),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: _selected.contains(genre.id)
                      ? AppColors.buttonPurple
                      : AppColors.bgCard,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(
                    color: _selected.contains(genre.id)
                        ? AppColors.buttonPurple
                        : AppColors.borderInput,
                  ),
                ),
                child: Text(
                  genre.name,
                  style: AppTextStyles.dmSans(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _FavoritesStep extends StatefulWidget {
  final VoidCallback onNext;

  const _FavoritesStep({required this.onNext});

  @override
  State<_FavoritesStep> createState() => _FavoritesStepState();
}

class _FavoritesStepState extends State<_FavoritesStep> {
  List<TitleItem>? _topRated;
  List<TitleItem>? _searchResults;
  String? _listId;
  final Set<String> _adding = {};
  final Set<String> _added = {};
  final _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final results = await Future.wait([
        TmdbService.fetchTopRated(TitleKind.movie),
        TmdbService.fetchTopRated(TitleKind.show),
      ]);
      // Interleaved (not all movies then all shows) so the grid is a mix
      // top to bottom instead of needing a long scroll to see any shows.
      final combined = <TitleItem>[];
      for (var i = 0; i < 10; i++) {
        if (i < results[0].length) combined.add(results[0][i]);
        if (i < results[1].length) combined.add(results[1][i]);
      }
      if (!mounted) return;
      setState(() => _topRated = combined);
    } catch (_) {
      if (!mounted) return;
      setState(() => _topRated = const []);
    }
  }

  void _onQueryChanged(String query) {
    _debounce?.cancel();
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      setState(() => _searchResults = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      try {
        final results = await TmdbService.search(trimmed);
        if (!mounted) return;
        setState(() => _searchResults = results);
      } catch (_) {
        if (!mounted) return;
        setState(() => _searchResults = const []);
      }
    });
  }

  Future<void> _toggleFavorite(TitleItem title) async {
    if (title.tmdbId == null) return;
    final key = '${title.tmdbId}-${title.kind.name}';
    if (_adding.contains(key)) return;
    final mediaType = title.isShow ? 'series' : 'movie';
    setState(() => _adding.add(key));
    try {
      _listId ??= await findFavoritesListId();
      final listId = _listId;
      if (listId == null) return;
      if (_added.contains(key)) {
        await UserLibraryService.removeFromList(listId, title.tmdbId!, mediaType);
        if (!mounted) return;
        setState(() {
          _adding.remove(key);
          _added.remove(key);
        });
      } else {
        await UserLibraryService.addToList(
          listId,
          tmdbId: title.tmdbId!,
          mediaType: mediaType,
          title: title.name,
          posterPath: title.posterPath,
        );
        if (!mounted) return;
        setState(() {
          _adding.remove(key);
          _added.add(key);
        });
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _adding.remove(key));
    }
  }

  @override
  Widget build(BuildContext context) {
    final showingSearch = _searchController.text.trim().isNotEmpty;
    final items = showingSearch ? _searchResults : _topRated;
    return _StepScaffold(
      title: 'A few favorites?',
      subtitle: 'Tap anything you love — they\'ll show up in your Favorites right away.',
      onContinue: widget.onNext,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.borderInput, width: 1.5),
            ),
            child: Row(
              children: [
                const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    onChanged: (v) {
                      setState(() {}); // Toggles between top-rated/search view.
                      _onQueryChanged(v);
                    },
                    style: AppTextStyles.dmSans(fontSize: 14),
                    decoration: InputDecoration.collapsed(
                      hintText: 'Search movies & series',
                      hintStyle: AppTextStyles.dmSans(
                        fontSize: 14,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: items == null
                ? const Center(
                    child: CircularProgressIndicator(color: AppColors.accent),
                  )
                : items.isEmpty
                ? EmptyState(
                    message: showingSearch ? 'No matches.' : 'Nothing to show right now.',
                  )
                : GridView.builder(
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 3,
                      crossAxisSpacing: 10,
                      mainAxisSpacing: 10,
                      childAspectRatio: 2 / 3,
                    ),
                    itemCount: items.length,
                    itemBuilder: (context, i) {
                      final t = items[i];
                      final key = '${t.tmdbId}-${t.kind.name}';
                      final added = _added.contains(key);
                      return GestureDetector(
                        onTap: () => _toggleFavorite(t),
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(AppSpacing.posterRadius),
                          child: Stack(
                            fit: StackFit.expand,
                            children: [
                              const ColoredBox(color: AppColors.bgCard),
                              PitflixNetworkImage(
                                TmdbService.posterUrl(t.posterPath) ?? '',
                                fit: BoxFit.cover,
                                errorBuilder: (context, error, stackTrace) =>
                                    const SizedBox.shrink(),
                              ),
                              Positioned(
                                right: 6,
                                top: 6,
                                child: Container(
                                  width: 26,
                                  height: 26,
                                  decoration: BoxDecoration(
                                    color: const Color(0xBB000000),
                                    shape: BoxShape.circle,
                                    border: added
                                        ? Border.all(color: AppColors.destructive)
                                        : null,
                                  ),
                                  alignment: Alignment.center,
                                  child: Icon(
                                    added ? Icons.favorite : Icons.favorite_border,
                                    size: 14,
                                    color: added
                                        ? AppColors.destructive
                                        : AppColors.textPrimary,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

/// One show the user picked in [_CurrentlyWatchingStep], with how many
/// episodes (in season/episode order) they said they'd already seen.
class _InProgressShow {
  final TitleItem title;
  final int episodesWatched;

  const _InProgressShow({required this.title, required this.episodesWatched});
}

class _CurrentlyWatchingStep extends StatefulWidget {
  final VoidCallback onNext;

  const _CurrentlyWatchingStep({required this.onNext});

  @override
  State<_CurrentlyWatchingStep> createState() => _CurrentlyWatchingStepState();
}

class _CurrentlyWatchingStepState extends State<_CurrentlyWatchingStep> {
  final _searchController = TextEditingController();
  Timer? _debounce;
  List<TitleItem>? _searchResults;
  final List<_InProgressShow> _added = [];
  final Set<int> _addedIds = {};

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  void _onQueryChanged(String query) {
    _debounce?.cancel();
    final trimmed = query.trim();
    if (trimmed.isEmpty) {
      setState(() => _searchResults = null);
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 400), () async {
      try {
        final results = await TmdbService.search(trimmed, kindFilter: TitleKind.show);
        if (!mounted) return;
        setState(() => _searchResults = results);
      } catch (_) {
        if (!mounted) return;
        setState(() => _searchResults = const []);
      }
    });
  }

  Future<void> _openEpisodePicker(TitleItem show) async {
    if (show.tmdbId == null || _addedIds.contains(show.tmdbId)) return;
    final result = await showModalBottomSheet<_InProgressShow>(
      context: context,
      backgroundColor: AppColors.bgCard,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _EpisodeCountSheet(show: show),
    );
    if (result == null || !mounted) return;
    setState(() {
      _added.add(result);
      _addedIds.add(show.tmdbId!);
      _searchController.clear();
      _searchResults = null;
    });
    _writeProgress(result);
  }

  /// Marks episodes 1..[_InProgressShow.episodesWatched] watched, in season/
  /// episode order — best-effort, same "don't block onboarding on a network
  /// hiccup" spirit as every other step here.
  Future<void> _writeProgress(_InProgressShow entry) async {
    try {
      final details = await TmdbService.fetchDetails(entry.title.tmdbId!, TitleKind.show);
      final seasons = (details?.seasons ?? const <Season>[])
          .where((s) => s.number > 0) // Skip "Specials" (season 0).
          .toList()
        ..sort((a, b) => a.number.compareTo(b.number));

      final toMark = <Map<String, dynamic>>[];
      var remaining = entry.episodesWatched;
      for (final season in seasons) {
        if (remaining <= 0) break;
        for (final ep in season.episodes) {
          if (remaining <= 0) break;
          toMark.add({'season_number': season.number, 'episode_number': ep.number});
          remaining--;
        }
      }
      if (toMark.isEmpty) return;

      await UserLibraryService.bulkSetEpisodesWatched(entry.title.tmdbId!, toMark);
      await UserLibraryService.logWatched(
        tmdbId: entry.title.tmdbId!,
        mediaType: 'series',
        title: entry.title.name,
        posterPath: entry.title.posterPath,
        releaseYear: entry.title.year > 0 ? entry.title.year : null,
        status: 'watching',
      );
    } catch (_) {
      // Best-effort — the show still shows as "added" in this step's list
      // either way; worst case the user re-marks progress later normally.
    }
  }

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      title: 'Already watching something?',
      subtitle: 'Search for it and tell us how far you got — we\'ll mark those '
          'episodes watched for you.',
      onContinue: widget.onNext,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 14),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: AppColors.borderInput, width: 1.5),
            ),
            child: Row(
              children: [
                const Icon(Icons.search, size: 18, color: AppColors.textMuted),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: _searchController,
                    onChanged: _onQueryChanged,
                    style: AppTextStyles.dmSans(fontSize: 14),
                    decoration: InputDecoration.collapsed(
                      hintText: 'Search series',
                      hintStyle: AppTextStyles.dmSans(
                        fontSize: 14,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          Expanded(
            child: _searchResults != null
                ? _buildSearchResults()
                : _buildAddedList(),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchResults() {
    final results = _searchResults!;
    if (results.isEmpty) {
      return const EmptyState(message: 'No matches.');
    }
    return ListView.separated(
      itemCount: results.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final t = results[i];
        final already = _addedIds.contains(t.tmdbId);
        return GestureDetector(
          onTap: already ? null : () => _openEpisodePicker(t),
          child: Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.bgCard,
              borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
            ),
            child: Row(
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(6),
                  child: SizedBox(
                    width: 36,
                    height: 52,
                    child: PitflixNetworkImage(
                      TmdbService.posterUrl(t.posterPath) ?? '',
                      fit: BoxFit.cover,
                      errorBuilder: (context, error, stackTrace) =>
                          const ColoredBox(color: AppColors.bgBase),
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    t.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.dmSans(fontSize: 13, fontWeight: FontWeight.w600),
                  ),
                ),
                Icon(
                  already ? Icons.check_circle : Icons.add_circle_outline,
                  size: 20,
                  color: already ? AppColors.success : AppColors.accent,
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildAddedList() {
    if (_added.isEmpty) {
      return const EmptyState(message: 'Nothing added yet — search above.');
    }
    return ListView.separated(
      itemCount: _added.length,
      separatorBuilder: (_, _) => const SizedBox(height: 8),
      itemBuilder: (context, i) {
        final entry = _added[i];
        return Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: AppColors.bgCard,
            borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
          ),
          child: Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: SizedBox(
                  width: 36,
                  height: 52,
                  child: PitflixNetworkImage(
                    TmdbService.posterUrl(entry.title.posterPath) ?? '',
                    fit: BoxFit.cover,
                    errorBuilder: (context, error, stackTrace) =>
                        const ColoredBox(color: AppColors.bgBase),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      entry.title.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTextStyles.dmSans(fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                    Text(
                      '${entry.episodesWatched} episodes watched',
                      style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.check_circle, size: 20, color: AppColors.success),
            ],
          ),
        );
      },
    );
  }
}

/// "Which season/episode are you on?" picker for one show, opened from
/// [_CurrentlyWatchingStep]. Rather than asking for a raw episode count (no
/// one thinks in "episode 37 overall" — they think "I'm on S3E5"), this
/// loads the show's real season/episode breakdown from TMDB and lets the
/// user pick the last episode they watched directly; everything up to and
/// including that pick is what [_CurrentlyWatchingStepState._writeProgress]
/// marks watched.
class _EpisodeCountSheet extends StatefulWidget {
  final TitleItem show;

  const _EpisodeCountSheet({required this.show});

  @override
  State<_EpisodeCountSheet> createState() => _EpisodeCountSheetState();
}

class _EpisodeCountSheetState extends State<_EpisodeCountSheet> {
  List<Season>? _seasons;
  int _seasonIndex = 0;
  int _episodeNumber = 1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final details = await TmdbService.fetchDetails(widget.show.tmdbId!, TitleKind.show);
    final seasons = (details?.seasons ?? const <Season>[])
        .where((s) => s.number > 0 && s.episodes.isNotEmpty) // Skip "Specials".
        .toList()
      ..sort((a, b) => a.number.compareTo(b.number));
    if (!mounted) return;
    setState(() {
      _seasons = seasons;
      _episodeNumber = seasons.isNotEmpty ? seasons.first.episodes.first.number : 1;
    });
  }

  /// Total episodes in every season before [_seasonIndex], plus the episodes
  /// up to and including [_episodeNumber] in the selected season — i.e. the
  /// flattened watched count [_CurrentlyWatchingStepState._writeProgress]
  /// expects.
  int _episodesWatchedCount(List<Season> seasons) {
    var count = 0;
    for (var i = 0; i < _seasonIndex; i++) {
      count += seasons[i].episodes.length;
    }
    count += _episodeNumber;
    return count;
  }

  @override
  Widget build(BuildContext context) {
    final seasons = _seasons;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(20, 20, 20, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.show.name,
              style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
            ),
            const SizedBox(height: 4),
            Text(
              'What\'s the last episode you watched?',
              style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 20),
            if (seasons == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(
                  child: CircularProgressIndicator(color: AppColors.accent),
                ),
              )
            else if (seasons.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(
                  "Couldn't load season data for this show.",
                  style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
                ),
              )
            else ...[
              Row(
                children: [
                  Expanded(
                    child: _PickerDropdown<int>(
                      label: 'Season',
                      value: _seasonIndex,
                      items: [
                        for (var i = 0; i < seasons.length; i++)
                          DropdownMenuItem(value: i, child: Text('Season ${seasons[i].number}')),
                      ],
                      onChanged: (i) => setState(() {
                        _seasonIndex = i!;
                        _episodeNumber = seasons[i].episodes.first.number;
                      }),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: _PickerDropdown<int>(
                      label: 'Episode',
                      value: _episodeNumber,
                      items: [
                        for (final ep in seasons[_seasonIndex].episodes)
                          DropdownMenuItem(value: ep.number, child: Text('Episode ${ep.number}')),
                      ],
                      onChanged: (n) => setState(() => _episodeNumber = n!),
                    ),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 20),
            ElevatedButton(
              onPressed: seasons == null || seasons.isEmpty
                  ? null
                  : () => Navigator.of(context).pop(
                      _InProgressShow(
                        title: widget.show,
                        episodesWatched: _episodesWatchedCount(seasons),
                      ),
                    ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.buttonPurple,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                elevation: 0,
              ),
              child: Text(
                'ADD',
                style: AppTextStyles.bebas(
                  fontSize: 18,
                  letterSpacing: 0.1,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PickerDropdown<T> extends StatelessWidget {
  final String label;
  final T value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?> onChanged;

  const _PickerDropdown({
    required this.label,
    required this.value,
    required this.items,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          decoration: BoxDecoration(
            color: AppColors.avatarBg,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.borderInput),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<T>(
              value: value,
              isExpanded: true,
              dropdownColor: AppColors.bgCard,
              style: AppTextStyles.dmSans(fontSize: 14, color: AppColors.textPrimary),
              icon: const Icon(Icons.keyboard_arrow_down, color: AppColors.textMuted),
              items: items,
              onChanged: onChanged,
            ),
          ),
        ),
      ],
    );
  }
}

class _ImportIntroStep extends StatelessWidget {
  final VoidCallback onFinish;

  const _ImportIntroStep({required this.onFinish});

  @override
  Widget build(BuildContext context) {
    return _StepScaffold(
      title: "You're all set!",
      subtitle: 'One more thing — if you tracked shows elsewhere before, bring that '
          'history with you instead of starting from zero.',
      onContinue: onFinish,
      buttonLabel: 'Get Started',
      child: Column(
        children: [
          _ImportOptionCard(
            icon: Icons.movie_creation_outlined,
            title: 'Import from Letterboxd',
            subtitle: 'Watched movies, ratings, and your watchlist.',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const ImportDataScreen(source: ImportSource.letterboxd),
              ),
            ),
          ),
          const SizedBox(height: 12),
          _ImportOptionCard(
            icon: Icons.tv_outlined,
            title: 'Import from TV Time',
            subtitle: 'Watched episodes and followed shows.',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => const ImportDataScreen(source: ImportSource.tvTime),
              ),
            ),
          ),
          const Spacer(),
          Text(
            'You can always do this later from Settings > Library.',
            textAlign: TextAlign.center,
            style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _ImportOptionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ImportOptionCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.bgCard,
          borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.avatarBg,
                borderRadius: BorderRadius.circular(10),
              ),
              alignment: Alignment.center,
              child: Icon(icon, size: 20, color: AppColors.accent),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: Color(0x40FFFFFF)),
          ],
        ),
      ),
    );
  }
}
