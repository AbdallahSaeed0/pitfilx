-- Lets a friend's profile page show real "what have they watched" data
-- (movies/series watched, playlists) instead of nothing — 003's tables are
-- single-owner only (`user_id = auth.uid()`), so a friend's watch_records/
-- user_lists/user_list_items were previously invisible to anyone else, even
-- though 002's friendships/activity_events already establish "friends can
-- see each other's stuff" elsewhere in the app.
--
-- Adds read-only SELECT policies for friends, additive to 003's existing
-- `for all` owner policies (Postgres OR's multiple permissive policies for
-- the same command together) — write access remains owner-only throughout.
--
-- Requires 002 (public.friendships) and 003 (the tables below). Idempotent,
-- same pattern as every other migration here.

drop policy if exists "watch_records_select_friend" on public.watch_records;
create policy "watch_records_select_friend" on public.watch_records
    for select using (
        exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = watch_records.user_id)
               or (f.friend_id = auth.uid() and f.user_id = watch_records.user_id)
        )
    );

drop policy if exists "user_lists_select_friend" on public.user_lists;
create policy "user_lists_select_friend" on public.user_lists
    for select using (
        exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = user_lists.user_id)
               or (f.friend_id = auth.uid() and f.user_id = user_lists.user_id)
        )
    );

drop policy if exists "user_list_items_select_friend" on public.user_list_items;
create policy "user_list_items_select_friend" on public.user_list_items
    for select using (
        exists (
            select 1 from public.user_lists l
            join public.friendships f
              on (f.user_id = auth.uid() and f.friend_id = l.user_id)
              or (f.friend_id = auth.uid() and f.user_id = l.user_id)
            where l.id = user_list_items.list_id
        )
    );
