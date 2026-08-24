-- Run this in Supabase Dashboard -> SQL Editor (after 0000, 0001, 0002, 0003).
-- Safe to re-run: every step is idempotent.
--
-- Login.jsx and ForgotPasswordStep1.jsx both call
-- supabase.rpc('get_email_by_username', { p_username }) but no migration ever
-- created that function -- if it only ever existed as a hand-typed function in
-- the Dashboard it is not reproducible, and a fresh project (or a restore)
-- breaks login and password reset outright. This file is the source of truth.

-- The username -> email lookup has to read auth.users, which the anon role
-- cannot touch, so it runs as security definer. Note the tradeoff this design
-- carries: anyone who can reach the anon key can turn a guessed username into
-- the account's email address. That is inherent to "log in with a username but
-- authenticate with an email" on a client-only Supabase app -- removing it
-- would mean moving the login exchange into an Edge Function. Keeping the
-- exposure as small as possible instead: exact username match only, one row,
-- nothing but the email column comes back.

drop function if exists public.get_email_by_username(text);

create function public.get_email_by_username(p_username text)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username))
    -- a deactivated account should not be able to start a login or a reset
    and p.is_active = true
  limit 1;
$$;

-- PUBLIC includes every role; grant explicitly to the two that actually need it
-- (anon = login / forgot-password form, authenticated = already signed in).
revoke all on function public.get_email_by_username(text) from public;
grant execute on function public.get_email_by_username(text) to anon, authenticated;
