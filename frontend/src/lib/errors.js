const GENERIC = "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";

const THAI_LETTERS = /[฀-๿]/;

// RPC ใน 0009_booking_flow_rpcs.sql raise ข้อความภาษาไทยที่เขียนให้ผู้ใช้อ่าน
// โดยตรง (เช่น "ช่วงเวลานี้เพิ่งถูกจองไปแล้ว") ซึ่ง supabase-js ส่งกลับมาที่
// error.message ตรง ๆ — ข้อความพวกนี้ควรโชว์
//
// ส่วน error ที่เหลือเป็นภาษาอังกฤษระดับระบบ ("Failed to fetch",
// "new row violates row-level security policy") ซึ่งบอกอะไรผู้ใช้ไม่ได้
// และบางอันบอกโครงสร้างตารางออกไปด้วย จึงกลืนเป็นข้อความกลางแทน
export function errorMessage(err, fallback = GENERIC) {
  const message = err?.message ?? "";
  return THAI_LETTERS.test(message) ? message : fallback;
}
