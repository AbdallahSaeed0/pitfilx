import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/app_settings.dart';
import '../services/auth_service.dart';
import '../services/my_device_settings.dart';
import '../services/rate_prompt_store.dart';
import '../services/ratings_service.dart';
import '../services/synced_api_keys_service.dart';
import '../services/tmdb_service.dart';
import '../services/update_check_service.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import '../utils/time_ago.dart';
import '../widgets/widgets.dart';
import 'change_password_screen.dart';
import 'import_data_screen.dart';
import 'login_screen.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  String _version = '';
  String _versionName = '';
  bool _checkingForUpdate = false;

  // null while loading; DateTime? afterward (null = never synced/not linked).
  DateTime? _desktopSyncedAt;
  bool _loadingDesktopSync = true;

  // TEMPORARY diagnostic state — see _loadDiagnosticCounts.
  ({
    int movieRows,
    int seriesRows,
    int episodeRows,
    int watchLogRows,
    int droppedShowCount,
    String? linkedEmail,
  })?
  _diagnosticCounts;
  bool _loadingDiagnostics = true;

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
    _loadDesktopSyncStatus();
    _loadDiagnosticCounts();
  }

  /// TEMPORARY — see UserLibraryService.fetchDiagnosticCounts's doc comment. Remove this method,
  /// its state, and the settings card that renders it once mobile/desktop parity is confirmed.
  Future<void> _loadDiagnosticCounts() async {
    setState(() => _loadingDiagnostics = true);
    try {
      final counts = await UserLibraryService.fetchDiagnosticCounts();
      if (!mounted) return;
      setState(() {
        _diagnosticCounts = counts;
        _loadingDiagnostics = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingDiagnostics = false);
    }
  }

  Future<void> _loadDesktopSyncStatus() async {
    setState(() => _loadingDesktopSync = true);
    final syncedAt = await UserLibraryService.fetchSyncStatus();
    if (!mounted) return;
    setState(() {
      _desktopSyncedAt = syncedAt;
      _loadingDesktopSync = false;
    });
  }

  /// The desktop pushes every 5 minutes (or immediately on link/"Sync Now"),
  /// so anything within ~2 cycles of that is "still actively syncing";
  /// older than that most likely means the desktop app isn't running right
  /// now (it only pushes while open).
  _DesktopSyncStatus _desktopSyncStatusFromAge() {
    if (_loadingDesktopSync) return _DesktopSyncStatus.loading;
    final syncedAt = _desktopSyncedAt;
    if (syncedAt == null) return _DesktopSyncStatus.never;
    final age = DateTime.now().difference(syncedAt);
    return age <= const Duration(minutes: 12)
        ? _DesktopSyncStatus.connected
        : _DesktopSyncStatus.stale;
  }

  String _desktopSyncLabel() {
    switch (_desktopSyncStatusFromAge()) {
      case _DesktopSyncStatus.loading:
        return 'Checking…';
      case _DesktopSyncStatus.never:
        return 'Not linked yet — see Link Mobile Account on desktop';
      case _DesktopSyncStatus.connected:
        return 'Connected · synced ${timeAgo(_desktopSyncedAt!)}';
      case _DesktopSyncStatus.stale:
        return 'Desktop app closed · last synced ${timeAgo(_desktopSyncedAt!)}';
    }
  }

  /// Watch history/lists now come from the desktop app's own "Link Mobile
  /// Account" background push (straight to Supabase — see Pitflix.API's
  /// MobileAccountSyncHostedService), not from this app pulling over the
  /// local network. "Sync Now" just force-refreshes this account's view of
  /// that Supabase data immediately, instead of waiting for the next
  /// periodic refresh (see RootShell).
  void _syncNow() {
    UserLibraryService.libraryVersion.value++;
    RatePromptStore.refresh();
    SyncedApiKeysService.refresh();
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

  void _openImport(ImportSource source) {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => ImportDataScreen(source: source)),
    );
  }

  /// TEMPORARY debug action — see UserLibraryService.wipeWatchData's doc comment. Confirmed via
  /// dialog since it deletes real watch history; the follow-up desktop "Sync Now" is what
  /// actually rebuilds it, this button only clears the mobile side first.
  Future<void> _confirmWipeWatchData() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          'Wipe Watch Data',
          style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1, color: AppColors.destructive),
        ),
        content: Text(
          'This deletes ALL movie/series watch history and episode progress on this account. '
          'Run "Sync Now" from the desktop app afterward to rebuild it from your desktop library. '
          'Lists (Watch Later, Favorites, custom lists) are not affected.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textSecondary, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: Text('Cancel', style: AppTextStyles.dmSans(fontSize: 14, color: AppColors.textSecondary)),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              'Wipe',
              style: AppTextStyles.dmSans(fontSize: 14, fontWeight: FontWeight.w600, color: AppColors.destructive),
            ),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await UserLibraryService.wipeWatchData();
      if (!mounted) return;
      _loadDiagnosticCounts();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Wiped. Now run "Sync Now" on the desktop app.')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Couldn't wipe: $e")),
      );
    }
  }

  void _clearCache() {
    TmdbService.clearCache();
    UserLibraryService.clearCache();
    RatingsService.clearCache();
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

  /// Two-step confirmation for something irreversible — a plain Yes/No
  /// dialog is too easy to reflexively tap through for "delete my entire
  /// account", so this requires typing DELETE first.
  Future<void> _confirmDeleteAccount() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => const _DeleteAccountDialog(),
    );
    if (confirmed != true || !mounted) return;
    try {
      await AuthService.deleteAccount();
      if (!mounted) return;
      Navigator.of(context).pushAndRemoveUntil(
        MaterialPageRoute(builder: (_) => const LoginScreen()),
        (route) => false,
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text("Couldn't delete account: $e")),
      );
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
                  Text('DESKTOP SYNC', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 14,
                          vertical: 12,
                        ),
                        child: Row(
                          children: [
                            _DesktopSyncDot(
                              status: _desktopSyncStatusFromAge(),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _desktopSyncLabel(),
                                style: AppTextStyles.dmSans(
                                  fontSize: 13,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                            ),
                            GestureDetector(
                              onTap: _loadDesktopSyncStatus,
                              child: const Icon(
                                Icons.refresh,
                                size: 18,
                                color: AppColors.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Row(
                    children: [
                      Text('SYNC DIAGNOSTICS (TEMPORARY)', style: AppTextStyles.sectionLabel()),
                      const Spacer(),
                      GestureDetector(
                        onTap: _loadDiagnosticCounts,
                        child: const Icon(Icons.refresh, size: 16, color: AppColors.textMuted),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      if (_loadingDiagnostics)
                        const Padding(
                          padding: EdgeInsets.all(14),
                          child: Center(
                            child: SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent),
                            ),
                          ),
                        )
                      else if (_diagnosticCounts == null)
                        Padding(
                          padding: const EdgeInsets.all(14),
                          child: Text(
                            "Couldn't load counts.",
                            style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
                          ),
                        )
                      else ...[
                        _KeyValueRow(
                          label: 'Linked account',
                          value: _diagnosticCounts!.linkedEmail ?? '—',
                        ),
                        const _Divider(),
                        _KeyValueRow(
                          label: 'Movie rows (watch_records)',
                          value: '${_diagnosticCounts!.movieRows}',
                        ),
                        const _Divider(),
                        _KeyValueRow(
                          label: 'Series rows (watch_records)',
                          value: '${_diagnosticCounts!.seriesRows}',
                        ),
                        const _Divider(),
                        _KeyValueRow(
                          label: 'Episode rows (episode_watch_status)',
                          value: '${_diagnosticCounts!.episodeRows}',
                        ),
                        const _Divider(),
                        _KeyValueRow(
                          label: 'watch_log rows',
                          value: '${_diagnosticCounts!.watchLogRows}',
                        ),
                        const _Divider(),
                        _KeyValueRow(
                          label: '"Dropped" list shows',
                          value: '${_diagnosticCounts!.droppedShowCount}',
                        ),
                        const _Divider(),
                        _NavRow(
                          label: 'View Dropped List Details',
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(builder: (_) => const _DroppedListDebugScreen()),
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 24),
                  Text('LIBRARY', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
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
                      const _Divider(),
                      _NavRow(
                        label: 'Import from Letterboxd',
                        onTap: () => _openImport(ImportSource.letterboxd),
                      ),
                      const _Divider(),
                      _NavRow(
                        label: 'Import from TV Time',
                        onTap: () => _openImport(ImportSource.tvTime),
                      ),
                      const _Divider(),
                      _NavRow(
                        label: 'Wipe Watch Data (Temporary)',
                        destructive: true,
                        onTap: _confirmWipeWatchData,
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
                  Text('MY DEVICE', style: AppTextStyles.sectionLabel()),
                  const SizedBox(height: 8),
                  _SettingsCard(
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(14),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    'Enable My Device',
                                    style: AppTextStyles.dmSans(
                                      fontSize: 14,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                  const SizedBox(height: 2),
                                  Text(
                                    'Browse and play videos stored on this phone. '
                                    'Local only — never synced to your account.',
                                    style: AppTextStyles.dmSans(
                                      fontSize: 11,
                                      color: AppColors.textMuted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 12),
                            ValueListenableBuilder<bool>(
                              valueListenable: MyDeviceSettings.enabled,
                              builder: (context, enabled, _) => PitflixToggle(
                                value: enabled,
                                onChanged: MyDeviceSettings.setEnabled,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const _Divider(),
                      _NavRow(
                        label: 'Subtitle Search (OpenSubtitles / SubDL)',
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => const _MyDeviceSubtitleKeysScreen(),
                          ),
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
                      const _Divider(),
                      _NavRow(
                        label: 'Delete Account',
                        destructive: true,
                        onTap: _confirmDeleteAccount,
                      ),
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

enum _DesktopSyncStatus { loading, connected, stale, never }

class _DesktopSyncDot extends StatelessWidget {
  final _DesktopSyncStatus status;

  const _DesktopSyncDot({required this.status});

  @override
  Widget build(BuildContext context) {
    final color = switch (status) {
      _DesktopSyncStatus.connected => AppColors.success,
      _DesktopSyncStatus.stale => AppColors.star,
      _DesktopSyncStatus.never => AppColors.destructive,
      _DesktopSyncStatus.loading => AppColors.textMuted,
    };
    return Container(
      width: 8,
      height: 8,
      decoration: BoxDecoration(color: color, shape: BoxShape.circle),
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
  final bool destructive;

  const _NavRow({
    required this.label,
    required this.onTap,
    this.destructive = false,
  });

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
                color: destructive
                    ? AppColors.destructive
                    : AppColors.textSecondary,
              ),
            ),
            Icon(
              Icons.chevron_right,
              size: 16,
              color: destructive
                  ? AppColors.destructive.withValues(alpha: 0.6)
                  : const Color(0x40FFFFFF),
            ),
          ],
        ),
      ),
    );
  }
}

/// Requires typing DELETE (case-insensitive) before the Delete button
/// enables — see [_SettingsScreenState._confirmDeleteAccount].
class _DeleteAccountDialog extends StatefulWidget {
  const _DeleteAccountDialog();

  @override
  State<_DeleteAccountDialog> createState() => _DeleteAccountDialogState();
}

class _DeleteAccountDialogState extends State<_DeleteAccountDialog> {
  final _controller = TextEditingController();
  final _focusNode = FocusNode();
  bool _confirmed = false;

  @override
  void initState() {
    super.initState();
    // Not `autofocus: true` on the TextField below — requesting focus (and
    // so triggering the keyboard) at the same time the dialog's own
    // entrance transition is animating makes both janky and the keyboard
    // reads as slow to appear. Waiting for the transition to actually
    // finish first lets the keyboard slide in cleanly right after.
    Future.delayed(const Duration(milliseconds: 200), () {
      if (mounted) _focusNode.requestFocus();
    });
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
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
              'DELETE ACCOUNT',
              style: AppTextStyles.bebas(
                fontSize: 20,
                letterSpacing: 0.1,
                color: AppColors.destructive,
              ),
            ),
            const SizedBox(height: 10),
            Text(
              'This permanently deletes your account — profile, friends, '
              'lists, watch history, everything. This cannot be undone.',
              style: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textSecondary,
                height: 1.4,
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'Type DELETE to confirm',
              style: AppTextStyles.dmSans(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textMuted,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _controller,
              focusNode: _focusNode,
              style: AppTextStyles.dmSans(fontSize: 14),
              decoration: InputDecoration(
                isDense: true,
                filled: true,
                fillColor: AppColors.bgBase,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide.none,
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 10,
                ),
              ),
              onChanged: (v) => setState(
                () => _confirmed = v.trim().toUpperCase() == 'DELETE',
              ),
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                Expanded(
                  child: TextButton(
                    onPressed: () => Navigator.of(context).pop(false),
                    child: Text(
                      'Cancel',
                      style: AppTextStyles.dmSans(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    onPressed: _confirmed
                        ? () => Navigator.of(context).pop(true)
                        : null,
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.destructive,
                      disabledBackgroundColor: AppColors.destructive
                          .withValues(alpha: 0.3),
                      elevation: 0,
                    ),
                    child: Text(
                      'Delete',
                      style: AppTextStyles.dmSans(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
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

/// TEMPORARY debug screen — every item stored in the "Dropped" list with no media_type filter,
/// so a title that got dropped with the wrong media_type (and so never counts as "dropped" from
/// Currently Watching's point of view, which only checks media_type == 'series') is directly
/// visible instead of silently missing. Remove alongside the rest of the Sync Diagnostics
/// section once mobile/desktop parity — and this filtering — is confirmed correct.
class _DroppedListDebugScreen extends StatefulWidget {
  const _DroppedListDebugScreen();

  @override
  State<_DroppedListDebugScreen> createState() => _DroppedListDebugScreenState();
}

class _DroppedListDebugScreenState extends State<_DroppedListDebugScreen> {
  List<Map<String, dynamic>>? _items;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final items = await UserLibraryService.fetchDroppedShowDetails();
      if (!mounted) return;
      setState(() => _items = items);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
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
                    'DROPPED LIST',
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
              child: _error != null
                  ? Center(
                      child: Text(
                        "Couldn't load: $_error",
                        style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
                      ),
                    )
                  : _items == null
                  ? const Center(
                      child: CircularProgressIndicator(color: AppColors.accent),
                    )
                  : _items!.isEmpty
                  ? Center(
                      child: Text(
                        'Nothing in the Dropped list.',
                        style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
                      ),
                    )
                  : ListView.separated(
                      padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
                      itemCount: _items!.length,
                      separatorBuilder: (_, _) => const _Divider(),
                      itemBuilder: (context, i) {
                        final item = _items![i];
                        return Padding(
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          child: Row(
                            children: [
                              Expanded(
                                child: Text(
                                  item['title'] as String? ?? 'Untitled',
                                  style: AppTextStyles.dmSans(fontSize: 13, fontWeight: FontWeight.w600),
                                ),
                              ),
                              Text(
                                'tmdb:${item['tmdb_id']} · ${item['media_type']}',
                                style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// My Device's own local credentials for the optional OpenSubtitles/SubDL
/// lookup (see MyDeviceSubtitleService) — stored via MyDeviceSettings, which
/// is entirely separate from SyncedApiKeysService (that one holds keys
/// pushed from the desktop app; these never leave this device).
class _MyDeviceSubtitleKeysScreen extends StatefulWidget {
  const _MyDeviceSubtitleKeysScreen();

  @override
  State<_MyDeviceSubtitleKeysScreen> createState() =>
      _MyDeviceSubtitleKeysScreenState();
}

class _MyDeviceSubtitleKeysScreenState
    extends State<_MyDeviceSubtitleKeysScreen> {
  late final _openSubtitlesController = TextEditingController(
    text: MyDeviceSettings.openSubtitlesApiKey.value,
  );
  late final _subdlController = TextEditingController(
    text: MyDeviceSettings.subdlApiKey.value,
  );

  @override
  void dispose() {
    _openSubtitlesController.dispose();
    _subdlController.dispose();
    super.dispose();
  }

  Widget _keyField({
    required String label,
    required TextEditingController controller,
    required ValueChanged<String> onSubmit,
    required bool hasSyncedFallback,
  }) {
    return Padding(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          TextField(
            controller: controller,
            obscureText: true,
            style: AppTextStyles.dmSans(fontSize: 13),
            decoration: InputDecoration(
              isDense: true,
              filled: true,
              fillColor: AppColors.bgBase,
              hintText: 'API key',
              hintStyle: AppTextStyles.dmSans(
                fontSize: 13,
                color: AppColors.textFaint,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
            ),
            onChanged: (_) => setState(() {}),
            onSubmitted: onSubmit,
            onTapOutside: (_) => onSubmit(controller.text),
          ),
          if (controller.text.trim().isEmpty && hasSyncedFallback) ...[
            const SizedBox(height: 6),
            Text(
              'Using the key linked from your desktop app',
              style: AppTextStyles.dmSans(
                fontSize: 11,
                color: AppColors.success,
              ),
            ),
          ],
        ],
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
                  Text(
                    'SUBTITLE SEARCH',
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
                  Text(
                    'Used by My Device\'s local player to look up subtitles for '
                    'videos on this phone. Optional — leave blank to only use '
                    'subtitle files already sitting next to the video.',
                    style: AppTextStyles.dmSans(
                      fontSize: 12,
                      color: AppColors.textMuted,
                      height: 1.4,
                    ),
                  ),
                  const SizedBox(height: 16),
                  _SettingsCard(
                    children: [
                      _keyField(
                        label: 'OpenSubtitles API Key',
                        controller: _openSubtitlesController,
                        onSubmit: MyDeviceSettings.setOpenSubtitlesApiKey,
                        hasSyncedFallback:
                            MyDeviceSettings.effectiveOpenSubtitlesApiKey
                                .isNotEmpty,
                      ),
                      const _Divider(),
                      _keyField(
                        label: 'SubDL API Key',
                        controller: _subdlController,
                        onSubmit: MyDeviceSettings.setSubdlApiKey,
                        hasSyncedFallback:
                            MyDeviceSettings.effectiveSubdlApiKey.isNotEmpty,
                      ),
                    ],
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
