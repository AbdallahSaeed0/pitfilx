-- Pitflix mobile social schema (friends, activity, comments, likes)
--
-- One-time setup for the Supabase project's social graph. Independent of
-- 001_pitflix_mobile_sync_schema.sql (desktop's lists/watch_events sync) —
-- the desktop app never reads or writes these tables.
--
-- Unlike 001 (no-auth phase, RLS disabled), this schema requires Supabase
-- Auth (email/password) to be enabled, since every table is keyed off
-- auth.uid() and RLS is enforced per-row.
--
-- Schema-only: no Flutter/backend code calls this yet. It's written and
-- reviewed but not wired up — a future round rewires FriendsStore, the
-- activity feed, and comments/likes to call this instead of in-memory mocks.

create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── profiles ───────────────────────────────────────────────────────────────
-- One row per authenticated user, auto-created on signup (see trigger below).
create table if not exists public.profiles (
    id            uuid primary key references auth.users (id) on delete cascade,
    username      text unique,
    display_name  text,
    avatar_url    text,
    cover_url     text,
    bio           text,
    created_at    timestamptz not null default now()
);

-- Auto-create a profile row whenever a new user signs up via Supabase Auth.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, username)
    values (new.id, split_part(new.email, '@', 1));
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ── friend_requests ────────────────────────────────────────────────────────
create table if not exists public.friend_requests (
    id            uuid primary key default gen_random_uuid(),
    sender_id     uuid not null references public.profiles (id) on delete cascade,
    receiver_id   uuid not null references public.profiles (id) on delete cascade,
    status        text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at    timestamptz not null default now(),
    responded_at  timestamptz,
    check (sender_id <> receiver_id)
);

create unique index if not exists idx_friend_requests_unique on public.friend_requests (sender_id, receiver_id);
create index if not exists idx_friend_requests_receiver on public.friend_requests (receiver_id, status);

-- ── friendships ────────────────────────────────────────────────────────────
-- One row per accepted friendship. user_id < friend_id avoids duplicate /
-- reversed rows — always query with `where user_id = me or friend_id = me`.
create table if not exists public.friendships (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles (id) on delete cascade,
    friend_id   uuid not null references public.profiles (id) on delete cascade,
    created_at  timestamptz not null default now(),
    check (user_id < friend_id)
);

create unique index if not exists idx_friendships_unique on public.friendships (user_id, friend_id);
create index if not exists idx_friendships_friend_id on public.friendships (friend_id);

