import 'dart:convert';
import 'package:http/http.dart' as http;

/// Checks GitHub Releases for a newer mobile build. Mirrors the desktop
/// app's own updater (Pitflix.UI/src/updater/githubReleaseUpdater.ts) —
/// same repo, same tag-normalizing/segment-compare logic — but scoped to
/// whichever release has an `.apk` asset attached, since the same repo's
/// releases mostly ship the unrelated Windows desktop installer.
abstract class UpdateCheckService {
  UpdateCheckService._();

  static const _owner = 'AbdallahSaeed0';
  static const _repo = 'pitfilx';

  /// Returns null if no release with an `.apk` asset exists yet, or the
  /// GitHub API call fails (treated as "nothing to report", not an error —
  /// this shouldn't block anyone from using the app).
  static Future<UpdateInfo?> checkForUpdate(String currentVersion) async {
    try {
      final url = Uri.parse(
        'https://api.github.com/repos/$_owner/$_repo/releases',
      );
      final res = await http.get(
        url,
        headers: {
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Pitflix-Mobile',
        },
      );
      if (res.statusCode != 200) return null;

      final releases = jsonDecode(res.body) as List;
      for (final entry in releases) {
        final release = entry as Map<String, dynamic>;
        final assets = (release['assets'] as List? ?? [])
            .cast<Map<String, dynamic>>();
        Map<String, dynamic>? apk;
        for (final a in assets) {
          if ((a['name'] as String? ?? '').toLowerCase().endsWith('.apk')) {
            apk = a;
            break;
          }
        }
        if (apk == null) continue;

        final version = _normalize(release['tag_name'] as String? ?? '');
        return UpdateInfo(
          version: version,
          releaseNotes: release['body'] as String? ?? '',
          htmlUrl: release['html_url'] as String? ?? '',
          downloadUrl: apk['browser_download_url'] as String? ?? '',
          isNewer: _compare(version, _normalize(currentVersion)) > 0,
        );
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  static String _normalize(String tag) =>
      tag.trim().replaceFirst(RegExp(r'^[vV]'), '');

  /// Same segment-by-segment numeric comparison as the desktop updater —
  /// no semver package, just enough for plain "1.2.3"-style tags.
  static int _compare(String a, String b) {
    final pa = _parts(a);
    final pb = _parts(b);
    final len = pa.length > pb.length ? pa.length : pb.length;
    for (var i = 0; i < len; i++) {
      final va = i < pa.length ? pa[i] : 0;
      final vb = i < pb.length ? pb[i] : 0;
      if (va != vb) return va.compareTo(vb);
    }
    return 0;
  }

  static List<int> _parts(String v) => v
      .split(RegExp(r'[.\-+_]'))
      .map((s) {
        final match = RegExp(r'^\d+').firstMatch(s);
        return match == null ? 0 : int.parse(match.group(0)!);
      })
      .toList();
}

class UpdateInfo {
  final String version;
  final String releaseNotes;
  final String htmlUrl;
  final String downloadUrl;
  final bool isNewer;

  const UpdateInfo({
    required this.version,
    required this.releaseNotes,
    required this.htmlUrl,
    required this.downloadUrl,
    required this.isNewer,
  });
}
