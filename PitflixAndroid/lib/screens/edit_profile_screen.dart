import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/auth_service.dart';
import '../services/cover_photo_store.dart';
import '../services/profile_photo_store.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../utils/crop_image.dart';
import '../widgets/widgets.dart';
import 'cover_backdrop_picker_screen.dart';
import '../widgets/pitflix_network_image.dart';

enum _CoverPickChoice { camera, gallery, favorites }

/// Username/display name and the avatar/cover photos are all real,
/// persisted to Supabase (`profiles` table + `profile-images` storage
/// bucket — see SocialService.uploadProfileImage). [ProfilePhotoStore]/
/// [CoverPhotoStore] still hold freshly-picked bytes for instant preview
/// while an upload is in flight; [_persistedAvatarUrl]/[_persistedCoverUrl]
/// are the durable ones shown after a reload. Both photos are only editable
/// from here now — Profile's own cover/avatar are display-only, tapping
/// "Edit" is what brings you here.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _usernameController = TextEditingController();
  bool _loading = true;
  bool _saving = false;
  String? _persistedAvatarUrl;
  String? _persistedCoverUrl;
  bool _uploadingPhoto = false;
  bool _uploadingCover = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final profile = await SocialService.myProfile();
      if (!mounted) return;
      setState(() {
        _usernameController.text = profile?.username ?? '';
        _persistedAvatarUrl = profile?.avatarUrl;
        _persistedCoverUrl = profile?.coverUrl;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loading = false);
    }
  }

  @override
  void dispose() {
    _usernameController.dispose();
    super.dispose();
  }

  String get _initials {
    final name = _usernameController.text.trim();
    if (name.isNotEmpty) return name[0].toUpperCase();
    final email = AuthService.currentUser?.email ?? '';
    return email.isNotEmpty ? email[0].toUpperCase() : '?';
  }

  Future<void> _save() async {
    final username = _usernameController.text.trim();
    if (username.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('Username can\'t be empty')));
      return;
    }
    setState(() => _saving = true);
    try {
      await SocialService.updateProfile(username: username);
      if (!mounted) return;
      Navigator.of(context).pop();
    } catch (e) {
      if (!mounted) return;
      setState(() => _saving = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(e.toString())));
    }
  }

  Future<void> _pickPhoto() async {
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
      setState(() => _uploadingPhoto = true);
      final url = await SocialService.uploadProfileImage(
        bytes: bytes,
        isCover: false,
        contentType: 'image/jpeg',
      );
      ProfilePhotoStore.avatarUrl.value = url;
      if (!mounted) return;
      setState(() {
        _persistedAvatarUrl = url;
        _uploadingPhoto = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingPhoto = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save photo: $e")));
    }
  }

  Future<void> _pickCover() async {
    final choice = await showModalBottomSheet<_CoverPickChoice>(
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
              onTap: () => Navigator.of(context).pop(_CoverPickChoice.camera),
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
              onTap: () => Navigator.of(context).pop(_CoverPickChoice.gallery),
            ),
            ListTile(
              leading: const Icon(
                Icons.movie_filter_outlined,
                color: AppColors.textPrimary,
              ),
              title: Text(
                'Choose from Favorites',
                style: AppTextStyles.dmSans(fontSize: 15),
              ),
              onTap: () => Navigator.of(context).pop(_CoverPickChoice.favorites),
            ),
          ],
        ),
      ),
    );
    if (choice == null || !mounted) return;
    if (choice == _CoverPickChoice.favorites) {
      final url = await Navigator.of(
        context,
      ).push<String>(MaterialPageRoute(builder: (_) => const CoverBackdropPickerScreen()));
      if (url == null || !mounted) return;
      // A favorite's backdrop is already TMDB-hosted — clear any in-memory
      // gallery pick so the network image (not stale bytes) shows.
      CoverPhotoStore.photoBytes.value = null;
      setState(() => _persistedCoverUrl = url);
      return;
    }
    final source = choice == _CoverPickChoice.camera
        ? ImageSource.camera
        : ImageSource.gallery;
    try {
      // NOT constrained to the cover's own tiny display size (previously
      // maxWidth:1080/maxHeight:400 here) — a portrait source photo would
      // get scaled down to fit within that 400px height before cropping,
      // leaving a genuinely low-resolution result that looked blurry once
      // stretched across the full-width cover. Picking at full resolution
      // and letting the cropper below produce the actual 1080x400-ish
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
      setState(() => _uploadingCover = true);
      final url = await SocialService.uploadProfileImage(
        bytes: bytes,
        isCover: true,
        contentType: 'image/jpeg',
      );
      if (!mounted) return;
      setState(() {
        _persistedCoverUrl = url;
        _uploadingCover = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _uploadingCover = false);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't save cover: $e")));
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
                    'EDIT PROFILE',
                    style: AppTextStyles.bebas(
                      fontSize: 22,
                      letterSpacing: 0.1,
                      color: AppColors.logoAccent,
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 28, 20, 24),
                children: [
                  Text('COVER', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  GestureDetector(
                    onTap: _uploadingCover ? null : _pickCover,
                    child: ValueListenableBuilder<Uint8List?>(
                      valueListenable: CoverPhotoStore.photoBytes,
                      builder: (context, coverBytes, _) => Stack(
                        alignment: Alignment.center,
                        children: [
                          Container(
                            height: 110,
                            width: double.infinity,
                            clipBehavior: Clip.antiAlias,
                            decoration: BoxDecoration(
                              borderRadius: BorderRadius.circular(12),
                              gradient: const LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [AppColors.logoAccentDim, Color(0xFF1A0D2E)],
                              ),
                            ),
                            child: coverBytes != null
                                ? Image.memory(coverBytes, fit: BoxFit.cover)
                                : _persistedCoverUrl != null
                                ? PitflixNetworkImage(
                                    _persistedCoverUrl!,
                                    fit: BoxFit.cover,
                                    errorBuilder: (context, error, stackTrace) =>
                                        const SizedBox.shrink(),
                                  )
                                : null,
                          ),
                          if (_uploadingCover)
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
                          Positioned(
                            right: 10,
                            bottom: 10,
                            child: Container(
                              width: 32,
                              height: 32,
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
                  ),
                  const SizedBox(height: 28),
                  Center(
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        ValueListenableBuilder<Uint8List?>(
                          valueListenable: ProfilePhotoStore.photoBytes,
                          builder: (context, bytes, _) => Container(
                            width: 96,
                            height: 96,
                            clipBehavior: Clip.antiAlias,
                            decoration: BoxDecoration(
                              color: AppColors.avatarBg,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: AppColors.borderInput,
                                width: 2,
                              ),
                            ),
                            alignment: Alignment.center,
                            child: bytes != null
                                ? Image.memory(
                                    bytes,
                                    fit: BoxFit.cover,
                                    width: 96,
                                    height: 96,
                                  )
                                : _persistedAvatarUrl != null
                                ? PitflixNetworkImage(
                                    _persistedAvatarUrl!,
                                    fit: BoxFit.cover,
                                    width: 96,
                                    height: 96,
                                    errorBuilder: (context, error, stackTrace) =>
                                        Text(
                                          _initials,
                                          style: AppTextStyles.bebas(
                                            fontSize: 36,
                                            color: AppColors.accent,
                                          ),
                                        ),
                                  )
                                : Text(
                                    _initials,
                                    style: AppTextStyles.bebas(
                                      fontSize: 36,
                                      color: AppColors.accent,
                                    ),
                                  ),
                          ),
                        ),
                        if (_uploadingPhoto)
                          Container(
                            width: 96,
                            height: 96,
                            decoration: const BoxDecoration(
                              color: Color(0x99000000),
                              shape: BoxShape.circle,
                            ),
                            alignment: Alignment.center,
                            child: const SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.4,
                                color: AppColors.textPrimary,
                              ),
                            ),
                          ),
                        Positioned(
                          right: -2,
                          bottom: -2,
                          child: GestureDetector(
                            onTap: _uploadingPhoto ? null : _pickPhoto,
                            child: Container(
                              width: 32,
                              height: 32,
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
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                  Text('USERNAME', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  AuthTextField(controller: _usernameController),
                  const SizedBox(height: 14),
                  Text('EMAIL', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 16,
                      vertical: 14,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.bgCard,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                        color: AppColors.borderInput,
                        width: 1.5,
                      ),
                    ),
                    child: Text(
                      AuthService.currentUser?.email ?? '',
                      style: AppTextStyles.dmSans(
                        fontSize: 15,
                        color: AppColors.textMuted,
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                  ElevatedButton(
                    onPressed: _loading || _saving ? null : _save,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.buttonPurple,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                      elevation: 0,
                    ),
                    child: _saving
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.4,
                              color: AppColors.textPrimary,
                            ),
                          )
                        : Text(
                            'SAVE',
                            style: AppTextStyles.bebas(
                              fontSize: 20,
                              letterSpacing: 0.12,
                              color: AppColors.textPrimary,
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
