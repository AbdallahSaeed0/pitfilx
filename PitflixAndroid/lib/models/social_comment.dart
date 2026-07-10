import 'social_profile.dart';

/// A real `activity_comments` row, joined with the author's profile.
class SocialComment {
  final String id;
  final SocialProfile profile;
  final String body;
  final DateTime createdAt;

  const SocialComment({
    required this.id,
    required this.profile,
    required this.body,
    required this.createdAt,
  });

  factory SocialComment.fromJson(
    Map<String, dynamic> json,
    SocialProfile profile,
  ) {
    return SocialComment(
      id: json['id'] as String,
      profile: profile,
      body: json['body'] as String,
      createdAt: DateTime.parse(json['created_at'] as String),
    );
  }
}
