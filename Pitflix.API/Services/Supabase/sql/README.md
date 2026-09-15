# Supabase mobile-sync schema

One-time setup for the Supabase project the desktop app syncs to.

## Apply

1. Create a Supabase project (or reuse an existing one).
2. Open **SQL Editor** in the Supabase dashboard.
3. Paste the contents of [`001_pitflix_mobile_sync_schema.sql`](001_pitflix_mobile_sync_schema.sql) and run it.
   - Idempotent — safe to re-run (`create table if not exists`, `create index if not exists`).
4. In **Project Settings → API**, copy the **Project URL** and the **service_role** key (or `anon` key if you've opened up RLS policies instead of disabling RLS).
5. In Pitflix, go to **Settings → Sync with Mobile**, paste the URL + key, and enable the toggle.

## Notes

- RLS is disabled on all three tables — there's no per-user auth yet, so anyone with the URL + key has full read/write. Keep the service-role key server-side only (it's read by the desktop backend, never shipped to a client).
- `type` on `lists` is constrained to `watchlist` / `favorites` / `custom`. The desktop app maps its built-in "Watch Later" list to `watchlist` and "Favorites" to `favorites`; anything else is `custom`.
- `source` distinguishes which side created a row (`desktop` / `mobile`) — the desktop sync service only pulls rows it didn't itself push.

## Apply (social schema)

Separate, independent schema for the mobile app's Friends/Activity/comments/likes — the desktop app never touches these tables. Unlike the tables above, this one requires real per-user auth.

