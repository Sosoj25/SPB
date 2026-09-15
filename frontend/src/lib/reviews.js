// รีวิวหลังใช้บริการ — อ่าน/ส่งรีวิวของการจองหนึ่งรายการ
import { supabase } from "./supabase";

// รีวิวผูกกับ booking_id แบบ unique (0000) — ต่อการจอง 1 รายการมีรีวิวได้แค่
// อันเดียว ใช้เช็คว่าเคยรีวิวไปแล้วหรือยังตอนเปิดหน้าใบเสร็จ
export async function fetchBookingReview(bookingId) {
  const { data, error } = await supabase
    .from("reviews")
    .select("id, rating, comment, created_at")
    .eq("booking_id", bookingId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// ส่งรีวิว — ต้องผ่าน RPC เพราะเป็นคนเดียวที่เลื่อนบุ๊กกิ้งจาก awaiting_review
// ไป completed ได้ (ดู submit_review() ใน 0074_review_submission_flow.sql)
//
// ตั้งแต่ 0106 RPC ตัวนี้เป็นจุดที่แจกแต้มด้วย และคืนยอดที่แจกจริงกลับมาแยก
// เป็นสองก้อน — หน้าใบเสร็จเอาไปขึ้นข้อความขอบคุณตามตัวเลขจริง ไม่ใช่คำนวณ
// เดาเองจากอัตรา (แต้มอาจถูกแจกไปแล้วรอบก่อน หรือแอดมินปิดระบบไว้)
export async function submitReview({ bookingId, rating, comment }) {
  const { data, error } = await supabase.rpc("submit_review", {
    p_booking_id: bookingId,
    p_rating: rating,
    p_comment: comment?.trim() || null,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    id: row?.review_id,
    rating: row?.review_rating,
    comment: row?.review_comment,
    createdAt: row?.review_created_at,
    // แต้มตามยอดที่จ่ายจริง
    servicePoints: row?.service_points ?? 0,
    // แต้มโบนัสของการเขียนรีวิว
    bonusPoints: row?.bonus_points ?? 0,
    pointsAwarded: row?.points_awarded ?? 0,
  };
}
