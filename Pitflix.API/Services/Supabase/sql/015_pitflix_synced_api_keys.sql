-- Lets the desktop app push its own configured TMDB/MDBList API keys to the
-- linked mobile account, so the phone can use the same keys instead of the
-- ones baked into the mobile build at compile time (previously a manual
-- copy-paste into PitflixAndroid/lib/config/app_config.dart whenever the
-- desktop key changed).
--
-- One row per account, single-owner — same RLS pattern as 003 (no friend
-- visibility; these are credentials, not watch data).
--
-- Requires 002 (public.profiles / auth.users). Idempotent, same pattern as
-- every other migration here.

create table if not exists public.user_api_keys (
    user_id          uuid primary key references auth.users (id) on delete cascade,
    tmdb_api_key     text,
    mdblist_api_key  text,
    updated_at       timestamptz not null default now()
);

alter table public.user_api_keys enable row level security;

drop policy if exists "user_api_keys_own" on public.user_api_keys;
create policy "user_api_keys_own" on public.user_api_keys
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
