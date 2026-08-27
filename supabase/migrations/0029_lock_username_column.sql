-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0028).
-- Safe to re-run: every step is idempotent.
--
-- Product request: users should not be able to change their own username
-- after signup. The frontend (ProfileEdit.jsx) now renders username as
-- read-only, but that's UI-only -- anyone can still call
--   supabase.from('profiles').update({ username: 'x' }).eq('id', <self>)
-- directly through the REST API, same class of bug fixed for
-- role/points/is_active in 0003/0017. Extend the same trigger to cover
-- username too, keeping the existing service_role / is_admin() bypass so
-- staff can still correct an inappropriate username via the admin tools.

create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_super_admin() then
    raise exception 'role cannot be modified directly';
  end if;

  if not public.is_admin() then
    if new.points is distinct from old.points then
      raise exception 'points cannot be modified directly';
    end if;

    if new.is_active is distinct from old.is_active then
      raise exception 'is_active cannot be modified directly';
    end if;

    if new.username is distinct from old.username then
      raise exception 'username cannot be modified directly';
    end if;
  end if;

  return new;
end;
$function$;

-- (trigger + grants already set up in 0002/0003/0017; replacing the
-- function body is enough, no need to recreate the trigger or grants)
