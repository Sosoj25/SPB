-- Run this in Supabase Dashboard -> SQL Editor.
-- Safe to re-run: every step is idempotent (IF NOT EXISTS / DROP ... IF EXISTS / ON CONFLICT).

-- 1) Extra profile columns -------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists avatar_url text,
  add column if not exists bio text,
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- 2) Row Level Security on profiles ----------------------------------------
-- Only lets a user read/update their own row. If a later feature needs to
-- show OTHER users' profiles (leaderboards, reviews, community posts), add a
-- broader select policy then -- this one intentionally stays narrow for now.
alter table public.profiles enable row level security;

drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
on public.profiles for select
using ( auth.uid() = id );

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using ( auth.uid() = id )
with check ( auth.uid() = id );

-- 3) Avatar storage bucket ---------------------------------------------------
-- Public read (avatars are meant to be displayed), writes restricted to a
-- user's own folder: avatars/<user_id>/<filename>.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
on storage.objects for select
using ( bucket_id = 'avatars' );

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
on storage.objects for update
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
on storage.objects for delete
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);
