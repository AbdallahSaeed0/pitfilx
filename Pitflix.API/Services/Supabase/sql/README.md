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
