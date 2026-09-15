// ทุก hook ในไฟล์นี้ทำหน้าที่เดียว: ผูก query เข้ากับ user ที่ล็อกอินอยู่
// แล้วโยนงานจัดการ loading/error ให้ useAsyncData — key เป็น null ตอนยังไม่
// ล็อกอิน จึงไม่มีการยิง query ของผู้ใช้ที่ไม่มีตัวตน
import { useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import { useAsyncData } from "./useAsyncData";
import {
  BOOKING_PAGE_SIZE,
  DEFAULT_ADVANCE_DAYS,
  addDaysISO,
  fetchMyBookingWindow,
  fetchNextBooking,
  fetchUnpaidBookingCount,
  fetchUnpaidBookings,
  fetchUserBookings,
  subscribeToBookingChanges,
  todayISO,
} from "../lib/bookings";

const EMPTY_LIST = [];
const EMPTY_PAGE = { bookings: EMPTY_LIST, hasMore: false };

export function useUserBookings(limit = BOOKING_PAGE_SIZE) {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, loading, error } = useAsyncData(
    () => fetchUserBookings(userId, limit),
    userId ? `bookings:${userId}:${limit}` : null,
    EMPTY_PAGE
  );

  return { bookings: data.bookings, hasMore: data.hasMore, loading, error };
}

// จองล่วงหน้าได้ถึงวันไหน — ผูกกับ user เพราะสิทธิ์จองล่วงหน้าเป็นของรายคน
// (0055) ค่าเริ่มต้นแคบไว้ก่อนระหว่างรอโหลด ปฏิทินจะขยายเองเมื่อค่าจริงมาถึง
const fallbackWindow = () => ({
  baseDays: DEFAULT_ADVANCE_DAYS,
  bonusDays: 0,
  totalDays: DEFAULT_ADVANCE_DAYS,
  lastDate: addDaysISO(todayISO(), DEFAULT_ADVANCE_DAYS),
  bonusUntil: null,
});

export function useBookingWindow() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, loading } = useAsyncData(
    fetchMyBookingWindow,
    userId ? `booking-window:${userId}` : null,
    fallbackWindow(),
  );

  return { window: data ?? fallbackWindow(), loading };
}

// จำนวนการจองที่รอชำระเงิน — ใช้เป็นป้ายเตือนบนเมนู "ประวัติการจอง" ของ
// AppHeader คำนวณสดทุกครั้งที่ component นี้ mount (เช่น ตอนเปลี่ยนหน้า)
export function useUnpaidBookingCount() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data } = useAsyncData(
    () => fetchUnpaidBookingCount(userId),
    userId ? `unpaid-bookings:${userId}` : null,
    0,
  );

  return data ?? 0;
}

// รายการย่อของการจองที่รอชำระเงิน — ใช้โชว์เป็นการ์ดเตือนในกระดิ่งแจ้งเตือน
// (NotificationBell) คู่กับ useUnpaidBookingCount ด้านบน
export function useUnpaidBookings(limit = 3) {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, loading } = useAsyncData(
    () => fetchUnpaidBookings(userId, limit),
    userId ? `unpaid-bookings-list:${userId}:${limit}` : null,
    EMPTY_LIST,
  );

  return { bookings: data, loading };
}

// นับรอบทุกครั้งที่การจองของ user นี้เปลี่ยน (เช่น แอดมินอนุมัติ/ปฏิเสธการ
// ชำระเงิน) เข้ามาทาง Realtime — ผสมกับ key ให้ useAsyncData ยิง fetch ใหม่เอง
// เหมือน useNotificationsTick ใน useNotifications.js
function useNextBookingTick(userId) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!userId) return undefined;
    return subscribeToBookingChanges(userId, () => setTick((value) => value + 1));
  }, [userId]);

  return tick;
}

export function useNextBooking() {
  const { user } = useAuth();
  const userId = user?.id;
  const tick = useNextBookingTick(userId);

  const { data, loading, error } = useAsyncData(
    () => fetchNextBooking(userId),
    userId ? `next-booking:${userId}:${tick}` : null,
    null,
    { keepPreviousData: true }
  );

  return { booking: data, loading, error };
}
