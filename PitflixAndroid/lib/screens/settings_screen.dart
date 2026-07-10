import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/app_settings.dart';
import '../services/auth_service.dart';
import '../services/local_backend_service.dart';
import '../services/tmdb_service.dart';
import '../services/update_check_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/widgets.dart';
import 'change_password_screen.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';
  String _versionName = '';
  bool _checking = false;
  bool? _connected;
  bool _checkingForUpdate = false;

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((info) {
      if (!mounted) return;
      setState(() {
        _version = '${info.version} (${info.buildNumber})';
        _versionName = info.version;
      });
    });
    _checkConnection();
  }

  Future<void> _checkConnection() async {
    setState(() => _checking = true);
    final ok = await LocalBackendService.ping();
    if (!mounted) return;
    setState(() {
      _connected = ok;
      _checking = false;
    });
  }

  /// Watch history/lists now come from the desktop app's own "Link Mobile
  /// Account" background push (straight to Supabase — see Pitflix.API's
  /// MobileAccountSyncHostedService), not from this app pulling over the
  /// local network. "Sync Now" just force-refreshes this account's view of
  /// that Supabase data immediately, instead of waiting for the next
  /// periodic refresh (see RootShell).
  void _syncNow() {
    UserLibraryService.libraryVersion.value++;
    AppSettings.markSyncedNow();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Refreshed')));
  }

  void _openChangePassword() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => const ChangePasswordScreen()));
  }

  void _clearCache() {
    TmdbService.clearCache();
    imageCache.clear();
    imageCache.clearLiveImages();
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(const SnackBar(content: Text('Cache cleared')));
  }

  Future<void> _checkForUpdate() async {
    if (_versionName.isEmpty) return;
    setState(() => _checkingForUpdate = true);
    final update = await UpdateCheckService.checkForUpdate(_versionName);
    if (!mounted) return;
    setState(() => _checkingForUpdate = false);

    if (update == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Couldn't check for updates")),
      );
      return;
    }
    if (!update.isNewer) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text("You're up to date")));
      return;
    }

    showDialog<void>(
      context: context,
      builder: (context) => _UpdateAvailableDialog(update: update),
    );
  }

  Future<void> _logOut() async {
    await AuthService.signOut();
    if (!mounted) return;
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
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
                  Text(
                    'SETTINGS',
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
                padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
                children: [
                  Text('CONNECTION', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Sync with Desktop',
                                  style: AppTextStyles.dmSans(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'Ratings, actor bios, and Coming Soon',
                                  style: AppTextStyles.dmSans(
                                    fontSize: 11,
                                    color: AppColors.textMuted,
                                  ),
                                ),
                              ],
                            ),
                            ValueListenableBuilder<bool>(
                              valueListenable:
                                  AppSettings.syncWithDesktopEnabled,
                              builder: (context, on, _) => PitflixToggle(
                                value: on,
                                onChanged: (v) =>
                                    AppSettings.setSyncWithDesktopEnabled(v),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const _Divider(),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        child: Row(
                          children: [
                            _StatusDot(
                              connected: _connected == true,
                              checking: _checking,
                            ),
                            const SizedBox(width: 8),
                            Text(
                              _checking
                                  ? 'Checking…'
                                  : (_connected == true
                                        ? 'Connected · pitflix-desktop'
                                        : 'Not connected'),
                              style: AppTextStyles.dmSans(
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const _Divider(),
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              'Last refreshed',
                              style: AppTextStyles.dmSans(
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                            ),
                            ValueListenableBuilder<DateTime?>(
                              valueListenable: AppSettings.lastSyncedAt,
                              builder: (context, lastSynced, _) => Text(
                                lastSynced == null
                                    ? 'Never'
                                    : timeAgo(lastSynced),
                                style: AppTextStyles.dmSans(
                                  fontSize: 13,
                                  color: AppColors.textMuted,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      const _Divider(),
                      InkWell(
                        onTap: _syncNow,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 14,
                          ),
                          child: Text(
                            'Refresh Library',
                            style: AppTextStyles.dmSans(
                              fontSize: 13,
                              fontWeight: FontWeight.w500,
                              color: AppColors.accent,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text('PREFERENCES', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Rating Scale',
                                  style: AppTextStyles.dmSans(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  'Used for movie/episode ratings',
                                  style: AppTextStyles.dmSans(
                                    fontSize: 11,
                                    color: AppColors.textMuted,
                                  ),
                                ),
                              ],
                            ),
                            ValueListenableBuilder<int>(
                              valueListenable: AppSettings.ratingScaleMax,
                              builder: (context, max, _) => Row(
                                children: [
                                  FilterChipPill(
                                    label: '5',
                                    active: max == 5,
                                    onTap: () =>
                                        AppSettings.setRatingScaleMax(5),
                                  ),
                                  const SizedBox(width: 8),
                                  FilterChipPill(
                                    label: '10',
                                    active: max == 10,
                                    onTap: () =>
                                        AppSettings.setRatingScaleMax(10),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text('ACCOUNT', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      _KeyValueRow(
                        label: 'Email',
                        value: AuthService.currentUser?.email ?? '',
                      ),
                      const _Divider(),
                      _NavRow(label: 'Change Password', onTap: _openChangePassword),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text('APP', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      _KeyValueRow(
                        label: 'Version',
                        value: _version.isEmpty ? '…' : _version,
                      ),
                      const _Divider(),
                      const _KeyValueRow(
                        label: 'Developer',
                        value: 'Abdallah Saeed',
                      ),
                      const _Divider(),
                      _NavRow(
                        label: _checkingForUpdate
                            ? 'Checking…'
                            : 'Check for Updates',
                        onTap: _checkingForUpdate ? null : _checkForUpdate,
                      ),
                      const _Divider(),
                      _NavRow(label: 'Clear Cache', onTap: _clearCache),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _SettingsCard(
                    children: [
                      InkWell(
                        onTap: _logOut,
                        child: Padding(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          child: Center(
                            child: Text(
                              'Log Out',
                              style: AppTextStyles.dmSans(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: AppColors.destructive,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const PushedScreenBottomNav(active: MainTab.profile),
          ],
        ),
      ),
    );
  }
}

class _SettingsCard extends StatelessWidget {
  final List<Widget> children;

  const _SettingsCard({required this.children});

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      child: DecoratedBox(
        decoration: const BoxDecoration(color: AppColors.bgCard),
        child: Column(children: children),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return const Divider(height: 1, thickness: 1, color: AppColors.border);
  }
}

class _StatusDot extends StatelessWidget {
  final bool connected;
  final bool checking;

  const _StatusDot({required this.connected, required this.checking});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(
        color: checking
            ? AppColors.textMuted
            : (connected ? AppColors.success : AppColors.destructive),
        shape: BoxShape.circle,
      ),
    );
  }
}

class _KeyValueRow extends StatelessWidget {
  final String label;
  final String value;

  const _KeyValueRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
          Text(
            value,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              color: AppColors.textMuted,
            ),
          ),
        ],
      ),
    );
  }
}

class _NavRow extends StatelessWidget {
  final String label;
  final VoidCallback? onTap;

  const _NavRow({required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              label,
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            const Icon(Icons.chevron_right, size: 16, color: Color(0x40FFFFFF)),
          ],
        ),
      ),
    );
  }
}

class _UpdateAvailableDialog extends StatelessWidget {
  final UpdateInfo update;

  const _UpdateAvailableDialog({required this.update});

  Future<void> _openDownload() async {
    final uri = Uri.tryParse(
      update.downloadUrl.isNotEmpty ? update.downloadUrl : update.htmlUrl,
    );
    if (uri == null) return;
    await launchUrl(uri, mode: LaunchMode.externalApplication);
  }

  @override
  Widget build(BuildContext context) {
    return Dialog(
      backgroundColor: AppColors.bgCard,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'UPDATE AVAILABLE',
              style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
            ),
            const SizedBox(height: 4),
            Text(
              'Version ${update.version}',
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textMuted,
              ),
            ),
            if (update.releaseNotes.isNotEmpty) ...[
              const SizedBox(height: 14),
              ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: SingleChildScrollView(
                  child: Text(
                    update.releaseNotes,
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ),
            ],
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(
                    'Later',
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).pop();
                    _openDownload();
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.buttonPurple,
                    foregroundColor: AppColors.textPrimary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                    ),
                    elevation: 0,
                  ),
                  child: Text(
                    'Download',
                    style: AppTextStyles.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
