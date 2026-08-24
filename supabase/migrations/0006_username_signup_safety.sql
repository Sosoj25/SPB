-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0005).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: ชื่อผู้ใช้ซ้ำ = สมัครสมาชิกไม่ได้ พร้อม error 500 ที่อ่านไม่รู้เรื่อง
-- ============================================================
-- handle_new_user() (0000) insert เข้า public.profiles โดยตรง และ
-- profiles.username เป็น unique + มี check ว่าต้องยาว >= 3 ตัว
--
-- trigger ตัวนี้ทำงานอยู่ใน transaction เดียวกับการ insert เข้า auth.users
-- ถ้า insert profiles ล้ม (ชื่อซ้ำ / ชื่อสั้นเกินไป) ทั้ง transaction จะ rollback
-- แปลว่า "สมัครไม่สำเร็จเลย" และผู้ใช้เห็นแค่ Database error saving new user
-- ทั้งที่ปัญหาจริงคือแค่ชื่อผู้ใช้ซ้ำ
--
-- Register.jsx ก็ตรวจแค่ว่าช่องชื่อผู้ใช้ไม่ว่าง จึงไม่กันอะไรไว้เลยทั้งสองชั้น

-- 1) RPC ให้หน้าเว็บเช็คชื่อซ้ำก่อนกดสมัคร -----------------------------------
-- anon อ่านตาราง profiles ตรงๆ ไม่ได้ (profiles_select_own จำกัดไว้ที่แถวตัวเอง)
-- จึงต้องผ่าน security definer เหมือน get_email_by_username
-- คืนค่าแค่ boolean ไม่เปิดเผยว่าใครเป็นเจ้าของชื่อนั้น
drop function if exists public.is_username_available(text);

create function public.is_username_available(p_username text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select not exists (
    select 1
    from public.profiles
    where lower(username) = lower(trim(p_username))
  );
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;


-- 2) กันชนฝั่ง trigger ------------------------------------------------------
-- การเช็คในข้อ 1 ยังมีช่องว่างระหว่าง "เช็คแล้วว่าง" กับ "insert จริง"
-- (สองคนสมัครชื่อเดียวกันพร้อมกัน) ชั้นนี้จึงต้องไม่ล้มเด็ดขาด
-- ปรับให้ handle_new_user แก้ชื่อให้อัตโนมัติแทนที่จะทำให้สมัครไม่สำเร็จ
create or replace function public.handle_new_user()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
    requested_username text;
    final_username text;
begin

    requested_username := coalesce(
        nullif(trim(new.raw_user_meta_data->>'username'), ''),
        'user_' || substr(new.id::text, 1, 8)
    );

    -- username มาจาก metadata ฝั่ง client จึงยาวเท่าไหร่ก็ได้
    -- ต้องตัดให้พอดี varchar(50) ไม่งั้น insert ล้มด้วยเหตุผลเดียวกัน
    requested_username := left(requested_username, 50);

    -- สั้นกว่า 3 ตัวจะติด profiles_username_length
    if char_length(requested_username) < 3 then
        requested_username := 'user_' || substr(new.id::text, 1, 8);
    end if;

    final_username := requested_username;

    -- ชื่อซ้ำ: ต่อท้ายด้วยชิ้นส่วนของ user id ให้ไม่ซ้ำแน่นอน
    -- ตัดเหลือ 40 + '_' + 8 = 49 ตัว ยังอยู่ใน varchar(50)
    if exists (
        select 1 from public.profiles
        where lower(username) = lower(final_username)
    ) then
        final_username := left(requested_username, 40)
                          || '_' || substr(new.id::text, 1, 8);
    end if;

    insert into public.profiles (
        id,
        username,
        full_name
    )
    values (
        new.id,
        final_username,
        new.raw_user_meta_data->>'full_name'
    )
    on conflict (id) do nothing;

    return new;

end;
$$;

-- (trigger on_auth_user_created ถูกสร้างไว้แล้วใน 0000 — replace function พอ)
