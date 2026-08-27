#!/usr/bin/env node
/**
 * ทดสอบ flow การจองทั้งเส้นกับ Supabase จริง ผ่าน REST API ชุดเดียวกับที่หน้าเว็บเรียก
 *
 *   npm run test:e2e -- <username หรือ email> <password>
 *
 * หรือกำหนดผ่าน environment variable:
 *   E2E_USER=Test1 E2E_PASSWORD=xxxx npm run test:e2e
 *
 * ตั้งใจไม่ใช้ test runner และไม่เพิ่ม dependency ใด ๆ — ใช้ fetch ที่ Node 18+
 * มีมาให้อยู่แล้ว จะได้ไม่ต้องแลกกับการเพิ่มเครื่องมือใหม่เข้าโปรเจกต์
 *
 * ข้อควรรู้: สคริปต์นี้เขียนลงฐานข้อมูลจริง มันสร้างการจองทดสอบแล้วยกเลิก
 * ให้เองทุกครั้ง แต่แถวที่ยกเลิกแล้วจะยังคาอยู่ในตาราง bookings
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// อ่านค่าจาก .env เองเพราะสคริปต์นี้รันนอก Vite (ไม่มี import.meta.env ให้ใช้)
function readEnv() {
  const env = {};

  for (const file of [".env", ".env.local"]) {
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }

    for (const line of text.split("\n")) {
      const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }

  return { ...env, ...process.env };
}

const env = readEnv();
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;

const [argUser, argPassword] = process.argv.slice(2);
const USER = argUser ?? env.E2E_USER;
const PASSWORD = argPassword ?? env.E2E_PASSWORD;

if (!URL || !KEY) {
  console.error("ไม่พบ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ใน frontend/.env");
  process.exit(1);
}

if (!USER || !PASSWORD) {
  console.error("ใช้: npm run test:e2e -- <username หรือ email> <password>");
  process.exit(1);
}

let token = null;
const passed = [];
const failed = [];

async function call(path, body, { method, auth = true } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (auth && token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(URL + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;

  return res.ok ? json : { __error__: json };
}

const errorOf = (res) => res?.__error__?.message ?? "";

function check(label, ok, detail = "") {
  (ok ? passed : failed).push(label);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  |  ${detail}` : ""}`);
}

function section(title) {
  console.log(`\n${"=".repeat(74)}\n${title}\n${"=".repeat(74)}`);
}

const isoDate = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

// --------------------------------------------------------------------------

section("0. เข้าสู่ระบบ");

// ผ่าน Edge Function เหมือนหน้า Login — การแปลง username เป็น email
// เกิดที่ฝั่ง server ทั้งหมด สคริปต์นี้ไม่เคยเห็นอีเมลของบัญชี
const login = await call(
  "/functions/v1/login-with-username",
  { username: USER, password: PASSWORD },
  { auth: false }
);

if (!login?.access_token) {
  check("เข้าสู่ระบบ", false, errorOf(login) || JSON.stringify(login));
  process.exit(1);
}

token = login.access_token;
const userId = login.user.id;
check("เข้าสู่ระบบ", true, USER);

check(
  "anon ขออีเมลจากชื่อผู้ใช้ไม่ได้",
  errorOf(
    await call("/rest/v1/rpc/get_email_by_username", { p_username: USER }, { auth: false })
  ).includes("permission denied")
);

check(
  "ชื่อผู้ใช้ไม่มีจริงกับรหัสผ่านผิด ตอบเหมือนกัน",
  errorOf(await call("/functions/v1/login-with-username",
    { username: USER, password: "wrong-on-purpose" }, { auth: false })) ===
  errorOf(await call("/functions/v1/login-with-username",
    { username: "ไม่มีบัญชีนี้จริง", password: "wrong-on-purpose" }, { auth: false }))
);

// --------------------------------------------------------------------------

section("1. เลือกกีฬา / เลือกสนาม");

const sports = await call(
  "/rest/v1/sports?select=id,name,facilities(id,price_per_hour,status)&is_active=eq.true&order=id"
);
const playable = sports.filter((s) => s.facilities.some((f) => f.status === "available"));
check("โหลดรายการกีฬา", playable.length > 0, `${playable.length} กีฬาที่มีสนามเปิด`);

const sport = playable[0];
const facilities = await call(
  `/rest/v1/facilities?select=id,name,price_per_hour,sports(id,name),` +
    `venues!inner(id,name,opening_time,closing_time)&sport_id=eq.${sport.id}` +
    `&status=eq.available&venues.status=eq.active&order=id`
);
check("โหลดรายการสนาม", facilities.length > 0, `${facilities.length} สนาม`);

const facility = facilities[0];
const date = isoDate(5);

const availability = await call("/rest/v1/rpc/sport_facility_availability", {
  p_sport_id: sport.id,
  p_date: date,
});
const dayInfo = availability.find((a) => a.facility_id === facility.id);
check("ความว่างรายสนาม", Boolean(dayInfo), `ว่าง ${dayInfo?.free_slots}/${dayInfo?.total_slots} ช่วง`);

// --------------------------------------------------------------------------

section(`2. เลือกช่วงเวลา (${date})`);

const slots = await call("/rest/v1/rpc/facility_slots", {
  p_facility_id: facility.id,
  p_date: date,
});
check("โหลดช่วงเวลาที่แอดมินเปิดไว้", slots.length > 0, `${slots.length} ช่วง`);

const free = slots.filter((s) => !s.is_booked);
check("มีช่วงว่างให้จอง", free.length > 0, `${free.length} ช่วง`);

if (!free.length) {
  console.log("\nหยุดการทดสอบ: ไม่มีช่วงว่าง");
  process.exit(1);
}

// --------------------------------------------------------------------------

section("3. สร้างการจอง");

const target = free[free.length - 1];
const booking = await call("/rest/v1/rpc/create_booking", { p_slot_id: target.slot_id });
const created = booking && !booking.__error__;
check(
  "create_booking",
  created,
  created
    ? `${booking.booking_code} ${booking.start_time}-${booking.end_time} = ${booking.total_amount}`
    : errorOf(booking)
);

if (!created) process.exit(1);

const hours =
  (Number(target.slot_end.slice(0, 2)) * 60 + Number(target.slot_end.slice(3, 5)) -
    Number(target.slot_start.slice(0, 2)) * 60 - Number(target.slot_start.slice(3, 5))) / 60;
const expected = Number(facility.price_per_hour) * hours;

check("ราคาคิดจาก server", Number(booking.total_amount) === expected,
  `${facility.price_per_hour} x ${hours} ชม.`);
check("เริ่มที่ pending / unpaid",
  booking.status === "pending" && booking.payment_status === "unpaid");

const afterBook = await call("/rest/v1/rpc/facility_slots", {
  p_facility_id: facility.id,
  p_date: date,
});
check("ช่วงเวลาถูกกันทันที",
  afterBook.find((s) => s.slot_id === target.slot_id)?.is_booked === true);

// --------------------------------------------------------------------------

section("4. ความปลอดภัย");

const id = booking.id;

check("ยืดเวลาเองไม่ได้",
  errorOf(await call(`/rest/v1/bookings?id=eq.${id}`, { end_time: "23:00" }, { method: "PATCH" }))
    .includes("ช่วงเวลา"));

check("ย้ายสนามเองไม่ได้",
  errorOf(await call(`/rest/v1/bookings?id=eq.${id}`,
    { facility_id: facilities[1].id }, { method: "PATCH" })).includes("ช่วงเวลา"));

check("แก้ยอดเงินเองไม่ได้",
  errorOf(await call(`/rest/v1/bookings?id=eq.${id}`, { total_amount: 0 }, { method: "PATCH" }))
    .includes("total_amount"));

check("ยืนยันการจ่ายให้ตัวเองไม่ได้",
  errorOf(await call(`/rest/v1/bookings?id=eq.${id}`,
    { payment_status: "paid" }, { method: "PATCH" })).includes("payment status"));

check("แทรกแถว payments เองไม่ได้",
  errorOf(await call("/rest/v1/payments", {
    booking_id: id, user_id: userId, amount: 1, payment_method: "qr", status: "paid",
  })).includes("row-level security"));

check("เปิดช่วงเวลาเองไม่ได้",
  errorOf(await call("/rest/v1/facility_time_slots", {
    facility_id: facility.id, slot_date: date, start_time: "02:00", end_time: "03:00",
  })).includes("row-level security"));

check("เรียก expire_unpaid_bookings ไม่ได้",
  errorOf(await call("/rest/v1/rpc/expire_unpaid_bookings", { p_minutes: 1 }))
    .includes("permission denied"));

check("เรียก complete_past_bookings ไม่ได้",
  errorOf(await call("/rest/v1/rpc/complete_past_bookings", {}))
    .includes("permission denied"));

check("ไม่ล็อกอินแล้วจองไม่ได้",
  errorOf(await call("/rest/v1/rpc/create_booking",
    { p_slot_id: target.slot_id }, { auth: false })).includes("permission denied"));

check("จองช่วงเดิมซ้ำไม่ได้",
  errorOf(await call("/rest/v1/rpc/create_booking", { p_slot_id: target.slot_id }))
    .includes("ถูกจองไปแล้ว"));

check("รีวิวสนามที่ยังไม่ได้ไปเล่นไม่ได้",
  errorOf(await call("/rest/v1/reviews", {
    booking_id: id, user_id: userId, facility_id: facility.id, rating: 5, comment: "e2e",
  })).includes("row-level security"));

check("แก้ note ของตัวเองได้",
  !(await call(`/rest/v1/bookings?id=eq.${id}`, { note: "e2e test" }, { method: "PATCH" }))
    ?.__error__);

// --------------------------------------------------------------------------

section("5. ชำระเงิน");

// pay_booking (จำลองเดิม) ถูกปิดไม่ให้ authenticated เรียกอีกต่อไปตั้งแต่
// 0023 — ระบบชำระเงินตอนนี้ต้องผ่านสองเส้นทางที่ตรวจสอบได้จริงเท่านั้น
check("pay_booking (จำลองเดิม) ถูกปิดใช้งานแล้ว",
  errorOf(await call("/rest/v1/rpc/pay_booking", { p_booking_id: id, p_method: "qr" }))
    .includes("permission denied"));

check("ไม่แนบสลิปชำระเงินไม่ได้",
  errorOf(await call("/rest/v1/rpc/submit_bank_transfer_payment",
    { p_booking_id: id, p_slip_path: "" })).includes("แนบสลิป"));

const submitted = await call("/rest/v1/rpc/submit_bank_transfer_payment", {
  p_booking_id: id,
  p_slip_path: `${userId}/${id}/e2e-test.jpg`,
});
check("submit_bank_transfer_payment", !submitted?.__error__,
  submitted?.__error__ ? errorOf(submitted) : submitted.status);

const afterSubmit = await call(
  `/rest/v1/bookings?id=eq.${id}&select=status,payment_status`
);
check("โอนเงิน+แนบสลิป -> รอตรวจสอบ (ไม่ยืนยันการจองให้เองทันที)",
  afterSubmit[0]?.payment_status === "pending" && afterSubmit[0]?.status === "pending");

const payments = await call(
  `/rest/v1/payments?select=amount,payment_method,status,gateway&booking_id=eq.${id}`
);
check("บันทึกแถว payments ผ่าน RPC",
  payments.length === 1 && Number(payments[0].amount) === expected
    && payments[0].status === "pending" && payments[0].gateway === "manual",
  payments[0] && `${payments[0].amount} / ${payments[0].payment_method} / ${payments[0].status}`);

// เส้นทางพร้อมเพย์: create_gateway_payment สร้างแถว pending ไว้เฉย ๆ
// ไม่แตะ bookings เลย (ต่างจากโอนเงินที่พา payment_status ไป pending ทันที)
// เพราะรอ webhook จาก Omise เป็นคนยืนยันจริง — ทดสอบแค่ว่าไม่พังและไม่แตะ
// booking เท่านั้น ไม่ยิงไป Omise จริงจากสคริปต์นี้
const gwPayment = await call("/rest/v1/rpc/create_gateway_payment", {
  p_booking_id: id,
  p_method: "qr",
});
check("create_gateway_payment สร้างแถว pending",
  !gwPayment?.__error__ && gwPayment.status === "pending" && gwPayment.gateway === "plernpay",
  gwPayment?.__error__ ? errorOf(gwPayment) : gwPayment.id);

const afterGw = await call(`/rest/v1/bookings?id=eq.${id}&select=payment_status`);
check("create_gateway_payment ไม่แตะ payment_status ของ booking",
  afterGw[0]?.payment_status === "pending");

check("เรียก confirm_gateway_payment เองไม่ได้ (service_role เท่านั้น)",
  errorOf(await call("/rest/v1/rpc/confirm_gateway_payment",
    { p_payment_id: gwPayment.id, p_charge_id: "chrg_test" })).includes("permission denied"));

check("เรียก fail_gateway_payment เองไม่ได้ (service_role เท่านั้น)",
  errorOf(await call("/rest/v1/rpc/fail_gateway_payment",
    { p_payment_id: gwPayment.id, p_charge_id: "chrg_test" })).includes("permission denied"));

// --------------------------------------------------------------------------

section("6. ใบเสร็จ / ประวัติ / สถิติหน้าแรก");

const detail = await call(
  `/rest/v1/bookings?select=booking_code,facilities(name,sports(name),venues(name,address))` +
    `&id=eq.${id}`
);
check("โหลดใบเสร็จได้ครบ", Boolean(detail[0]?.facilities?.venues?.address),
  `${detail[0]?.facilities?.sports?.name} · ${detail[0]?.facilities?.name}`);

const history = await call(
  `/rest/v1/bookings?select=id&user_id=eq.${userId}&order=booking_date.desc&limit=21`
);
check("เห็นประวัติการจองของตัวเอง", history.some((b) => b.id === id),
  `${history.length} รายการ`);

const stats = await call("/rest/v1/rpc/platform_stats", {});
const st = Array.isArray(stats) ? stats[0] : stats;
check("platform_stats คืนตัวเลขจริง", st?.facilities > 0 && st?.open_slots > 0,
  `สนาม ${st?.facilities} / ช่วงเปิดจอง ${st?.open_slots} / จองเดือนนี้ ${st?.bookings_this_month}`);

// --------------------------------------------------------------------------

section("7. ยกเลิกการจอง");

const cancelled = await call("/rest/v1/rpc/cancel_booking", { p_booking_id: id });
check("cancel_booking", cancelled?.status === "cancelled",
  cancelled?.status ?? errorOf(cancelled));

const afterCancel = await call("/rest/v1/rpc/facility_slots", {
  p_facility_id: facility.id,
  p_date: date,
});
check("ช่วงเวลาถูกปล่อยคืนทันที",
  afterCancel.find((s) => s.slot_id === target.slot_id)?.is_booked === false);

check("กดยกเลิกซ้ำไม่ error",
  !(await call("/rest/v1/rpc/cancel_booking", { p_booking_id: id }))?.__error__);

// --------------------------------------------------------------------------

console.log(`\n${"=".repeat(74)}`);
console.log(`สรุป: ผ่าน ${passed.length} / ${passed.length + failed.length}`);
if (failed.length) {
  console.log("ไม่ผ่าน:");
  failed.forEach((f) => console.log("  -", f));
}
console.log("=".repeat(74));

process.exit(failed.length ? 1 : 0);
