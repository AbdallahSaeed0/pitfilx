import 'package:flutter/material.dart';
import '../config/app_config.dart';
import '../models/supabase_rows.dart';
import '../services/local_backend_service.dart';
import '../services/supabase_service.dart';
import '../theme/app_theme.dart';
import '../utils/list_marks.dart';
import '../widgets/widgets.dart';
import 'list_detail_screen.dart';

/// Real data: lists come from either the local Pitflix.API backend or
/// Supabase's `lists` table, depending on [AppConfig.useLocalBackend]. Both
/// are read-only for now — "Create List" is local-only, no write path is
/// wired yet, so it just appends to this screen's state for the session.
class ListsScreen extends StatefulWidget {
  const ListsScreen({super.key});

  @override
  State<ListsScreen> createState() => _ListsScreenState();
}

class _ListsScreenState extends State<ListsScreen> {
  List<SupabaseListRow>? _lists;
  String? _error;
  final _localLists = <SupabaseListRow>[];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool forceRefresh = false}) async {
    setState(() => _error = null);
    try {
      final rows = AppConfig.useLocalBackend
          ? await LocalBackendService.fetchLists(forceRefresh: forceRefresh)
          : await SupabaseService.fetchLists(forceRefresh: forceRefresh);
      if (!mounted) return;
      setState(() => _lists = rows);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  List<SupabaseListRow> get _sorted {
    final all = [...?_lists, ..._localLists];
    int rank(SupabaseListRow l) => switch (l.type) {
      SupabaseListTypes.watchlist => 0,
      SupabaseListTypes.favorites => 1,
      _ => 2,
    };
    all.sort((a, b) => rank(a).compareTo(rank(b)));
    return all;
  }

  Future<void> _createList() async {
    final controller = TextEditingController();
    String? selectedIcon;
    final result = await showDialog<(String, String?)>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => Dialog(
          backgroundColor: AppColors.bgCard,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'CREATE LIST',
                  style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
                ),
                const SizedBox(height: 16),
                AuthTextField(controller: controller, hintText: 'List name'),
                const SizedBox(height: 16),
                Text('ICON', style: AppTextStyles.sectionLabel()),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: [
                    for (final entry in ListMarks.icons.entries)
                      GestureDetector(
                        onTap: () => setDialogState(
                          () => selectedIcon = selectedIcon == entry.key
                              ? null
                              : entry.key,
                        ),
                        child: Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            color: selectedIcon == entry.key
                                ? AppColors.buttonPurple
                                : AppColors.avatarBg,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(
                              color: selectedIcon == entry.key
                                  ? AppColors.buttonPurple
                                  : AppColors.borderInput,
                              width: 1,
                            ),
                          ),
                          alignment: Alignment.center,
                          child: Icon(
                            entry.value,
                            size: 18,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 20),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(
                        'Cancel',
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          color: AppColors.textMuted,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    TextButton(
                      onPressed: () => Navigator.of(
                        context,
                      ).pop((controller.text.trim(), selectedIcon)),
                      child: Text(
                        'Create',
                        style: AppTextStyles.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.accent,
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );

    if (result == null || result.$1.isEmpty) return;
    setState(() {
      _localLists.add(
        SupabaseListRow(
          id: 'local-${DateTime.now().millisecondsSinceEpoch}',
          name: result.$1,
          type: SupabaseListTypes.custom,
          source: 'mobile',
          createdAt: DateTime.now(),
          icon: result.$2,
        ),
      );
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
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      CircleIconButton(
                        icon: Icons.arrow_back_ios_new,
                        background: AppColors.bgCard,
                        onTap: () => Navigator.of(context).pop(),
                      ),
                      const SizedBox(width: 14),
                      Text(
                        'LISTS',
                        style: AppTextStyles.bebas(
                          fontSize: 26,
                          letterSpacing: 0.14,
                          color: AppColors.logoAccent,
                        ),
                      ),
                    ],
                  ),
                  GestureDetector(
                    onTap: _createList,
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: const BoxDecoration(
                        color: AppColors.buttonPurple,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.add,
                        size: 20,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                color: AppColors.accent,
                backgroundColor: AppColors.bgCard,
                onRefresh: () => _load(forceRefresh: true),
                child: _buildBody(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null && _lists == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                "Couldn't load lists.\n$_error",
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

    if (_lists == null) {
      return const ListRowsSkeleton();
    }

    final lists = _sorted;
    if (lists.isEmpty) {
      return Center(
        child: Text(
          'No lists yet.',
          style: AppTextStyles.dmSans(fontSize: 13, color: AppColors.textMuted),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 20),
      itemCount: lists.length,
      separatorBuilder: (_, _) => const SizedBox(height: 10),
      itemBuilder: (context, i) => _ListRow(list: lists[i]),
    );
  }
}

class _ListRow extends StatelessWidget {
  final SupabaseListRow list;

  const _ListRow({required this.list});

  IconData get _icon {
    final marked = list.icon == null ? null : ListMarks.icons[list.icon];
    if (marked != null) return marked;
    return switch (list.type) {
      SupabaseListTypes.watchlist => Icons.bookmark_outline,
      SupabaseListTypes.favorites => Icons.favorite_outline,
      _ => Icons.list_alt,
    };
  }

  String get _subtitle => switch (list.type) {
    SupabaseListTypes.watchlist => 'Watchlist',
    SupabaseListTypes.favorites => 'Favorites',
    _ => 'Custom list',
  };

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) =>
              ListDetailScreen(listId: list.id, listName: list.name),
        ),
      ),
      child: Container(
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
              child: Icon(_icon, size: 18, color: AppColors.textPrimary),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    list.name,
                    overflow: TextOverflow.ellipsis,
                    style: AppTextStyles.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _subtitle,
                    style: AppTextStyles.dmSans(
                      fontSize: 11,
                      color: AppColors.textMuted,
                    ),
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
