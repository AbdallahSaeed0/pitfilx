import 'dart:convert';
import 'dart:io';

import 'package:archive/archive.dart';
import 'http_client.dart';

import '../models/my_device_subtitle_cue.dart';
import '../utils/my_device_ass_parser.dart';
import '../utils/my_device_srt_parser.dart';
import 'my_device_settings.dart';

const _subtitleExtensions = ['.srt', '.ass', '.ssa'];

/// A subtitle track a user can pick, from either local discovery or an
/// online search result — kept as one flat type so the player's picker
/// sheet doesn't need to care which source it came from.
class MyDeviceSubtitleOption {
  final String label;
  final bool isLocal;
  final String path;

  const MyDeviceSubtitleOption({
    required this.label,
    required this.isLocal,
    required this.path,
  });
}

/// Local .srt/.ass/.ssa discovery next to a video file, plus optional online
/// lookup against OpenSubtitles/SubDL — entirely local-only in the sense
/// that nothing here goes through the desktop app's Pitflix.API backend
/// (which has no visibility into files that only exist on this phone). API
/// keys come from [MyDeviceSettings.effectiveOpenSubtitlesApiKey]/
/// [MyDeviceSettings.effectiveSubdlApiKey] — a key typed directly into this
/// app's Settings, falling back to the desktop-linked account's own
/// configured key via SyncedApiKeysService if this app doesn't have one set.
abstract class MyDeviceSubtitleService {
  /// Subtitle files sitting in the same directory as the video, matched by
  /// filename prefix (e.g. "Movie.srt", "Movie.en.srt" both match
  /// "Movie.mkv") case-insensitively.
  static Future<List<MyDeviceSubtitleOption>> discoverLocal(
    String videoPath,
  ) async {
    final videoFile = File(videoPath);
    final dir = videoFile.parent;
    if (!await dir.exists()) return const [];
    final videoBaseName = _baseName(videoPath).toLowerCase();
    final options = <MyDeviceSubtitleOption>[];
    await for (final entity in dir.list(followLinks: false)) {
      if (entity is! File) continue;
      final name = entity.uri.pathSegments.last;
      final lower = name.toLowerCase();
      if (!_subtitleExtensions.any((ext) => lower.endsWith(ext))) continue;
      if (!lower.startsWith(videoBaseName)) continue;
      options.add(
        MyDeviceSubtitleOption(label: name, isLocal: true, path: entity.path),
      );
    }
    return options;
  }

  static Future<List<MyDeviceSubtitleCue>> loadCuesFromFile(
    String path,
  ) async {
    final content = await File(path).readAsString();
    final lower = path.toLowerCase();
    if (lower.endsWith('.ass') || lower.endsWith('.ssa')) {
      return MyDeviceAssParser.parse(content);
    }
    return MyDeviceSrtParser.parse(content);
  }

  /// Searches OpenSubtitles (api.opensubtitles.com REST v1) by free-text
  /// query. Requires an API key from Settings — returns an empty list (not
  /// an error) if none is configured, since this whole feature is optional.
  static Future<List<MyDeviceSubtitleOption>> searchOpenSubtitles(
    String query,
  ) async {
    final apiKey = MyDeviceSettings.effectiveOpenSubtitlesApiKey;
    if (apiKey.isEmpty || query.trim().isEmpty) return const [];
    final uri = Uri.https('api.opensubtitles.com', '/api/v1/subtitles', {
      'query': query,
    });
    final response = await PitflixHttp.client.get(
      uri,
      headers: {
        'Api-Key': apiKey,
        'User-Agent': 'Pitflix Android v1',
        'Accept': 'application/json',
      },
    );
    if (response.statusCode != 200) return const [];
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final data = body['data'] as List? ?? const [];
    final options = <MyDeviceSubtitleOption>[];
    for (final entry in data) {
      final attributes = entry['attributes'] as Map<String, dynamic>?;
      final files = attributes?['files'] as List? ?? const [];
      final language = attributes?['language'] as String? ?? '?';
      final release = attributes?['release'] as String? ?? query;
      for (final f in files) {
        final fileId = f['file_id'];
        if (fileId == null) continue;
        options.add(
          MyDeviceSubtitleOption(
            label: '$release ($language)',
            isLocal: false,
            path: 'opensubtitles:$fileId',
          ),
        );
      }
    }
    return options;
  }

