-- Per-account custom poster/backdrop selections, keyed by TMDB id — replaces
-- the old desktop-only "Change Poster/Backdrop" flow that required a title to
-- already be matched in the local scanned-media library (Movie/Show row with
-- a real FilePath/FolderPath). Mirrors episode_watch_status's approach in 003:
-- identity is (user_id, tmdb_id, media_type), no local library row needed.
--
-- Requires 003 (same auth/RLS pattern). Idempotent, safe to re-run.

create table if not exists public.user_title_customizations (
    id                    uuid primary key default gen_random_uuid(),
    user_id               uuid not null references auth.users (id) on delete cascade,
    tmdb_id               integer not null,
    media_type            text not null check (media_type in ('movie', 'series')),
    custom_poster_path    text,
    custom_backdrop_path  text,
    updated_at            timestamptz not null default now()
);

create unique index if not exists idx_user_title_customizations_unique
    on public.user_title_customizations (user_id, tmdb_id, media_type);

alter table public.user_title_customizations enable row level security;

drop policy if exists "user_title_customizations_own" on public.user_title_customizations;
create policy "user_title_customizations_own" on public.user_title_customizations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
