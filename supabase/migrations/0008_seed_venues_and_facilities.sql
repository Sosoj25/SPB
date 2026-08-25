-- Run this in Supabase Dashboard -> SQL Editor (after 0000..0007).
-- Safe to re-run: every step is idempotent.
--
-- ============================================================
-- ปัญหา: venues / facilities ว่างเปล่า หน้าจองเลยต้องฮาร์ดโค้ดทุกอย่าง
-- ============================================================
-- 0000 seed ไว้แค่ sports (6 แถว) กับ community_categories เท่านั้น
-- ทำให้ทั้งสาย sports -> venues -> facilities ที่หน้าจองต้องใช้
-- ยังไม่มีข้อมูลจริงให้ query แม้แต่แถวเดียว
--
-- ไฟล์นี้ใส่สนามตั้งต้นให้ระบบเดินได้ ครบทั้ง 6 กีฬาที่ seed ไว้แล้ว
-- (ภายหลังเมื่อมีหน้า Admin จัดการสนาม ข้อมูลชุดนี้จะกลายเป็นแค่ค่าเริ่มต้น)
--
-- ความ idempotent: venues ไม่มี unique key ที่ชื่อ (สาขาต่างที่ตั้งชื่อซ้ำกันได้)
-- จึงเช็คด้วย select ... where name = ... ก่อน insert แทนการ on conflict
-- ส่วน facilities มี constraint facilities_unique_name (venue_id, name) อยู่แล้ว

do $$
declare
  v_venue        bigint;
  s_football     bigint;
  s_futsal       bigint;
  s_basketball   bigint;
  s_badminton    bigint;
  s_tennis       bigint;
  s_volleyball   bigint;
begin

  select id into s_football   from public.sports where name = 'ฟุตบอล';
  select id into s_futsal     from public.sports where name = 'ฟุตซอล';
  select id into s_basketball from public.sports where name = 'บาสเกตบอล';
  select id into s_badminton  from public.sports where name = 'แบดมินตัน';
  select id into s_tennis     from public.sports where name = 'เทนนิส';
  select id into s_volleyball from public.sports where name = 'วอลเลย์บอล';

  if s_football is null then
    raise exception 'ยังไม่มีข้อมูลใน public.sports — ต้องรัน 0000_initial_schema.sql ก่อน';
  end if;


  -- ---------- 1) SPB Arena รามอินทรา ----------

  select id into v_venue from public.venues where name = 'SPB Arena รามอินทรา';

  if v_venue is null then
    insert into public.venues (
      name, description, address,
      latitude, longitude, phone,
      opening_time, closing_time
    )
    values (
      'SPB Arena รามอินทรา',
      'ศูนย์กีฬากลางแจ้งครบวงจร เน้นสนามฟุตบอลหญ้าเทียมมาตรฐาน มีไฟส่องสว่างทุกสนาม ที่จอดรถกว่า 120 คัน',
      '40 ถนนรามอินทรา แขวงอนุสาวรีย์ เขตบางเขน กรุงเทพมหานคร 10220',
      13.8712000, 100.6142000, '02-521-4400',
      '08:00', '23:00'
    )
    returning id into v_venue;
  end if;

  insert into public.facilities (venue_id, sport_id, name, description, capacity, price_per_hour)
  values
    (v_venue, s_football, 'สนามฟุตบอล 1',
     'สนามหญ้าเทียมสำหรับฟุตบอล 7 คน เหมาะกับการแข่งขันและฝึกซ้อม', 14, 450),
    (v_venue, s_football, 'สนามฟุตบอล 2',
     'สนามหญ้าเทียมให้เช่ารายชั่วโมง พร้อมห้องเปลี่ยนเสื้อผ้าและที่จอดรถ', 14, 420),
    (v_venue, s_football, 'สนามฟุตบอล 3',
     'สนามใหญ่สำหรับจัดการแข่งขัน 11 คน มีไฟส่องสว่างทั่วสนาม', 22, 900),
    (v_venue, s_football, 'สนามฟุตบอล 4',
     'สนามใหญ่สำหรับเล่นและฝึกซ้อม 11 คน มีไฟติดทั่วสนาม เล่นได้ถึงดึก', 22, 850),
    (v_venue, s_futsal, 'สนามฟุตซอล A',
     'สนามฟุตซอลพื้นยางในร่ม ไม่ต้องกังวลเรื่องฝน', 10, 350)
  on conflict on constraint facilities_unique_name do nothing;


  -- ---------- 2) SPB Sport Complex ลาดพร้าว ----------

  select id into v_venue from public.venues where name = 'SPB Sport Complex ลาดพร้าว';

  if v_venue is null then
    insert into public.venues (
      name, description, address,
      latitude, longitude, phone,
      opening_time, closing_time
    )
    values (
      'SPB Sport Complex ลาดพร้าว',
      'คอมเพล็กซ์ในร่มติดแอร์ มีทั้งคอร์ตบาสเกตบอล แบดมินตัน และวอลเลย์บอล พร้อมอัฒจันทร์ผู้ชม',
      '1693 ถนนลาดพร้าว แขวงวังทองหลาง เขตวังทองหลาง กรุงเทพมหานคร 10310',
      13.7981000, 100.6021000, '02-934-7788',
      '07:00', '22:00'
    )
    returning id into v_venue;
  end if;

  insert into public.facilities (venue_id, sport_id, name, description, capacity, price_per_hour)
  values
    (v_venue, s_basketball, 'สนามบาสเกตบอล 1',
     'สนามมาตรฐาน FIBA 5x5 ในร่ม พื้นไม้ปาร์เกต์ พร้อมอัฒจันทร์', 10, 300),
    (v_venue, s_basketball, 'สนามบาสเกตบอล 2',
     'คอร์ต 3x3 กลางแจ้งใต้หลังคาโดม มีเครื่องเก็บลูกอัตโนมัติให้ยืม', 6, 220),
    (v_venue, s_badminton, 'คอร์ตแบดมินตัน 1',
     'คอร์ตในร่มพื้นยาง PU มาตรฐานแข่งขัน แสงไฟไม่แยงตา', 4, 180),
    (v_venue, s_badminton, 'คอร์ตแบดมินตัน 2',
     'คอร์ตในร่มพื้นยาง PU มาตรฐานแข่งขัน แสงไฟไม่แยงตา', 4, 180),
    (v_venue, s_badminton, 'คอร์ตแบดมินตัน 3',
     'คอร์ตมุมติดแอร์ ลมไม่รบกวนลูกขนไก่ เหมาะกับการซ้อมจริงจัง', 4, 200),
    (v_venue, s_volleyball, 'สนามวอลเลย์บอล 1',
     'สนามมาตรฐานสากลในร่ม มีที่นั่งผู้ชม ใช้จัดแข่งขันหรือฝึกซ้อมได้', 12, 250)
  on conflict on constraint facilities_unique_name do nothing;


  -- ---------- 3) SPB Stadium บางนา ----------

  select id into v_venue from public.venues where name = 'SPB Stadium บางนา';

  if v_venue is null then
    insert into public.venues (
      name, description, address,
      latitude, longitude, phone,
      opening_time, closing_time
    )
    values (
      'SPB Stadium บางนา',
      'สนามเทนนิสและกีฬาชายหาดริมถนนบางนา-ตราด เปิดถึงดึก มีร้านอาหารและคาเฟ่ในบริเวณ',
      '589 ถนนบางนา-ตราด กม.3 แขวงบางนาเหนือ เขตบางนา กรุงเทพมหานคร 10260',
      13.6688000, 100.6412000, '02-361-9050',
      '09:00', '23:00'
    )
    returning id into v_venue;
  end if;

  insert into public.facilities (venue_id, sport_id, name, description, capacity, price_per_hour)
  values
    (v_venue, s_tennis, 'คอร์ตเทนนิส 1',
     'คอร์ตในร่มพื้นฮาร์ดคอร์ต มีเครื่องยิงลูกให้เช่าเพื่อฝึกซ้อม', 4, 250),
    (v_venue, s_tennis, 'คอร์ตเทนนิส 2',
     'คอร์ตกลางแจ้งมาตรฐานแข่งขัน มีไฟส่องสว่างเล่นได้ถึงดึก', 4, 200),
    (v_venue, s_futsal, 'สนามฟุตซอล B',
     'สนามฟุตซอลกลางแจ้งพื้นยาง มีตาข่ายกันลูกออกรอบสนาม', 10, 380),
    (v_venue, s_volleyball, 'สนามวอลเลย์บอล 2',
     'สนามวอลเลย์บอลชายหาด ทรายละเอียดนำเข้า พร้อมห้องอาบน้ำ', 8, 220)
  on conflict on constraint facilities_unique_name do nothing;

