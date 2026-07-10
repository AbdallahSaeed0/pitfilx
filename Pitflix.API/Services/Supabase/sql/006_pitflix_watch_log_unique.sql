-- Unique constraint on watch_log so the desktop push (MobileAccountSyncService)
-- can upsert per-completion rows instead of inserting a fresh duplicate every
-- 5-minute sync cycle. logged_at is set to the item's real completion
-- timestamp (Movie.CompletedAt / Episode.CompletedAt) by the push, not
-- "now" — so the same completion always maps to the same row.
--
-- Safe to run after 003_pitflix_user_library_schema.sql. Idempotent.

create unique index if not exists idx_watch_log_unique
    on public.watch_log (user_id, tmdb_id, media_type, logged_at);
