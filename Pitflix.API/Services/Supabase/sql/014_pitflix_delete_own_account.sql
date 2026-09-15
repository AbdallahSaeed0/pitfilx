-- Lets the mobile app offer real self-service "Delete Account" (Settings) —
-- Supabase Auth has no client-callable "delete my own account" method (only
-- an admin API, which requires the service-role key and so can't be called
-- from the app itself). This adds a `security definer` RPC that runs with
-- elevated privileges but only ever deletes the CALLING user's own row
-- (`auth.uid()`, not an arbitrary id) — there is no way to pass in someone
-- else's id.
--
-- Deleting the `auth.users` row cascades through every table that
-- references it `on delete cascade` (002's profiles/friendships/
-- activity_events/etc., 003's user_lists/watch_records/episode_watch_status/
-- watch_log, and every migration since) — one delete removes the account's
-- entire footprint across this schema. Storage objects (avatar/cover images
-- in the `profile-images` bucket) are NOT covered by this cascade — Storage
-- rows aren't foreign-keyed to auth.users — and are left behind as orphaned
-- objects; harmless (no longer publicly linked from anywhere once the
-- profile row is gone) but worth knowing if that bucket ever needs a manual
-- cleanup pass.
--
-- Requires 002 (public.profiles) and 003 (the per-account library tables) to
-- already have their cascade FKs in place — both do. Idempotent (`create or
-- replace function`), same pattern as every other migration here.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_own_account() to authenticated;
