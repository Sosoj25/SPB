import { useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import { fetchNextBooking, fetchUserBookings } from "../lib/bookings";

const EMPTY_LIST = [];

// ครอบ query ของ bookings ให้เหลือ { data, loading, error } เหมือนกันทุกหน้า
// เพราะทั้ง Home และ Profile ต้องจัดการ 3 สถานะนี้เหมือนกันหมด
//
// ผลลัพธ์ถูกเก็บพร้อม userId ที่ยิงไป แล้วค่อยเทียบตอน render แทนที่จะ setState
// ตั้งต้นใน effect — user โผล่มาทีหลัง (AuthContext โหลด session แบบ async)
// วิธีนี้จึงกลับเป็นสถานะ "กำลังโหลด" ให้เองโดยไม่ต้อง render ซ้อนรอบพิเศษ
function useBookingQuery(fetcher, fallback) {
  const { user } = useAuth();
  const userId = user?.id;

  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!userId) return;

    let mounted = true;

    fetcher(userId)
      .then((data) => {
        if (mounted) setResult({ userId, data, error: "" });
      })
      .catch((err) => {
        console.error("Booking query error:", err);
        if (mounted) {
          setResult({ userId, data: fallback, error: "ไม่สามารถโหลดข้อมูลการจองได้" });
        }
      });

    return () => {
      mounted = false;
    };
  }, [userId, fetcher, fallback]);

  const settled = result?.userId === userId;

  return {
    data: settled ? result.data : fallback,
    loading: Boolean(userId) && !settled,
    error: settled ? result.error : "",
  };
}

export function useUserBookings() {
  const { data, loading, error } = useBookingQuery(fetchUserBookings, EMPTY_LIST);
  return { bookings: data, loading, error };
}

export function useNextBooking() {
  const { data, loading, error } = useBookingQuery(fetchNextBooking, null);
  return { booking: data, loading, error };
}
