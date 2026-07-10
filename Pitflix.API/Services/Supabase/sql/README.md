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
