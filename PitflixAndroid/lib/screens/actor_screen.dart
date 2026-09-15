import 'package:flutter/material.dart';
import '../data/mock_data.dart';
import '../models/actor.dart';
import '../models/cast_member.dart';
import '../models/person_credit.dart';
import '../models/person_profile.dart';
import '../models/title_item.dart';
import '../services/tmdb_service.dart';
import '../theme/app_theme.dart';
import '../utils/title_actions_sheet.dart';
import '../widgets/person_credit_grid.dart';
import '../widgets/widgets.dart';
import 'title_detail_movie_screen.dart';
import 'title_detail_series_screen.dart';
import '../widgets/pitflix_network_image.dart';

/// Person detail — either the app's mock [Actor] data, or a real TMDB person backed by
/// `/person/{id}` (bio, birthday, full filmography). No local backend involved.
///
/// Serves cast *and* crew: TMDB makes no distinction between an actor and a director at the person
/// level, so tapping a director in a title's crew row lands here too. The only difference is which
/// filmography leads — see [PersonProfile.leadsWithCrew].
class ActorScreen extends StatefulWidget {
  final Actor? actor;
  final CastMember? castMember;

  const ActorScreen.mock({super.key, required this.actor}) : castMember = null;

  const ActorScreen.real({super.key, required this.castMember}) : actor = null;

  @override
  State<ActorScreen> createState() => _ActorScreenState();
}

class _ActorScreenState extends State<ActorScreen> {
  PersonProfile? _profile;
  bool _loading = false;
  bool _failed = false;

  bool get _isReal => widget.castMember != null;

  @override
  void initState() {
    super.initState();
    final personId = widget.castMember?.tmdbPersonId;
    if (personId != null) {
      _loading = true;
      TmdbService.fetchPersonProfile(personId).then((data) {
        if (!mounted) return;
        setState(() {
          _profile = data;
          _loading = false;
          _failed = data == null;
        });
      });
    }
  }

