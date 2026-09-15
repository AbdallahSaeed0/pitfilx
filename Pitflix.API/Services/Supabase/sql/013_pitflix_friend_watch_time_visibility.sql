-- Extends the friends-visibility started in 011 to `watch_log` and
-- `episode_watch_status` — lets Friend Profile show the exact same three
-- stat cards (TV Time, Episodes, Movies) as a user's own Profile, instead of
-- a narrower "Movies Seen / Series Tracked" pair. This was originally left
-- private (011's notes called out minute-by-minute watch history as more
-- personal than just "what did they watch"), but per-user decision this
-- account wants full parity for friends.
--
-- Same additive, read-only pattern as 011: adds SELECT policies for friends
-- on top of 003's existing owner-only `for all` policies — write access
-- stays owner-only throughout.
--
-- Requires 002 (public.friendships) and 003 (the tables below). Idempotent,
-- same pattern as every other migration here.

drop policy if exists "watch_log_select_friend" on public.watch_log;
create policy "watch_log_select_friend" on public.watch_log
    for select using (
        exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = watch_log.user_id)
               or (f.friend_id = auth.uid() and f.user_id = watch_log.user_id)
        )
    );

drop policy if exists "episode_watch_status_select_friend" on public.episode_watch_status;
create policy "episode_watch_status_select_friend" on public.episode_watch_status
    for select using (
        exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = episode_watch_status.user_id)
               or (f.friend_id = auth.uid() and f.user_id = episode_watch_status.user_id)
        )
    );