  /// Searches SubDL by free-text query. Like OpenSubtitles, returns an empty
  /// list rather than throwing if no API key is configured.
  static Future<List<MyDeviceSubtitleOption>> searchSubdl(String query) async {
    final apiKey = MyDeviceSettings.effectiveSubdlApiKey;
    if (apiKey.isEmpty || query.trim().isEmpty) return const [];
    final uri = Uri.https('api.subdl.com', '/api/v1/subtitles', {
      'api_key': apiKey,
      'film_name': query,
    });
    final response = await PitflixHttp.client.get(uri);
    if (response.statusCode != 200) return const [];
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    final subtitles = body['subtitles'] as List? ?? const [];
    return subtitles
        .map((s) {
          final url = s['url'] as String?;
          final lang = s['language'] as String? ?? '?';
          final releaseName = s['release_name'] as String? ?? query;
          if (url == null) return null;
          return MyDeviceSubtitleOption(
            label: '$releaseName ($lang)',
            isLocal: false,
            path: 'subdl:$url',
          );
        })
        .whereType<MyDeviceSubtitleOption>()
        .toList();
  }

  /// Downloads an online subtitle result, saves it next to the video (so a
  /// future open of the same file auto-detects it locally instead of
  /// re-querying), and returns the saved local path.
  static Future<String> downloadAndSave(
    MyDeviceSubtitleOption option,
    String videoPath,
  ) async {
    final targetDir = File(videoPath).parent;
    final baseName = _baseName(videoPath);

    if (option.path.startsWith('opensubtitles:')) {
      final fileId = option.path.substring('opensubtitles:'.length);
      final apiKey = MyDeviceSettings.effectiveOpenSubtitlesApiKey;
      final downloadResponse = await PitflixHttp.client.post(
        Uri.https('api.opensubtitles.com', '/api/v1/download'),
        headers: {
          'Api-Key': apiKey,
          'Content-Type': 'application/json',
          'User-Agent': 'Pitflix Android v1',
        },
        body: jsonEncode({'file_id': int.tryParse(fileId) ?? fileId}),
      );
      final link =
          (jsonDecode(downloadResponse.body)
                  as Map<String, dynamic>)['link']
              as String?;
      if (link == null) {
        throw Exception('OpenSubtitles did not return a download link');
      }
      final srtResponse = await PitflixHttp.client.get(Uri.parse(link));
      final outPath = '${targetDir.path}/$baseName.srt';
      await File(outPath).writeAsString(srtResponse.body);
      return outPath;
    }

    if (option.path.startsWith('subdl:')) {
      final relativeUrl = option.path.substring('subdl:'.length);
      final zipUri = relativeUrl.startsWith('http')
          ? Uri.parse(relativeUrl)
          : Uri.parse('https://dl.subdl.com$relativeUrl');
      final zipResponse = await PitflixHttp.client.get(zipUri);
      final archive = ZipDecoder().decodeBytes(zipResponse.bodyBytes);
      final subtitleFile = archive.files.firstWhere(
        (f) =>
            f.isFile &&
            _subtitleExtensions.any((ext) => f.name.toLowerCase().endsWith(ext)),
        orElse: () => throw Exception('SubDL archive had no subtitle file'),
      );
      final ext = subtitleFile.name.substring(
        subtitleFile.name.lastIndexOf('.'),
      );
      final outPath = '${targetDir.path}/$baseName$ext';
      await File(
        outPath,
      ).writeAsBytes(subtitleFile.content as List<int>);
      return outPath;
    }

    throw Exception('Unknown subtitle source: ${option.path}');
  }

  static String _baseName(String path) {
    final fileName = path.split(Platform.pathSeparator).last;
    final dot = fileName.lastIndexOf('.');
    return dot == -1 ? fileName : fileName.substring(0, dot);
  }
}
