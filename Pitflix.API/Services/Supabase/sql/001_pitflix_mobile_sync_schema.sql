-- Pitflix ⇄ Mobile sync schema
--
-- This is a one-time setup script for the Supabase project used by the
-- Pitflix mobile-sync module. It is NOT run automatically by the desktop
-- app — paste it into the Supabase SQL editor (or run via `supabase db
-- push` / psql) once per project.
--
-- No-auth phase: RLS is disabled on all three tables so the desktop
-- service-role key (or an anon key with policies opened up) can read and
-- write freely. Revisit before shipping a public mobile client.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── lists ──────────────────────────────────────────────────────────────
create table if not exists public.lists (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    type        text not null check (type in ('watchlist', 'favorites', 'custom')),
    source      text not null default 'desktop' check (source in ('desktop', 'mobile')),
    created_at  timestamptz not null default now()
);

create index if not exists idx_lists_source_created_at on public.lists (source, created_at);

-- ── list_items ─────────────────────────────────────────────────────────
create table if not exists public.list_items (
    id          uuid primary key default gen_random_uuid(),
    list_id     uuid not null references public.lists (id) on delete cascade,
    tmdb_id     integer not null,
    media_type  text not null,
    added_at    timestamptz not null default now()
);

create index if not exists idx_list_items_list_id on public.list_items (list_id);
create index if not exists idx_list_items_added_at on public.list_items (added_at);
create unique index if not exists idx_list_items_unique on public.list_items (list_id, tmdb_id, media_type);

-- ── watch_events ───────────────────────────────────────────────────────
create table if not exists public.watch_events (
    id           uuid primary key default gen_random_uuid(),
    tmdb_id      integer not null,
    media_type   text not null,
    title        text,
    poster_path  text,
    watched_at   timestamptz not null default now(),
    rating       smallint check (rating between 1 and 5),
    source       text not null default 'desktop' check (source in ('desktop', 'mobile')),
    synced_at    timestamptz not null default now()
);

create index if not exists idx_watch_events_tmdb on public.watch_events (tmdb_id, media_type);
create index if not exists idx_watch_events_source_synced_at on public.watch_events (source, synced_at);

-- ── RLS: disabled for the no-auth phase ──────────────────────────────────
alter table public.lists disable row level security;
alter table public.list_items disable row level security;
alter table public.watch_events disable row level security;