1. In the Supabase dashboard, go to **Authentication → Providers** and make sure **Email** is enabled (password auth — this is Supabase's built-in auth, not custom-built).
2. Open **SQL Editor**, paste the contents of [`002_pitflix_social_schema.sql`](002_pitflix_social_schema.sql), and run it.
   - Idempotent — safe to re-run (`create table if not exists`, `create policy` guarded by `drop policy if exists`).
3. That's it for this round — no Flutter or backend code calls this schema yet. `FriendsStore`, the activity feed, and comments/likes are still session-only mock data in the app. A future round rewires them to call Supabase Auth + this schema instead.

### Notes

- Every table is keyed off `auth.uid()` and has RLS **enabled** (opposite of the no-auth tables above) — a user can only see their own data plus their friends' activity, and can only write their own rows.
- `profiles` rows are auto-created via an `on_auth_user_created` trigger on `auth.users` — you never insert into `profiles` directly from the client.
- Accepting a friend request goes through the `accept_friend_request(request_id uuid)` RPC (not a direct insert into `friendships`) so the insert + status update happen atomically and can't race.
- `friendships` stores one row per pair with `user_id < friend_id` — always query with `where user_id = me or friend_id = me`, never assume the current user is `user_id`.

## Apply (per-account library schema)

Per-account Watch Later/Favorites/custom lists, movie/episode watched status, ratings, and the data Stats is built from. Independent of both schemas above — replaces the mobile app's reliance on the shared local Pitflix.API backend for this data, so each signed-in account gets its own library instead of everyone on the device seeing the same one.

1. Open **SQL Editor**, paste the contents of [`003_pitflix_user_library_schema.sql`](003_pitflix_user_library_schema.sql), and run it.
   - Idempotent, same pattern as `002`.
2. That's it — `UserLibraryService` in the Flutter app calls this schema directly.

### Notes

- Every table is single-owner — RLS is just `auth.uid() = user_id` (or, for `user_list_items`, via its parent `user_lists.user_id`) with no cross-user visibility, unlike `002`'s friends/activity tables.
- `watch_records` is one row per `(user_id, tmdb_id, media_type)` — covers a movie's watched/rating state AND a series' overall status in the same row. `genres`/`release_year`/`network` are denormalized from TMDB at write time so Stats can compute genre/decade breakdowns without a second lookup.
- `episode_watch_status` uses TMDB show id + season/episode number as the identity (row presence = watched) — no local library row concept, unlike the old Pitflix.API-backed episode tracking.
- This schema intentionally does **not** replicate the desktop's rich Stats engine (watch streak, rewatch-session detection, longest-marathon detection, network breakdown) — that logic depends on the desktop's full local library metadata, which the mobile app has no equivalent source for. Stats/Profile Highlights show what's computable from this schema (counts, average rating, movie/series split, genre/decade breakdown) and simply omit the rest.

## Apply (username login)

Lets Login accept either an email or a `profiles.username` — Supabase Auth only signs in by email, so the app resolves username → email first via an RPC (`auth.users` isn't directly queryable by anon/authenticated roles).

1. Open **SQL Editor**, paste the contents of [`004_pitflix_username_login.sql`](004_pitflix_username_login.sql), and run it.
   - Idempotent, requires `002` (needs `public.profiles`).
2. That's it — `LoginScreen` calls `email_for_username` automatically when the entered value doesn't look like an email.

## Apply (episode rewatch count)

Adds the column the mobile episode popup's "Mark Rewatched" needed but never had — without it, rewatch counts only lived in local widget state and reset on every screen reload.

1. Open **SQL Editor**, paste the contents of [`005_pitflix_episode_rewatch_count.sql`](005_pitflix_episode_rewatch_count.sql), and run it.
   - Idempotent, requires `003` (needs `public.episode_watch_status`).
2. That's it — `UserLibraryService.setEpisodeRewatchCount`/`fetchEpisodeWatchStatuses` read/write it automatically.

## Link Mobile Account (desktop → mobile push sync)

No new schema — this reuses `003`'s tables, just written from the desktop app instead of the mobile app pulling them over the local network.

The desktop app (Settings → Application → "Link Mobile Account") signs in with the *same email/password used on the phone*, storing the returned Supabase refresh token as local `Setting` rows (`MobileSyncRefreshToken`/`MobileSyncEmail`/`MobileSyncUserId`). A background service (`MobileAccountSyncHostedService`, `Pitflix.API/Services/`) then pushes this desktop's watched movies/series/episodes/lists directly into that account's `watch_records`/`episode_watch_status`/`user_lists`/`user_list_items` every 5 minutes — the exact same tables `GET /api/library/watched-export` already exposed, just written server-to-server instead of pulled by the phone.

The Supabase URL and anon key default to the same project the mobile app is hardcoded to (see `PitflixAndroid/lib/config/app_config.dart`) — no manual config needed unless you're pointing at a different project, in which case set the `SupabaseUrl`/`SupabaseAnonKey` settings or `POST /api/mobile-sync/config`.

Because the desktop authenticates as the real account (not the service-role key), all writes go through the normal per-user RLS in `003` — no privilege bypass involved.

## Apply (watch_log unique index)

Lets the desktop push (`MobileAccountSyncService`) upsert per-completion `watch_log` rows — one per movie/episode completion, keyed to its real completion timestamp — instead of inserting a fresh duplicate every 5-minute sync cycle. Feeds the mobile Stats page's "Last 7 Days" bar chart with the same completions the desktop's own "Last 7 days" widget shows.

1. Open **SQL Editor**, paste the contents of [`006_pitflix_watch_log_unique.sql`](006_pitflix_watch_log_unique.sql), and run it.
   - Idempotent, requires `003` (needs `public.watch_log`).
2. That's it — `MobileAccountSyncService` upserts against this index automatically.

## Apply (profile/cover image storage)

Adds a public `profile-images` storage bucket the mobile app's Edit Profile photo picker and Profile's cover-photo picker actually upload to — previously session-only (picks looked saved but vanished on app restart).

1. Open **SQL Editor**, paste the contents of [`007_pitflix_profile_images_storage.sql`](007_pitflix_profile_images_storage.sql), and run it.
   - Idempotent, requires `002` (needs `public.profiles`).
2. That's it — `SocialService.uploadProfileImage` writes to `{your_user_id}/avatar.jpg` / `{your_user_id}/cover.jpg` and updates `profiles.avatar_url`/`cover_url` automatically.

## Apply (title poster/backdrop customizations)

Lets Title Detail's "..." menu offer Change Poster/Change Backdrop for *any* title with a TMDB id — not just ones already matched in the desktop's scanned-media library. Candidate images now come straight from TMDB (`TmdbService.fetchImages`, no desktop backend involved), and the chosen one is saved per-account in this table instead of the old `/api/images/{libraryId}/select` endpoint.

1. Open **SQL Editor**, paste the contents of [`008_pitflix_title_customizations.sql`](008_pitflix_title_customizations.sql), and run it.
   - Idempotent, requires `003` (same RLS pattern).
2. That's it — `UserLibraryService.fetchCustomArtwork`/`setCustomPoster`/`setCustomBackdrop` read/write it automatically.

### Notes

- `user_title_customizations` is keyed by `(user_id, tmdb_id, media_type)`, same identity pattern as `episode_watch_status` — no local library row concept.
- `custom_poster_path`/`custom_backdrop_path` store TMDB-relative paths (e.g. `/abc123.jpg`), resolved to a full URL client-side via `TmdbService.posterUrl`/`backdropUrl`, same as every other poster/backdrop path in the app.

## Apply (desktop sync status)

Lets the mobile app show a real "is my desktop actually syncing" indicator, backed by Supabase instead of a local-network ping — continues the same LAN/IP-independent direction as the title-customizations table above.

1. Open **SQL Editor**, paste the contents of [`009_pitflix_sync_status.sql`](009_pitflix_sync_status.sql), and run it.
   - Idempotent, requires `003` (same RLS pattern).
2. That's it — `MobileAccountSyncService.PushAsync` (desktop) upserts a row here after every successful sync cycle; `UserLibraryService.fetchSyncStatus` (mobile) reads it.

### Notes

- One row per account (`user_id` is the primary key) — a fresh `last_synced_at` means the desktop successfully pushed within the last cycle; a stale or missing row means it hasn't (desktop closed, unlinked, or its last push failed).
- No separate "linked" boolean — a linked-but-never-successfully-synced account simply has no row yet, which the mobile UI treats the same as "not connected."

## Apply (episode rating)

Lets the mobile app track "has this episode been rated?" durably — needed for the "you just watched this, wanna rate it?" notification feature (`UserLibraryService.fetchPendingRatePrompts`). Before this, the episode popup's star rating only ever got posted into the social activity feed, never stored back.

1. Open **SQL Editor**, paste the contents of [`010_pitflix_episode_rating.sql`](010_pitflix_episode_rating.sql), and run it.
   - Idempotent, requires `003` (needs `public.episode_watch_status`).
2. That's it — `UserLibraryService.setEpisodeRating`/`fetchPendingRatePrompts` read/write it automatically.

## Apply (friend library visibility)

Lets Friend Profile show a friend's real watched movies/series counts, last-watched posters, and playlists instead of nothing — `003`'s tables are single-owner only, so a friend's `watch_records`/`user_lists`/`user_list_items` were previously invisible to anyone but the owner, unlike `002`'s friends-visible `activity_events`.

1. Open **SQL Editor**, paste the contents of [`011_pitflix_friend_library_visibility.sql`](011_pitflix_friend_library_visibility.sql), and run it.
   - Idempotent, requires `002` (needs `public.friendships`) and `003` (needs the tables themselves).
2. That's it — `SocialService.fetchFriendLibrarySummary` reads it automatically.

## Apply (activity 'added_to_favorites' action)

Adds a distinct `added_to_favorites` value to `activity_events.action` — until now, adding a title to Favorites was logged under the same `added_to_watchlist` action as a genuine Watch Later add, so it showed "Added to Watch Later" in Activity/Friend Profile feeds for something actually added to Favorites.

1. Open **SQL Editor**, paste the contents of [`012_pitflix_activity_favorites_action.sql`](012_pitflix_activity_favorites_action.sql), and run it.
   - Idempotent, requires `002` (needs `public.activity_events`).
2. That's it — the Favorites toggle on Title Detail now logs the correct action automatically.

## Apply (friend watch-time visibility)

Extends `011`'s friends-visibility to `watch_log`/`episode_watch_status` too, so Friend Profile can show the exact same three stat cards (TV Time, Episodes, Movies) as a user's own Profile instead of a narrower pair. Per-account opt-in decision — 011 originally kept these two tables private since minute-by-minute watch history felt more personal than just "what did they watch".

1. Open **SQL Editor**, paste the contents of [`013_pitflix_friend_watch_time_visibility.sql`](013_pitflix_friend_watch_time_visibility.sql), and run it.
   - Idempotent, requires `002` (needs `public.friendships`) and `003` (needs the tables themselves).
2. That's it — `SocialService.fetchFriendLibrarySummary` reads it automatically.

## Apply (delete own account)

Lets Settings offer real self-service account deletion. Supabase Auth's client SDK has no "delete my own account" call (only an admin API gated behind the service-role key), so this adds a `security definer` RPC that deletes exactly the calling user's own row — never an arbitrary id.

1. Open **SQL Editor**, paste the contents of [`014_pitflix_delete_own_account.sql`](014_pitflix_delete_own_account.sql), and run it.
   - Idempotent (`create or replace function`), requires `002`/`003` (their cascade FKs are what make one delete remove everything).
2. That's it — Settings' "Delete Account" calls `delete_own_account()` automatically.

### Notes

- Deleting `auth.users` cascades through every table that references it `on delete cascade` — profiles, friendships, activity, lists, watch records, episode progress, all of it.
- Storage objects (avatar/cover photos in the `profile-images` bucket) are **not** covered by that cascade and are left behind as orphaned objects — harmless, but a manual cleanup pass would need to handle those separately if that ever matters.

## Apply (synced API keys)

Lets the desktop app push its own configured TMDB/MDBList API keys to the linked mobile account, so the phone uses the same keys automatically instead of whatever was manually copy-pasted into `PitflixAndroid/lib/config/app_config.dart` at build time.

1. Open **SQL Editor**, paste the contents of [`015_pitflix_synced_api_keys.sql`](015_pitflix_synced_api_keys.sql), and run it.
   - Idempotent, requires `002` (needs `public.profiles`/`auth.users`).
2. That's it — `MobileAccountSyncService.PushAsync` (desktop) upserts a row here every sync cycle; `SyncedApiKeysService` (mobile) reads it and overrides `AppConfig`'s compiled-in defaults whenever present.

### Notes

- Single-owner, same RLS pattern as `003` — no friend visibility, these are credentials.
- Mobile still falls back to its own compiled-in `AppConfig` constants when this row doesn't exist yet (never linked) or a given key is empty on the desktop side.

## Apply (subtitle API keys)

Extends the same `user_api_keys` row with the desktop's configured OpenSubtitles/SubDL keys, so the mobile app's My Device local player (Settings > "Enable My Device" > Subtitle Search) can use them automatically instead of requiring separate keys typed on the phone.

1. Open **SQL Editor**, paste the contents of [`016_pitflix_subtitle_api_keys.sql`](016_pitflix_subtitle_api_keys.sql), and run it.
   - Idempotent, requires `015` (this table).
2. That's it — `MobileAccountSyncService.PushAsync` (desktop) now also upserts `opensubtitles_api_key`/`subdl_api_key` on every sync cycle; `SyncedApiKeysService` (mobile) reads them and feeds `MyDeviceSettings.applySyncedSubtitleKeys`, which only takes effect for a key the user hasn't typed directly into the phone's own Settings screen.

### Notes

- Same single-owner RLS as `015` — no friend visibility.
- This is the one exception to My Device's "nothing shared with desktop config" design: the user explicitly asked for these two keys to flow through the existing desktop→mobile key-sync pipeline rather than requiring manual entry in both places. Every other part of My Device (scan cache, resume positions, local subtitle files) stays fully local/unsynced.

### Notes

- Read-only for friends — these are additional SELECT-only policies layered on top of `003`'s existing owner-only `for all` policies, so writes (insert/update/delete) stay owner-only throughout.
- `episode_watch_status`/`watch_log` are intentionally NOT opened up here — a friend's per-episode progress and minute-by-minute watch log stay private; only the coarser `watch_records`/lists summary is shared.

## Desktop sync now reads/writes `rewatch_count` (no new migration)

`watch_records.rewatch_count` (`003`) and `episode_watch_status.rewatch_count` (`005`) already existed but were mobile-only — desktop's `MobileAccountSyncService.PushAsync` never touched them, so the wipe-then-reinsert every sync cycle (`ReconcileStaleWatchDataAsync`) was silently resetting any mobile-set episode rewatch count back to 0. Fixed by having `PushAsync` read the existing values *before* the wipe and push `max(desktop's own count, whatever Supabase already had)` for movies/episodes (desktop now tracks its own `Movie.RewatchCount`/`Episode.RewatchCount`), and `max(0, existing)` for series (desktop still doesn't track a per-series count, so this just carries a mobile-set value forward untouched). No DDL needed — no new numbered file for this one.
