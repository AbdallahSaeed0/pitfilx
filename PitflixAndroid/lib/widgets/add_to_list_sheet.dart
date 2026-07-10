import 'package:flutter/material.dart';
import '../models/supabase_rows.dart';
import '../models/title_item.dart';
import '../services/user_library_service.dart';
import '../theme/app_theme.dart';
import 'auth_text_field.dart';

/// "Add to List" bottom sheet — shows every user list with a checkmark for
/// ones that already contain [title], toggling add/remove per row, plus a
/// "+ New List" affordance that creates a list and adds the title to it.
Future<void> showAddToListSheet(BuildContext context, TitleItem title) async {
  if (title.tmdbId == null) return;
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: AppColors.bgCard,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
    ),
    builder: (context) => _AddToListSheet(title: title),
  );
}

class _AddToListSheet extends StatefulWidget {
  final TitleItem title;

  const _AddToListSheet({required this.title});

  @override
  State<_AddToListSheet> createState() => _AddToListSheetState();
}

class _AddToListSheetState extends State<_AddToListSheet> {
  List<SupabaseListRow>? _lists;
  Set<String> _memberListIds = {};
  String? _error;
  String? _busyListId;

  String get _mediaType => widget.title.isShow ? 'series' : 'movie';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final lists = await UserLibraryService.fetchLists(forceRefresh: true);
      final memberships = await Future.wait(
        lists.map(
          (l) => UserLibraryService.isInList(
            l.id,
            widget.title.tmdbId!,
            _mediaType,
          ),
        ),
      );
      if (!mounted) return;
      setState(() {
        _lists = lists;
        _memberListIds = {
          for (var i = 0; i < lists.length; i++)
            if (memberships[i]) lists[i].id,
        };
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString());
    }
  }

  Future<void> _toggle(SupabaseListRow list) async {
    final isMember = _memberListIds.contains(list.id);
    setState(() => _busyListId = list.id);
    try {
      if (isMember) {
        await UserLibraryService.removeFromList(
          list.id,
          widget.title.tmdbId!,
          _mediaType,
        );
      } else {
        await UserLibraryService.addToList(
          list.id,
          tmdbId: widget.title.tmdbId!,
          mediaType: _mediaType,
          title: widget.title.name,
          posterPath: widget.title.posterPath,
        );
      }
      if (!mounted) return;
      setState(() {
        if (isMember) {
          _memberListIds = {..._memberListIds}..remove(list.id);
        } else {
          _memberListIds = {..._memberListIds, list.id};
        }
        _busyListId = null;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busyListId = null);
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't update list: $e")));
    }
  }

  Future<void> _createAndAdd() async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => Dialog(
        backgroundColor: AppColors.bgCard,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'NEW LIST',
                style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
              ),
              const SizedBox(height: 16),
              AuthTextField(controller: controller, hintText: 'List name'),
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
                    onPressed: () =>
                        Navigator.of(context).pop(controller.text.trim()),
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
    );
    if (name == null || name.isEmpty || !mounted) return;

    try {
      final listId = await UserLibraryService.createList(name);
      await UserLibraryService.addToList(
        listId,
        tmdbId: widget.title.tmdbId!,
        mediaType: _mediaType,
        title: widget.title.name,
        posterPath: widget.title.posterPath,
      );
      await _load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text("Couldn't create list: $e")));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.7,
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'ADD TO LIST',
                style: AppTextStyles.bebas(fontSize: 20, letterSpacing: 0.1),
              ),
              const SizedBox(height: 14),
              Flexible(child: _buildBody()),
              const SizedBox(height: 6),
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(
                  Icons.add_circle_outline,
                  color: AppColors.accent,
                ),
                title: Text(
                  'New List',
                  style: AppTextStyles.dmSans(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.accent,
                  ),
                ),
                onTap: _createAndAdd,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody() {
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 20),
        child: Text(
          "Couldn't load lists.\n$_error",
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    final lists = _lists;
    if (lists == null) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 20),
        child: Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.accent,
            ),
          ),
        ),
      );
    }
    if (lists.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(
          'No lists yet — create one below.',
          style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
        ),
      );
    }
    return ListView.builder(
      shrinkWrap: true,
      itemCount: lists.length,
      itemBuilder: (context, i) {
        final list = lists[i];
        final isMember = _memberListIds.contains(list.id);
        final busy = _busyListId == list.id;
        return ListTile(
          contentPadding: EdgeInsets.zero,
          leading: busy
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.accent,
                  ),
                )
              : Icon(
                  isMember ? Icons.check_circle : Icons.radio_button_unchecked,
                  color: isMember ? AppColors.accent : AppColors.textMuted,
                ),
          title: Text(
            list.name,
            style: AppTextStyles.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
          onTap: busy ? null : () => _toggle(list),
        );
      },
    );
  }
}
