import 'package:flutter/material.dart';
import '../models/person_credit.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import 'poster_card.dart';

/// A filmography grid: poster, title, the role played or job done, and the year.
///
/// Uses [PosterCard]'s own title/subtitle overlay rather than stacking text underneath, so these
/// cards match every other poster grid in the app.
///
/// A prolific person can have hundreds of credits, so this shows [initialCount] and reveals the rest
/// behind a "Show all" button — the grid sits inside a ListView with `shrinkWrap`, which lays out
/// every child on first paint, so an unbounded one would build hundreds of cards up front.
class PersonCreditGrid extends StatefulWidget {
  final List<PersonCredit> credits;
  final void Function(PersonCredit credit) onTap;
  final void Function(PersonCredit credit)? onLongPress;
  final int initialCount;

  const PersonCreditGrid({
    super.key,
    required this.credits,
    required this.onTap,
    this.onLongPress,
    this.initialCount = 24,
  });

  @override
  State<PersonCreditGrid> createState() => _PersonCreditGridState();
}

class _PersonCreditGridState extends State<PersonCreditGrid> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final all = widget.credits;
    final hasMore = all.length > widget.initialCount;
    final shown = _expanded || !hasMore ? all : all.take(widget.initialCount).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 2 / 3,
          ),
          itemCount: shown.length,
          itemBuilder: (context, i) {
            final credit = shown[i];
            final year = credit.year;
            return PosterCard(
              title: credit.title,
              // The character played, or the job done — the thing this screen exists to show.
              subtitle: credit.roleLabel,
              cornerBadge: year?.toString(),
              gradientSeed: credit.tmdbId % 6,
              imageUrl: TmdbService.posterUrl(credit.posterPath),
              tmdbId: credit.tmdbId,
              kind: credit.kind,
              onTap: () => widget.onTap(credit),
              onLongPress: widget.onLongPress == null
                  ? null
                  : () => widget.onLongPress!(credit),
            );
          },
        ),
        if (hasMore) ...[
          const SizedBox(height: 12),
          Center(
            child: TextButton(
              onPressed: () => setState(() => _expanded = !_expanded),
              child: Text(
                _expanded ? 'Show less' : 'Show all ${all.length}',
                style: AppTextStyles.dmSans(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.logoAccent,
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
