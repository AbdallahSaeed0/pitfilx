/// A real user's `profiles` row — replaces the old mock `Friend` model.
class SocialProfile {
  final String id;
  final String? username;
  final String? displayName;
  final String? avatarUrl;

  const SocialProfile({
    required this.id,
    this.username,
    this.displayName,
    this.avatarUrl,
  });

  factory SocialProfile.fromJson(Map<String, dynamic> json) => SocialProfile(
    id: json['id'] as String,
    username: json['username'] as String?,
    displayName: json['display_name'] as String?,
    avatarUrl: json['avatar_url'] as String?,
  );

  String get name => displayName ?? username ?? 'Unknown';

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    final first = parts.first[0];
    final second = parts.length > 1 && parts[1].isNotEmpty ? parts[1][0] : '';
    return (first + second).toUpperCase();
  }

  /// Deterministic gradient seed derived from [id] so the same profile
  /// always gets the same avatar color (mirrors the old mock Friend's
  /// hand-picked `gradientSeed`, which doesn't exist for real profiles).
  int get gradientSeed => id.hashCode % 6;
}
