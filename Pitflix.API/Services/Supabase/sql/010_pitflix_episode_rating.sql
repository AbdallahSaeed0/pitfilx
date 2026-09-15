-- Per-episode rating
--
-- The mobile app's episode popup already had a star-rating control, but
-- nothing persisted the value — it only ever got posted into the social
-- activity feed (a fire-and-forget log entry), never stored back onto the
-- episode itself, so there was no durable way to ask "has this episode been
-- rated yet?" This adds the column episode_watch_status was missing, needed
-- for the "you just watched this — wanna rate it?" notification feature
-- (UserLibraryService.fetchPendingRatePrompts).
--
-- Safe to run after 003_pitflix_user_library_schema.sql. Idempotent.

alter table public.episode_watch_status
    add column if not exists rating smallint check (rating between 1 and 5);
