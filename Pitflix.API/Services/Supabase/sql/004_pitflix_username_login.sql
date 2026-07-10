-- Username login support
--
-- Supabase Auth only signs in by email — this RPC lets the Flutter app
-- resolve a `profiles.username` to its account email first, so Login can
-- accept either. `auth.users` isn't queryable directly by anon/authenticated
-- roles (by design), so this has to go through a security-definer function.
--
-- Safe to run after 002_pitflix_social_schema.sql (needs public.profiles).
-- Idempotent — safe to re-run.

create or replace function public.email_for_username(p_username text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
    v_email text;
begin
    select u.email into v_email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.username = p_username;
    return v_email;
end;
$$;

-- Callable by anyone (needed pre-login, before a session exists) — only
-- returns an email for a valid username, nothing else about the account.
grant execute on function public.email_for_username(text) to anon, authenticated;
