import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_cropper/image_cropper.dart';
import '../theme/app_theme.dart';

/// Opens the crop UI on a just-picked photo (see image_picker's `XFile.path`)
/// so avatar/cover uploads are reframed before uploading whatever rectangle
/// the camera/gallery/file-picker happened to hand back. Returns the cropped
/// bytes, or null if the user backs out of the cropper. Native crop UI on
/// Android/iOS; on web, image_cropper_for_web drives an in-page cropper.js
/// dialog instead (needs [context] to host that dialog/route), and the
/// result comes back as a blob: URL that has to be fetched rather than read
/// off disk.
///
/// [isCircle] gives a round crop mask matching how avatars actually render
/// (circle) — cosmetic only, the underlying file is still a normal
/// rectangular image; [aspectRatio] otherwise locks the crop box (e.g.
/// 1080/400 for covers, matching how they're actually displayed). Passing
/// aspectRatio 1:1 for circle crops (instead of relying only on the
/// Android/iOS circle mask to imply it) is what keeps the selection square
/// on web too, where there's no native circle mask to fall back on.
Future<Uint8List?> cropPickedImage(
  BuildContext context,
  String sourcePath, {
  bool isCircle = false,
  double? aspectRatio,
}) async {
  final effectiveAspectRatio = isCircle ? 1.0 : aspectRatio;
  final cropped = await ImageCropper().cropImage(
    sourcePath: sourcePath,
    aspectRatio: effectiveAspectRatio == null
        ? null
        : CropAspectRatio(ratioX: effectiveAspectRatio, ratioY: 1),
    compressFormat: ImageCompressFormat.jpg,
    compressQuality: 90,
    uiSettings: [
      AndroidUiSettings(
        toolbarTitle: isCircle ? 'Crop Photo' : 'Crop Cover',
        toolbarColor: AppColors.bgBase,
        toolbarWidgetColor: AppColors.textPrimary,
        backgroundColor: AppColors.bgBase,
        activeControlsWidgetColor: AppColors.accent,
        cropStyle: isCircle ? CropStyle.circle : CropStyle.rectangle,
        lockAspectRatio: aspectRatio != null || isCircle,
      ),
      IOSUiSettings(
        title: isCircle ? 'Crop Photo' : 'Crop Cover',
        cropStyle: isCircle ? CropStyle.circle : CropStyle.rectangle,
        aspectRatioLockEnabled: aspectRatio != null || isCircle,
      ),
      WebUiSettings(
        context: context,
        presentStyle: WebPresentStyle.dialog,
        size: const CropperSize(width: 500, height: 500),
      ),
    ],
  );
  if (cropped == null) return null;
  if (kIsWeb) {
    // On web, CroppedFile.path is a blob: URL (the cropped canvas exported
    // via toBlob), not a filesystem path — dart:io can't touch it, so it has
    // to be fetched back out like any other same-origin resource.
    final response = await http.get(Uri.parse(cropped.path));
    return response.bodyBytes;
  }
  return File(cropped.path).readAsBytes();
}
