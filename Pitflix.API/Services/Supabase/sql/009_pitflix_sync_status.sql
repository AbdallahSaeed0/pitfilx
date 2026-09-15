-- Lets the mobile app show a real "desktop sync connected" status, backed by
-- Supabase instead of a local-network ping (see 008's decoupling — this
-- schema continues that: no LAN/IP dependency, works over plain internet).
--
-- One row per account, upserted by the desktop's MobileAccountSyncService
-- after every successful push (every 5 minutes, or "Sync Now"/on-link). The
-- mobile app reads `last_synced_at` and derives Connected/Stale/Never Linked
-- from how recent it is — there's no separate "linked" boolean here because
-- that's inherently the same fact: a linked-but-never-successfully-synced
-- account has never gotten a row at all.
--
-- Requires 003 (same auth/RLS pattern). Idempotent, safe to re-run.

create table if not exists public.user_sync_status (
    user_id         uuid primary key references auth.users (id) on delete cascade,
    last_synced_at  timestamptz not null,
    updated_at      timestamptz not null default now()
);

alter table public.user_sync_status enable row level security;

drop policy if exists "user_sync_status_own" on public.user_sync_status;
create policy "user_sync_status_own" on public.user_sync_status
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
