-- Per-episode rewatch count
--
-- The mobile app's episode popup ("Mark Rewatched") only ever mutated local
-- widget state — nothing persisted it, so it reset every time the screen
-- reloaded and Stats' "Rewatch Sessions" card (which sums this column) was
-- always 0. This adds the column episode_watch_status was missing.
--
-- Safe to run after 003_pitflix_user_library_schema.sql. Idempotent.

alter table public.episode_watch_status
    add column if not exists rewatch_count integer not null default 0;
