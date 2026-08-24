-- Run this in Supabase Dashboard -> SQL Editor (after 0000, 0001).
-- Safe to re-run: every step is idempotent.

-- 1) Loyalty points column ---------------------------------------------------
-- Declared here defensively in case it isn't already tracked in migrations.
alter table public.profiles
  add column if not exists points integer not null default 0;

-- 2) Lock "points" against direct client writes ------------------------------
-- profiles_update_own / "Users can update own profile" (0000/0001) only
-- check *row* ownership (auth.uid() = id), not *which columns* changed.
-- That means any signed-in user can currently call
-- supabase.from('profiles').update({points: 999999}) on their own row and
-- it will succeed. This trigger blocks changes to points unless the request
-- comes from service_role (e.g. a rewards RPC run with the service key) or
-- an admin managing the profile through profiles_admin_all (0000).
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.points is distinct from old.points then
    raise exception 'points cannot be modified directly';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_profile_privileged_columns on public.profiles;
create trigger protect_profile_privileged_columns
before update on public.profiles
for each row execute function public.protect_profile_privileged_columns();

-- 3) Restrict avatar uploads by size/type -------------------------------------
-- Client only hints accept="image/*" (trivially bypassed). Enforce it
-- server-side: 5MB max, common image types only.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'avatars';
