import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

/// Multi-platform ratings strip (TMDB / IMDb / Rotten Tomatoes critics &
/// audience / Metacritic / Letterboxd) with brand-coloured logo badges above
/// each score. A source's cell is simply omitted when RatingsService/MDBList
/// didn't return a value for it (title not tracked by that provider, or
/// MDBList not configured).
class RatingsRow extends StatelessWidget {
  final Map<String, dynamic> ratings;

  const RatingsRow({super.key, required this.ratings});

  @override
  Widget build(BuildContext context) {
    final items = <_RatingEntry>[
      if (ratings['tmdbRating'] != null)
        _RatingEntry(
          source: _RatingSource.tmdb,
          value: (ratings['tmdbRating'] as num).toStringAsFixed(1),
        ),
      if (_nonEmpty(ratings['imdbRating']))
        _RatingEntry(
          source: _RatingSource.imdb,
          value: ratings['imdbRating'] as String,
        ),
      if (_nonEmpty(ratings['rtCritics']))
        _RatingEntry(
          source: _RatingSource.rtCritics,
          value: ratings['rtCritics'] as String,
        ),
      if (_nonEmpty(ratings['rtAudience']))
        _RatingEntry(
          source: _RatingSource.rtAudience,
          value: ratings['rtAudience'] as String,
        ),
      if (_nonEmpty(ratings['metacritic']))
        _RatingEntry(
          source: _RatingSource.metacritic,
          value: ratings['metacritic'] as String,
        ),
      if (_nonEmpty(ratings['letterboxd']))
        _RatingEntry(
          source: _RatingSource.letterboxd,
          value: ratings['letterboxd'] as String,
        ),
    ];

    if (items.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        color: AppColors.bgCard,
        borderRadius: BorderRadius.circular(AppSpacing.cardRadiusMin),
      ),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            for (var i = 0; i < items.length; i++) ...[
              if (i > 0)
                const VerticalDivider(width: 1, color: AppColors.border),
              Expanded(child: _RatingCell(entry: items[i])),
            ],
          ],
        ),
      ),
    );
  }

  static bool _nonEmpty(dynamic v) => v is String && v.isNotEmpty;
}

enum _RatingSource { tmdb, imdb, rtCritics, rtAudience, metacritic, letterboxd }

class _RatingEntry {
  final _RatingSource source;
  final String value;
  const _RatingEntry({required this.source, required this.value});
}

class _RatingCell extends StatelessWidget {
  final _RatingEntry entry;
  const _RatingCell({required this.entry});

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        _LogoBadge(source: entry.source),
        const SizedBox(height: 6),
        Text(
          // Letterboxd is natively a 0-5 scale, unlike every other source
          // here (0-10 or a 0-100%) — spelling that out avoids it reading
          // like a suspiciously low score on the same scale as the rest.
          entry.source == _RatingSource.letterboxd
              ? '${entry.value}/5'
              : entry.value,
          style: AppTextStyles.bebas(fontSize: 20),
        ),
      ],
    );
  }
}

/// Brand logo rendered purely with Flutter widgets — no external asset files.
class _LogoBadge extends StatelessWidget {
  final _RatingSource source;
  const _LogoBadge({required this.source});

  @override
  Widget build(BuildContext context) {
    return switch (source) {
      _RatingSource.tmdb => _TmdbLogo(),
      _RatingSource.imdb => _ImdbLogo(),
      _RatingSource.rtCritics => _RtLogo(audience: false),
      _RatingSource.rtAudience => _RtLogo(audience: true),
      _RatingSource.metacritic => _MetacriticLogo(),
      _RatingSource.letterboxd => _LetterboxdLogo(),
    };
  }
}

/// TMDB — teal pill with white text.
class _TmdbLogo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF01B4E4),
        borderRadius: BorderRadius.circular(4),
      ),
      child: const Text(
        'TMDB',
        style: TextStyle(
          fontFamily: 'DM Sans',
          fontSize: 9,
          fontWeight: FontWeight.w800,
          color: Colors.white,
          letterSpacing: 0.5,
          height: 1,
        ),
      ),
    );
  }
}

/// IMDb — gold pill with dark text.
class _ImdbLogo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFFF5C518),
        borderRadius: BorderRadius.circular(4),
      ),
      child: const Text(
        'IMDb',
        style: TextStyle(
          fontFamily: 'DM Sans',
          fontSize: 9,
          fontWeight: FontWeight.w900,
          color: Color(0xFF000000),
          letterSpacing: 0.3,
          height: 1,
        ),
      ),
    );
  }
}

/// Rotten Tomatoes — red pill with 🍅 (critics) or 🍿 (audience).
class _RtLogo extends StatelessWidget {
  final bool audience;
  const _RtLogo({required this.audience});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: audience ? const Color(0xFF1E3A2F) : const Color(0xFF3A1212),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(
          color: audience
              ? const Color(0xFF34D399).withValues(alpha: 0.5)
              : const Color(0xFFEF4444).withValues(alpha: 0.5),
          width: 1,
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            audience ? '🍿' : '🍅',
            style: const TextStyle(fontSize: 9, height: 1),
          ),
          const SizedBox(width: 3),
          Text(
            audience ? 'Audience' : 'Critics',
            style: TextStyle(
              fontFamily: 'DM Sans',
              fontSize: 8,
              fontWeight: FontWeight.w700,
              color: audience
                  ? const Color(0xFF34D399)
                  : const Color(0xFFEF4444),
              height: 1,
            ),
          ),
        ],
      ),
    );
  }
}

/// Metacritic — dark pill, score-colored (green/yellow/red like the site's
/// own Metascore badge).
class _MetacriticLogo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: Colors.white.withValues(alpha: 0.2)),
      ),
      child: const Text(
        'Metacritic',
        style: TextStyle(
          fontFamily: 'DM Sans',
          fontSize: 8,
          fontWeight: FontWeight.w800,
          color: Colors.white,
          letterSpacing: 0.2,
          height: 1,
        ),
      ),
    );
  }
}

/// Letterboxd — dark pill with its signature orange/green/blue dots.
class _LetterboxdLogo extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: const Color(0xFF14181C),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _dot(const Color(0xFFFF8000)),
          const SizedBox(width: 2),
          _dot(const Color(0xFF00E054)),
          const SizedBox(width: 2),
          _dot(const Color(0xFF40BCF4)),
          const SizedBox(width: 4),
          const Text(
            'Letterboxd',
            style: TextStyle(
              fontFamily: 'DM Sans',
              fontSize: 8,
              fontWeight: FontWeight.w800,
              color: Colors.white,
              letterSpacing: 0.1,
              height: 1,
            ),
          ),
        ],
      ),
    );
  }

  Widget _dot(Color color) => Container(
    width: 6,
    height: 6,
    decoration: BoxDecoration(color: color, shape: BoxShape.circle),
  );
}
