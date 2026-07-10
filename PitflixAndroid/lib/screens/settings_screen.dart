import 'package:flutter/material.dart';
import 'package:package_info_plus/package_info_plus.dart';
import '../data/mock_data.dart';
import '../services/app_settings.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _syncOn = true;
  String _version = '';

  @override
  void initState() {
    super.initState();
    PackageInfo.fromPlatform().then((info) {
      if (!mounted) return;
      setState(() => _version = '${info.version} (${info.buildNumber})');
    });
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
                                  'Auto-sync watch history',
                                  style: AppTextStyles.dmSans(
                                    fontSize: 11,
                                    color: AppColors.textMuted,
                                  ),
                                ),
                              ],
                            ),
                            PitflixToggle(
                              value: _syncOn,
                              onChanged: (v) => setState(() => _syncOn = v),
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
                            const _StatusDot(),
                            const SizedBox(width: 8),
                            Text(
                              'Connected · pitflix-desktop',
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
                              'Last synced',
                              style: AppTextStyles.dmSans(
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                            ),
                            Text(
                              '3 minutes ago',
                              style: AppTextStyles.dmSans(
                                fontSize: 13,
                                color: AppColors.textMuted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const _Divider(),
                      InkWell(
                        onTap: () {},
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 14,
                            vertical: 14,
                          ),
                          child: Text(
                            'Sync Now',
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
                      _KeyValueRow(label: 'Email', value: MockData.userEmail),
                      const _Divider(),
                      _NavRow(label: 'Change Password', onTap: () {}),
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
                      _NavRow(label: 'Clear Cache', onTap: () {}),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _SettingsCard(
                    children: [
                      InkWell(
                        onTap: () {},
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
  const _StatusDot();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      decoration: const BoxDecoration(
        color: AppColors.success,
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
  final VoidCallback onTap;

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