end;
$$;


-- ============================================================
-- คำอธิบายกีฬาสำหรับการ์ดบนหน้าเลือกกีฬา
-- ============================================================
-- 0000 seed sports.description ไว้เป็น "กีฬาฟุตบอล" / "กีฬาเทนนิส" ซึ่งเป็น
-- แค่คำจำกัดความซ้ำชื่อ ไม่ได้บอกผู้ใช้ว่าสนามที่นี่เป็นอย่างไร
-- อัปเดตเฉพาะแถวที่ยังเป็นข้อความตั้งต้น เพื่อไม่ทับของที่แอดมินแก้เองภายหลัง

update public.sports set description = case name
    when 'ฟุตบอล'     then 'สนามหญ้าเทียมมาตรฐาน ปรับให้เข้ากับสภาพอากาศไทย มีทั้งสนาม 7 คนและ 11 คน'
    when 'ฟุตซอล'     then 'สนามฟุตซอลพื้นยางทั้งในร่มและกลางแจ้ง เหมาะกับทีม 5 คน เล่นได้ทุกสภาพอากาศ'
    when 'บาสเกตบอล'  then 'สนามมาตรฐาน FIBA ทั้ง 5x5 และ 3x3 มีทั้งสเตเดียมและโดม พร้อมเครื่องเก็บลูกอัตโนมัติให้ยืม'
    when 'แบดมินตัน'  then 'คอร์ตในร่มพื้นยาง PU มาตรฐานแข่งขัน แสงไฟไม่แยงตา มีทั้งห้องแอร์และห้องพัดลม'
    when 'เทนนิส'     then 'คอร์ตในร่มและกลางแจ้งมาตรฐานแข่งขัน พร้อมเครื่องยิงลูกให้เช่าเพื่อฝึกซ้อม'
    when 'วอลเลย์บอล' then 'สนามมาตรฐานสากลในร่มและสนามชายหาด มีที่นั่งผู้ชม ใช้จัดแข่งขันหรือฝึกซ้อมได้'
  end
where name in ('ฟุตบอล', 'ฟุตซอล', 'บาสเกตบอล', 'แบดมินตัน', 'เทนนิส', 'วอลเลย์บอล')
  and description = 'กีฬา' || name;
