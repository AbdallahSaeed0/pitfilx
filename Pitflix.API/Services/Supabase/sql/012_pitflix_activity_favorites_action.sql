-- Adds 'added_to_favorites' as a distinct activity_events action — until now
-- adding a title to Favorites was logged as 'added_to_watchlist' (the same
-- action used for genuine Watch Later adds), which showed "Added to Watch
-- Later" in Activity/Friend Profile feeds for something the user actually
-- added to Favorites. Genuine Watch Later adds (via the "Add to List" sheet)
-- don't log activity at all yet — this migration only fixes the mislabeled
-- Favorites case; it doesn't add Watch Later logging.
--
-- Requires 002 (public.activity_events). Idempotent, same pattern as every
-- other migration here.

alter table public.activity_events drop constraint if exists activity_events_action_check;
alter table public.activity_events add constraint activity_events_action_check
    check (action in ('watched', 'rated', 'added_to_watchlist', 'added_to_favorites'));
