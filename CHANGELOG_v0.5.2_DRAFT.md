# Pitflix — v0.5.1 → v0.5.2 (unreleased)

**Span:** 2026-07-10 → 2026-09-15 (one squashed commit, `e8debf4 "edits v0.5.2"`)
**Size:** 515 files changed, 53,447 insertions(+), 9,814 deletions(-)

This is a large, unreleased batch of work — not yet tagged `v0.5.2`. Given the size (over two months, 515 files), this summary is built from the file-level diff (what was added/changed, grouped by area) rather than a full line-by-line read of every change. Treat filenames/descriptions below as a reliable map of *what moved*; exact behavioral details of any one item are worth a closer look before relying on them for release notes.

---

## Online Streaming (this session's work)

- **Real IMDb ratings, not TMDB's** — new background service (`ImdbTop100RefreshHostedService`, `ImdbTop100Store`, `ImdbTop100TvStore`) ranks ~150 candidate movies/TV shows against their actual IMDb score (via MDBList), refreshed every 12h and persisted to disk so restarts don't lose it. Powers new **"Top 100 Movies on IMDb"** and **"Top 100 TV Shows on IMDb"** rows.
- Every streaming rating badge (sliders, hero, category browse, studio browse, search) now shows a real cached IMDb score when available, falling back to TMDB's rating otherwise — reusing the same batch-cached-ratings endpoint that already powers library poster cards.
- **Category browsing**: new dedicated pages (`StreamGenrePage`, `StreamStudioPage`) with pagination ("Load More"), sort tabs (Popularity/Top Rated/Newest), and a "Browse by Category" poster-tile row on the Online Streaming page. Fixed a sort bug (niche low-vote titles topping "Top Rated") and a "Newest" bug (TMDB's unblocked future-dated results being filtered to near-nothing).
- **Studio & Network**: new `/stream-studio` page — click Netflix/HBO/Apple TV+/a movie studio anywhere (streaming detail page *and* local library detail pages) to browse everything else they produced. Backend dedupes near-duplicate company entries and drops logo-less clutter.
- New full-page **search overlay** (`StreamSearchOverlay`) replacing the old inline results — Movie/TV tabs, live results, and localStorage-backed recent searches (mirrors the Home page's search overlay).
- Removed a redundant "TV Airing Today" row (near-total overlap with "TV On The Air").

## Backend — new capabilities

- **Recommendation engine** (`RecommendationEngine`, `LibraryRecommendationsService` + hosted refresh, `RecommendationsEndpoints`) — a new scored recommendation system for the library, plus a DB migration (`AddRecommendationEngineMigration`).
- **Stremio addon support** (`StremioAddonService`, `StremioAddonEndpoints`) — Pitflix can act as a Stremio addon source.
- **EZTV scraper** (`EztvScraperService`, `EztvEndpoints`) — another torrent source alongside existing ones (YTS, TPB, PSA, WSM).
- **Fanart.tv client** (`FanartClient`) and **image thumbnail service** (`ImageThumbnailService`) — additional artwork sourcing/processing.
- **Intro/recap detection** (`IntroDbService`, `TheIntroDbService`) alongside the existing skip-segment detection.
- **Next-airing cache** (`NextAiringRefreshHostedService` + `AddNextAiringCacheMigration`) — precomputed "when does the next episode air" data.
- **OMDb rating client** re-added (`OmdbRatingClient`) as a supplementary source alongside MDBList.
- Ten new Supabase SQL migrations (007–016): profile image storage, title customizations, sync status, per-episode ratings, friend library/watch-time visibility, activity favorites, account deletion, synced API keys, subtitle API keys — the mobile-sync/social feature surface expanded significantly.
- Arabic text utilities (`Pitflix.Core/ArabicText.cs`) and `NameParser.cs` improvements (matches earlier session notes about SxxExx parsing fixes).
- `TmdbCompanyInfo` model + `TmdbClient` additions (this session's Studio/Network work).

## Desktop app (Pitflix.UI / Tauri)

- **Torrent streaming** — new `torrent_stream.rs` Rust module + `TorrentStreamProgress.tsx`: stream a torrent directly rather than only downloading first.
- **Player engine**: `windows_host.rs` rewritten almost entirely (+5,468/-lines), plus large changes to `libmpv.rs`, `libmpv_session.rs`, `tauri_commands.rs`, `thumbs.rs`, `player_export.rs` — a substantial rework of the native playback layer. Given the size, this is worth its own dedicated review before shipping rather than trusting this summary.
- **My Device** page rewritten (+1,187 lines) — folder browsing, local subtitles (ASS/SRT parsers), favorites, resume position, loudness boost, quick sort, move/roulette modals (matches memory notes on the My Device feature).
- **PlayerPage** substantially reworked (+782/-lines).
- **Roulette** ("pick something at random") — new `RouletteModal.tsx` (both desktop and My Device variants).
- **Notifications center** — new `NotificationsBell.tsx`, `notificationsStore.ts` (Home bell notifications, per earlier memory note).
- New UI primitives: `Skeleton.tsx`, `Lightbox.tsx`, `LazyMount.tsx`, `BackButton.tsx`, `RewatchBadge`/`RewatchPopover`.
- Ad-block for the in-app browser (`browseAdBlock.ts`, `browse/network.rs`, `browse/blocklist.rs` expanded).
- Query cache persistence (`queryCachePersistence.ts`) — survives restarts.
- Page transitions (`PageTransition.tsx`).

## Android app (PitflixAndroid)

- **My Device** (on-device video) ported to Android to match desktop: scanner, player screen, subtitle parsing, favorites, resume, folder browsing.
- **Letterboxd / TV Time import** (`import_csv_utils`, `letterboxd_import_service`, `tvtime_import_service`, `tmdb_match_service`, `import_data_screen`) — matches the earlier memory note on this feature.
- **Ratings via MDBList** (`mdblist_service.dart`, `ratings_service.dart`, `ratings_row.dart`) — real IMDb/RT scores on Android detail pages.
- **Rate-prompt notifications** ("wanna rate it?") — `rate_prompt_store.dart`, `rate_prompt_item.dart` (matches memory note; needs migration 010 run manually per that note).
- **Onboarding screen** and **notifications screen** — new.
- **Person filmography/crew** (`person_credit.dart`, `person_credit_grid.dart`, `PersonPhotoGallery`-equivalent) — matches memory note on Android filmography & crew work.
- `user_library_service.dart` grew enormously (+1,046 lines) — core library/sync logic expansion.
- `tmdb_service.dart` (+656 lines) and `social_service.dart` changes — broader TMDB coverage and social/friends features.
- Video player plugin (`third_party/video_player_android`) vendored/patched in full (new AUTHORS/CHANGELOG/LICENSE + extensive platform-view/texture player code) — this looks like a from-scratch vendoring of a patched Flutter video_player_android, not a small tweak.

## Windows player companion apps (PitflixPlayer, PitflixPlayer2)

- `ControlsWindow.xaml.cs` substantially rewritten in both (+519/-lines and +411/-lines respectively).
- New `PlayerApiClient.cs` in both — talks back to the main app's API.

## Housekeeping

- New `Pitflix.API.Tests` project (`StremioAddonServiceTests.cs`) — first tests for the Stremio addon.
- `Pitflix.Tests/ArabicTextTests.cs` — new.
- One file deleted: `PitflixAndroid/lib/services/local_backend_service.dart` (superseded, presumably by the API-client services added alongside it).
- `.claude/skills/pitflix-mydevice/SKILL.md` added — a Claude Code skill documenting My Device conventions (this explains why that skill showed up as "available" in later sessions).

---

*Caveat: this draft is generated from `git diff --stat`/`--name-status` between `v0.5.1` and the current `HEAD` (commit `e8debf4`), not a full read of every hunk — appropriate for a summary of this size, but verify specifics before publishing as official release notes.*
