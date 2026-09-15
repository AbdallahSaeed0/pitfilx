import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/import/import_result.dart';
import '../services/import/letterboxd_import_service.dart';
import '../services/import/tvtime_import_service.dart';
import '../theme/app_theme.dart';
import '../widgets/widgets.dart';

enum ImportSource { letterboxd, tvTime }

extension on ImportSource {
  String get title =>
      this == ImportSource.letterboxd ? 'LETTERBOXD IMPORT' : 'TV TIME IMPORT';
  String get exportHint => this == ImportSource.letterboxd
      ? 'On letterboxd.com: Settings > Data > Export Your Data. Pick the '
            'downloaded .zip below.'
      : 'In the TV Time app: Settings > Export My Data (GDPR request). Once '
            "you get the \"gdpr-data.zip\" email/download, pick it below.";
  String get pickLabel =>
      this == ImportSource.letterboxd ? 'CHOOSE LETTERBOXD ZIP' : 'CHOOSE TV TIME ZIP';
}

/// Settings > Library > "Import from Letterboxd"/"Import from TV Time" —
/// picks a data-export zip, parses it, matches titles against TMDB, and
/// bulk-writes the result into this account's Supabase library (same tables
/// the rest of the app reads/writes via UserLibraryService).
class ImportDataScreen extends StatefulWidget {
  final ImportSource source;

  const ImportDataScreen({super.key, required this.source});

  @override
  State<ImportDataScreen> createState() => _ImportDataScreenState();
}

enum _Phase { idle, working, done, error }

class _ImportDataScreenState extends State<ImportDataScreen> {
  _Phase _phase = _Phase.idle;
  String? _fileName;
  int _done = 0;
  int _total = 0;
  ImportResult? _result;
  String? _error;

  Future<void> _pickAndImport() async {
    final picked = await FilePicker.platform.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['zip'],
      withData: true,
    );
    final file = picked?.files.single;
    final bytes = file?.bytes;
    if (file == null || bytes == null) return;

    setState(() {
      _phase = _Phase.working;
      _fileName = file.name;
      _done = 0;
      _total = 0;
      _result = null;
      _error = null;
    });

    try {
      final result = await _import(bytes);
      if (!mounted) return;
      setState(() {
        _phase = _Phase.done;
        _result = result;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _Phase.error;
        _error = '$e';
      });
    }
  }

  Future<ImportResult> _import(Uint8List bytes) {
    void onProgress(int done, int total) {
      if (!mounted) return;
      setState(() {
        _done = done;
        _total = total;
      });
    }

    return widget.source == ImportSource.letterboxd
        ? LetterboxdImportService.importFromZip(bytes, onProgress: onProgress)
        : TvTimeImportService.importFromZip(bytes, onProgress: onProgress);
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
                    widget.source.title,
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
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(20, 24, 20, 24),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      widget.source.exportHint,
                      style: AppTextStyles.dmSans(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 24),
                    _buildBody(),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBody() {
    switch (_phase) {
      case _Phase.idle:
        return _pickButton();
      case _Phase.working:
        return _WorkingCard(fileName: _fileName!, done: _done, total: _total);
      case _Phase.done:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _ResultCard(source: widget.source, result: _result!),
            const SizedBox(height: 16),
            _pickButton(label: 'IMPORT ANOTHER FILE'),
          ],
        );
      case _Phase.error:
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.bgCard,
                borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
                border: Border.all(color: AppColors.destructive),
              ),
              child: Text(
                "Couldn't import that file: $_error",
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.destructive,
                ),
              ),
            ),
            const SizedBox(height: 16),
            _pickButton(label: 'TRY AGAIN'),
          ],
        );
    }
  }

  Widget _pickButton({String? label}) {
    return ElevatedButton(
      onPressed: _pickAndImport,
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.buttonPurple,
        foregroundColor: AppColors.textPrimary,
        padding: const EdgeInsets.symmetric(vertical: 16),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        elevation: 0,
      ),
      child: Text(
        label ?? widget.source.pickLabel,
        style: AppTextStyles.bebas(
          fontSize: 18,
          color: AppColors.textPrimary,
          letterSpacing: 0.1,
        ),
      ),
    );
  }
}

class _WorkingCard extends StatelessWidget {
  final String fileName;
  final int done;
  final int total;

  const _WorkingCard({
    required this.fileName,
    required this.done,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    final progress = total > 0 ? done / total : null;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            fileName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTextStyles.dmSans(
              fontSize: 13,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 10),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              backgroundColor: AppColors.borderInput,
              color: AppColors.accent,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            total > 0 ? 'Matching titles… $done / $total' : 'Reading export…',
            style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
          ),
        ],
      ),
    );
  }
}

class _ResultCard extends StatelessWidget {
  final ImportSource source;
  final ImportResult result;

  const _ResultCard({required this.source, required this.result});

  @override
  Widget build(BuildContext context) {
    final rows = <String>[
      source == ImportSource.letterboxd
          ? '${result.matched} movies imported'
          : '${result.matched} shows matched',
      if (source == ImportSource.letterboxd)
        '${result.ratingsApplied} ratings applied',
      if (source == ImportSource.tvTime)
        '${result.episodesImported} episodes marked watched',
      if (result.watchlistAdded > 0)
        '${result.watchlistAdded} added to Watch Later',
      if (result.unmatched > 0) '${result.unmatched} titles not found on TMDB',
    ];

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMax),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.check_circle, size: 18, color: AppColors.success),
              const SizedBox(width: 8),
              Text(
                'Import complete',
                style: AppTextStyles.dmSans(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(bottom: 4),
              child: Text(
                row,
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          if (result.unmatchedTitles.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Not found (${result.unmatchedTitles.length})',
                    style: AppTextStyles.dmSans(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textMuted,
                    ),
                  ),
                ),
                GestureDetector(
                  onTap: () {
                    Clipboard.setData(
                      ClipboardData(text: result.unmatchedTitles.join('\n')),
                    );
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Copied list')),
                    );
                  },
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.copy, size: 12, color: AppColors.accent),
                      const SizedBox(width: 4),
                      Text(
                        'Copy list',
                        style: AppTextStyles.dmSans(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.accent,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            // Full list, not truncated — a truncated "first 15" was useless
            // for actually diagnosing why a batch of titles failed to
            // match, which is the whole point of showing this at all.
            Text(
              result.unmatchedTitles.join(', '),
              style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
            ),
          ],
        ],
      ),
    );
  }
}
