-- Run this in Supabase Dashboard -> SQL Editor (after 0000, 0001, 0002).
-- Safe to re-run: every step is idempotent.
--
-- Found once 0000_initial_schema.sql was available: two "_update_own" RLS
-- policies only check row ownership, not which columns changed, the same
-- class of bug fixed for profiles.points in 0002 — but these two are worse.

-- 1) profiles: block self role / is_active escalation ------------------------
-- profiles_update_own (0000) lets a user update every column of their own
-- row, including `role` and `is_active` -- exactly the columns is_admin()/
-- is_super_admin() check. Right now any signed-in user can run
-- supabase.from('profiles').update({ role: 'super_admin' }) on themselves
-- and instantly unlock every *_admin_manage / *_admin_all policy in the
-- whole schema (manage all venues, facilities, payments, rewards, other
-- users' profiles, etc). Extend the 0002 guard to cover these columns too.
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

  if new.role is distinct from old.role then
    raise exception 'role cannot be modified directly';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'is_active cannot be modified directly';
  end if;

  return new;
end;
$$;

-- (trigger already created in 0002; replacing the function is enough)

-- 2) bookings: block self-approval / self-payment fraud -----------------------
-- bookings_update_own (0000) lets the booking's owner update every column
-- of their own row, including `status`, `payment_status`, and
-- `total_amount`. Right now a user can call
-- supabase.from('bookings').update({ status: 'confirmed', payment_status:
-- 'approved', total_amount: 0 }) on their own pending booking and get a
-- free, self-approved court booking with no staff review.
create or replace function public.protect_booking_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' or public.is_admin() then
    return new;
  end if;

  if new.status is distinct from old.status then
    raise exception 'booking status cannot be modified directly';
  end if;

  if new.payment_status is distinct from old.payment_status then
    raise exception 'payment status cannot be modified directly';
  end if;

  if new.total_amount is distinct from old.total_amount then
    raise exception 'total_amount cannot be modified directly';
  end if;

  return new;
end;
$$;

drop trigger if exists protect_booking_privileged_columns on public.bookings;
create trigger protect_booking_privileged_columns
before update on public.bookings
for each row execute function public.protect_booking_privileged_columns();