  void _openTitle(TitleItem title) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => title.isShow
            ? TitleDetailSeriesScreen(title: title)
            : TitleDetailMovieScreen(title: title),
      ),
    );
  }

  void _openCredit(PersonCredit credit) => _openTitle(credit.toTitleItem());

  void _showActions(TitleItem title) =>
      showTitleActionsSheet(context, title, (_) {});

  @override
  Widget build(BuildContext context) {
    return _isReal ? _buildReal(context) : _buildMock(context);
  }

  // ── mock path ────────────────────────────────────────────────────────────

  Widget _buildMock(BuildContext context) {
    final actor = widget.actor!;
    final filmography = MockData.byIds(actor.filmographyTitleIds);
    return _scaffold(
      name: actor.name,
      subtitle: '${actor.birthDate} · ${actor.birthPlace}',
      initials: actor.initials,
      imageUrl: null,
      body: [
        Text(
          actor.bio,
          style: AppTextStyles.dmSans(
            fontSize: 13,
            height: 1.65,
            color: Colors.white.withValues(alpha: 0.65),
          ),
        ),
        const SizedBox(height: AppSpacing.sectionGap),
        Text('FILMOGRAPHY', style: AppTextStyles.sectionLabel()),
        const SizedBox(height: 12),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
            childAspectRatio: 2 / 3,
          ),
          itemCount: filmography.length,
          itemBuilder: (context, i) {
            final t = filmography[i];
            return PosterCard(
              title: t.name,
              gradientSeed: t.gradientSeed,
              onTap: () => _openTitle(t),
              onLongPress: () => _showActions(t),
            );
          },
        ),
      ],
    );
  }

  // ── real (TMDB-backed) path ─────────────────────────────────────────────

  Widget _buildReal(BuildContext context) {
    final member = widget.castMember!;
    final profile = _profile;
    final name = profile?.name.isNotEmpty == true ? profile!.name : member.name;

    return _scaffold(
      name: name,
      // Falls back to the role they were tapped from until the profile lands, so the header is never
      // just a bare name.
      subtitle: profile?.subtitle ?? member.roleLabel,
      initials: member.initials,
      imageUrl:
          TmdbService.profileUrl(profile?.profilePath) ??
          TmdbService.profileUrl(member.profilePath),
      body: [
        if (_loading)
          const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: CircularProgressIndicator(color: AppColors.logoAccent),
            ),
          )
        else if (_failed)
          Text(
            "Couldn't load full bio — showing what's available.",
            style: AppTextStyles.dmSans(fontSize: 12, color: AppColors.textMuted),
          )
        else if (profile != null) ...[
          if (profile.biography?.isNotEmpty == true)
            Text(
              profile.biography!,
              style: AppTextStyles.dmSans(
                fontSize: 13,
                height: 1.65,
                color: Colors.white.withValues(alpha: 0.65),
              ),
            ),
          // Someone known for directing leads with their crew work; an actor leads with acting.
          ...profile.leadsWithCrew
              ? [
                  ..._creditSection('CREW', profile.crewCredits),
                  ..._creditSection('FILMOGRAPHY', profile.actingCredits),
                ]
              : [
                  ..._creditSection('FILMOGRAPHY', profile.actingCredits),
                  ..._creditSection('CREW', profile.crewCredits),
                ],
        ],
      ],
    );
  }

  List<Widget> _creditSection(String label, List<PersonCredit> credits) {
    if (credits.isEmpty) return const [];
    return [
      const SizedBox(height: AppSpacing.sectionGap),
      Row(
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: [
          Text(label, style: AppTextStyles.sectionLabel()),
          const SizedBox(width: 8),
          Text(
            '${credits.length}',
            style: AppTextStyles.dmSans(fontSize: 11, color: AppColors.textMuted),
          ),
        ],
      ),
      const SizedBox(height: 12),
      PersonCreditGrid(
        credits: credits,
        onTap: _openCredit,
        onLongPress: (c) => _showActions(c.toTitleItem()),
      ),
    ];
  }

  // ── shared chrome ────────────────────────────────────────────────────────

  Widget _scaffold({
    required String name,
    required String? subtitle,
    required String initials,
    required String? imageUrl,
    required List<Widget> body,
  }) {
    return Scaffold(
      backgroundColor: AppColors.bgBase,
      body: SafeArea(
        child: Column(
          children: [
            // Header: back button + portrait + name
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 16),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  CircleIconButton(
                    icon: Icons.arrow_back_ios_new,
                    background: AppColors.bgCard,
                    onTap: () => Navigator.of(context).pop(),
                  ),
                  const SizedBox(width: 14),
                  // Portrait
                  Container(
                    width: 56,
                    height: 76,
                    clipBehavior: Clip.antiAlias,
                    decoration: BoxDecoration(
                      color: AppColors.avatarBg,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(
                        color: AppColors.borderInput,
                        width: 1.5,
                      ),
                    ),
                    alignment: Alignment.center,
                    child: imageUrl != null
                        ? PitflixNetworkImage(
                            imageUrl,
                            fit: BoxFit.cover,
                            width: 56,
                            height: 76,
                            errorBuilder: (context, err, st) => Text(
                              initials,
                              style: AppTextStyles.bebas(
                                fontSize: 22,
                                color: AppColors.logoAccent,
                              ),
                            ),
                          )
                        : Text(
                            initials,
                            style: AppTextStyles.bebas(
                              fontSize: 22,
                              color: AppColors.logoAccent,
                            ),
                          ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          name.toUpperCase(),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: AppTextStyles.bebas(
                            fontSize: 24,
                            letterSpacing: 0.08,
                            color: AppColors.logoAccent,
                          ),
                        ),
                        if (subtitle != null && subtitle.isNotEmpty) ...[
                          const SizedBox(height: 2),
                          Text(
                            subtitle,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: AppTextStyles.dmSans(
                              fontSize: 11,
                              color: AppColors.textMuted,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
                children: body,
              ),
            ),
            const PushedScreenBottomNav(active: MainTab.discover),
          ],
        ),
      ),
    );
  }
}
