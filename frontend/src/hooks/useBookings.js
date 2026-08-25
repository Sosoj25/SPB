import { useAuth } from "../context/useAuth";
import { useAsyncData } from "./useAsyncData";
import { BOOKING_PAGE_SIZE, fetchNextBooking, fetchUserBookings } from "../lib/bookings";

const EMPTY_LIST = [];
const EMPTY_PAGE = { bookings: EMPTY_LIST, hasMore: false };

// ทั้งสอง hook นี้เคยมี logic loading/error เป็นของตัวเองซ้ำกับ useAsyncData
// (คนละไฟล์ pattern เดียวกันเป๊ะ) ตอนนี้เหลือหน้าที่เดียวคือผูก query
// เข้ากับ user ที่ล็อกอินอยู่ แล้วโยนงานจัดการสถานะให้ useAsyncData

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

export function useNextBooking() {
  const { user } = useAuth();
  const userId = user?.id;

  const { data, loading, error } = useAsyncData(
    () => fetchNextBooking(userId),
    userId ? `next-booking:${userId}` : null
  );

  return { booking: data, loading, error };
}
