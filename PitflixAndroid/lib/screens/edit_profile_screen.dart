import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../services/auth_service.dart';
import '../services/profile_photo_store.dart';
import '../services/social_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';

/// Username/display name are real (`profiles` table). The photo picker is
/// still session-only (see [ProfilePhotoStore]) — there's no Supabase
/// Storage bucket wired up yet to actually upload/persist an avatar.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _usernameController = TextEditingController();
  bool _loading = true;
  bool _saving = false;

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
        maxWidth: 512,
        maxHeight: 512,
      );
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      ProfilePhotoStore.photoBytes.value = bytes;
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't get photo: $e")));
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
                                : Text(
                                    _initials,
                                    style: AppTextStyles.bebas(
                                      fontSize: 36,
                                      color: AppColors.accent,
                                    ),
                                  ),
                          ),
                        ),
                        Positioned(
                          right: -2,
                          bottom: -2,
                          child: GestureDetector(
                            onTap: _pickPhoto,
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
