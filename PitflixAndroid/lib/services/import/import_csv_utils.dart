import 'dart:convert';
import 'dart:typed_data';

import 'package:archive/archive.dart';
import 'package:csv/csv.dart';

/// Reads and parses a single CSV file out of a zip archive (Letterboxd and
/// TV Time GDPR exports both put their CSVs at the archive root). Returns an
/// empty list — not an error — when the file is missing, since some export
/// variants omit files with no data (e.g. an empty watchlist). Callers that
/// need to tell "file legitimately empty" apart from "file not found at all"
/// (the latter usually means the expected filename is wrong, e.g. the export
/// format changed) should cross-check against [listZipFileNames].
List<List<dynamic>> readCsvFromZip(Uint8List zipBytes, String fileName) {
  final archive = ZipDecoder().decodeBytes(zipBytes);
  ArchiveFile? file;
  for (final f in archive.files) {
    if (f.isFile && (f.name == fileName || f.name.endsWith('/$fileName'))) {
      file = f;
      break;
    }
  }
  if (file == null) return const [];
  var content = utf8.decode(file.content as List<int>, allowMalformed: true);
  // Strip a leading UTF-8 BOM (TV Time's export includes one) and normalize
  // line endings to plain '\n' before handing off to CsvToListConverter —
  // without this, an export using '\r\n' or lone '\r' line breaks (observed
  // in a real TV Time export) gets parsed as one giant row instead of one
  // row per line, since the converter's own EOL auto-detection didn't catch
  // it, silently producing zero usable rows despite the file being found and
  // its column layout being correct.
  const bom = '﻿';
  if (content.startsWith(bom)) content = content.substring(bom.length);
  content = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return const CsvToListConverter(
    shouldParseNumbers: false,
    eol: '\n',
  ).convert(content);
}

/// Every file name present in the archive — used to diagnose "the expected
/// CSV wasn't found" (see [readCsvFromZip]'s doc) by showing what's actually
/// in there instead of failing silently with an all-zero import result.
List<String> listZipFileNames(Uint8List zipBytes) {
  final archive = ZipDecoder().decodeBytes(zipBytes);
  return archive.files.where((f) => f.isFile).map((f) => f.name).toList();
}
