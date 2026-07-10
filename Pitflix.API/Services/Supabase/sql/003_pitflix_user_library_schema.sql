-- Pitflix mobile per-account library schema (Watch Later, watched status,
-- ratings, episode progress, Stats source data)
--
-- Independent of 001 (desktop sync, no-auth) and 002 (social graph). Unlike
-- 002, no cross-user visibility is needed here — every table is strictly
-- single-owner, so RLS is just `user_id = auth.uid()` throughout.
--
-- Requires Supabase Auth (same as 002) — run after 002.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── user_lists ─────────────────────────────────────────────────────────────
create table if not exists public.user_lists (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    name        text not null,
    type        text not null check (type in ('watchlist', 'favorites', 'custom')),
    created_at  timestamptz not null default now()
);

create index if not exists idx_user_lists_user on public.user_lists (user_id);

-- ── user_list_items ────────────────────────────────────────────────────────
create table if not exists public.user_list_items (
    id          uuid primary key default gen_random_uuid(),
    list_id     uuid not null references public.user_lists (id) on delete cascade,
    tmdb_id     integer not null,
    media_type  text not null,
    title       text,
    poster_path text,
    added_at    timestamptz not null default now()
);

create index if not exists idx_user_list_items_list on public.user_list_items (list_id);
create unique index if not exists idx_user_list_items_unique
    on public.user_list_items (list_id, tmdb_id, media_type);

-- ── watch_records ──────────────────────────────────────────────────────────
-- One row per (user, title): covers movie watched/rating AND a series'
-- overall status. genres/release_year/network are denormalized from TMDB at
-- write time so Stats can compute genre/decade breakdowns without a second
-- lookup (same denormalization pattern as 002's activity_events).
create table if not exists public.watch_records (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users (id) on delete cascade,
    tmdb_id       integer not null,
    media_type    text not null check (media_type in ('movie', 'series')),
    title         text,
    poster_path   text,
    genres        text[] not null default '{}',
    release_year  integer,
    network       text,
    status        text not null default 'watching' check (status in ('watching', 'completed', 'dropped')),
    rating        smallint check (rating between 1 and 5),
    rewatch_count integer not null default 0,
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create unique index if not exists idx_watch_records_unique
    on public.watch_records (user_id, tmdb_id, media_type);
create index if not exists idx_watch_records_user_status
    on public.watch_records (user_id, status, updated_at desc);

-- ── episode_watch_status ───────────────────────────────────────────────────
-- Row presence = watched. TMDB show id + season/episode number is the
-- identity — no local library row needed (replaces the old libraryId concept).
create table if not exists public.episode_watch_status (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users (id) on delete cascade,
    show_tmdb_id   integer not null,
    season_number  integer not null,
    episode_number integer not null,
    watched_at     timestamptz not null default now()
);

create unique index if not exists idx_episode_watch_status_unique
    on public.episode_watch_status (user_id, show_tmdb_id, season_number, episode_number);
create index if not exists idx_episode_watch_status_show
    on public.episode_watch_status (user_id, show_tmdb_id);

-- ── watch_log ──────────────────────────────────────────────────────────────
-- One row per "mark watched" event — feeds the Stats 7-day chart and
-- week/month totals. minutes is estimated from runtime/episode duration
-- (no real playback telemetry exists either way).
create table if not exists public.watch_log (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    tmdb_id     integer not null,
    media_type  text not null check (media_type in ('movie', 'series')),
    minutes     integer not null default 0,
    logged_at   timestamptz not null default now()
);

create index if not exists idx_watch_log_user_logged_at
    on public.watch_log (user_id, logged_at desc);

-- ── RLS: single-owner, enabled on every table ────────────────────────────────
alter table public.user_lists enable row level security;
alter table public.user_list_items enable row level security;
alter table public.watch_records enable row level security;
alter table public.episode_watch_status enable row level security;
alter table public.watch_log enable row level security;

drop policy if exists "user_lists_own" on public.user_lists;
create policy "user_lists_own" on public.user_lists
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_list_items_own" on public.user_list_items;
create policy "user_list_items_own" on public.user_list_items
    for all using (
        exists (select 1 from public.user_lists l where l.id = list_id and l.user_id = auth.uid())
    ) with check (
        exists (select 1 from public.user_lists l where l.id = list_id and l.user_id = auth.uid())
    );

drop policy if exists "watch_records_own" on public.watch_records;
create policy "watch_records_own" on public.watch_records
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "episode_watch_status_own" on public.episode_watch_status;
create policy "episode_watch_status_own" on public.episode_watch_status
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "watch_log_own" on public.watch_log;
create policy "watch_log_own" on public.watch_log
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