-- Atomically accept a friend request: insert the friendship row + mark the
-- request accepted, so the client makes one call instead of a racy
-- insert-then-update pair.
create or replace function public.accept_friend_request(request_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
    req record;
    lo uuid;
    hi uuid;
begin
    select * into req from public.friend_requests where id = request_id and receiver_id = auth.uid() and status = 'pending';
    if not found then
        raise exception 'Friend request not found or not actionable';
    end if;

    if req.sender_id < req.receiver_id then
        lo := req.sender_id;
        hi := req.receiver_id;
    else
        lo := req.receiver_id;
        hi := req.sender_id;
    end if;

    insert into public.friendships (user_id, friend_id) values (lo, hi)
    on conflict (user_id, friend_id) do nothing;

    update public.friend_requests
    set status = 'accepted', responded_at = now()
    where id = request_id;
end;
$$;

-- ── activity_events ────────────────────────────────────────────────────────
create table if not exists public.activity_events (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.profiles (id) on delete cascade,
    action       text not null check (action in ('watched', 'rated', 'added_to_watchlist')),
    tmdb_id      integer not null,
    media_type   text not null,
    title        text,
    poster_path  text,
    rating       smallint check (rating between 1 and 5),
    created_at   timestamptz not null default now()
);

create index if not exists idx_activity_events_user_created on public.activity_events (user_id, created_at desc);

-- ── activity_likes ─────────────────────────────────────────────────────────
create table if not exists public.activity_likes (
    id           uuid primary key default gen_random_uuid(),
    activity_id  uuid not null references public.activity_events (id) on delete cascade,
    user_id      uuid not null references public.profiles (id) on delete cascade,
    created_at   timestamptz not null default now()
);

create unique index if not exists idx_activity_likes_unique on public.activity_likes (activity_id, user_id);

-- ── activity_comments ──────────────────────────────────────────────────────
create table if not exists public.activity_comments (
    id           uuid primary key default gen_random_uuid(),
    activity_id  uuid not null references public.activity_events (id) on delete cascade,
    user_id      uuid not null references public.profiles (id) on delete cascade,
    body         text not null check (char_length(body) between 1 and 1000),
    created_at   timestamptz not null default now()
);

create index if not exists idx_activity_comments_activity on public.activity_comments (activity_id, created_at);

-- ── RLS: enabled, keyed off auth.uid() ───────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.activity_events enable row level security;
alter table public.activity_likes enable row level security;
alter table public.activity_comments enable row level security;

-- profiles: any authenticated user can view; only the owner can edit.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles
    for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
    for update using (auth.uid() = id);

-- friend_requests: sender or receiver can view/cancel; only the receiver can
-- respond (accept goes through the accept_friend_request() RPC instead).
drop policy if exists "friend_requests_select_own" on public.friend_requests;
create policy "friend_requests_select_own" on public.friend_requests
    for select using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "friend_requests_insert_own" on public.friend_requests;
create policy "friend_requests_insert_own" on public.friend_requests
    for insert with check (auth.uid() = sender_id);

drop policy if exists "friend_requests_update_receiver" on public.friend_requests;
create policy "friend_requests_update_receiver" on public.friend_requests
    for update using (auth.uid() = receiver_id);

drop policy if exists "friend_requests_delete_own" on public.friend_requests;
create policy "friend_requests_delete_own" on public.friend_requests
    for delete using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- friendships: either side can view; direct insert is blocked (only the
-- security-definer accept_friend_request() RPC writes rows).
drop policy if exists "friendships_select_own" on public.friendships;
create policy "friendships_select_own" on public.friendships
    for select using (auth.uid() = user_id or auth.uid() = friend_id);

-- activity_events: visible to the author and their friends; only the author
-- can insert their own events.
drop policy if exists "activity_events_select_own_or_friend" on public.activity_events;
create policy "activity_events_select_own_or_friend" on public.activity_events
    for select using (
        auth.uid() = user_id
        or exists (
            select 1 from public.friendships f
            where (f.user_id = auth.uid() and f.friend_id = activity_events.user_id)
               or (f.friend_id = auth.uid() and f.user_id = activity_events.user_id)
        )
    );

drop policy if exists "activity_events_insert_own" on public.activity_events;
create policy "activity_events_insert_own" on public.activity_events
    for insert with check (auth.uid() = user_id);

-- activity_likes / activity_comments: visible to anyone who can see the
-- parent activity; only the author can insert/delete their own row.
drop policy if exists "activity_likes_select_visible" on public.activity_likes;
create policy "activity_likes_select_visible" on public.activity_likes
    for select using (
        exists (select 1 from public.activity_events e where e.id = activity_id)
    );

drop policy if exists "activity_likes_insert_own" on public.activity_likes;
create policy "activity_likes_insert_own" on public.activity_likes
    for insert with check (auth.uid() = user_id);

drop policy if exists "activity_likes_delete_own" on public.activity_likes;
create policy "activity_likes_delete_own" on public.activity_likes
    for delete using (auth.uid() = user_id);

drop policy if exists "activity_comments_select_visible" on public.activity_comments;
create policy "activity_comments_select_visible" on public.activity_comments
    for select using (
        exists (select 1 from public.activity_events e where e.id = activity_id)
    );

drop policy if exists "activity_comments_insert_own" on public.activity_comments;
create policy "activity_comments_insert_own" on public.activity_comments
    for insert with check (auth.uid() = user_id);

drop policy if exists "activity_comments_delete_own" on public.activity_comments;
create policy "activity_comments_delete_own" on public.activity_comments
    for delete using (auth.uid() = user_id);
