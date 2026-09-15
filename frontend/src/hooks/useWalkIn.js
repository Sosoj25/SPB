// หน้ารับลูกค้า Walk-in ที่เคาน์เตอร์ — เลือกกีฬา/สนาม/ช่วงเวลา ดูราคา
// และค้นหาสมาชิกเดิมด้วยเบอร์โทร
import { useAsyncData } from "./useAsyncData";
import { fetchFacilitiesBySport, fetchFacilitySlots, fetchSportAvailability, fetchSportCatalog } from "../lib/catalog";
import { fetchFacilityPricePreview } from "../lib/pricing";
import { searchCustomersByPhone } from "../lib/admin";
import { fetchAvailableFacilityCount } from "../lib/walkIn";

const EMPTY_LIST = [];

export function useWalkInSports() {
  const { data, loading, error } = useAsyncData(fetchSportCatalog, "walkin-sports", EMPTY_LIST);
  return { sports: data, loading, error };
}

// รวมรายชื่อสนามของกีฬาที่เลือกกับความว่างของวันนี้เข้าด้วยกัน — สนามที่ไม่มี
// ช่วงเวลาว่างเหลือเลยจะถูกทำเครื่องหมาย full ไว้ให้การ์ดแสดง "ไม่ว่าง"
export function useWalkInFacilities(sportId, date) {
  const key = sportId != null ? `walkin-facilities:${sportId}:${date}` : null;

  const { data, loading, error } = useAsyncData(
    async () => {
      const [facilities, availability] = await Promise.all([
        fetchFacilitiesBySport(sportId),
        fetchSportAvailability(sportId, date),
      ]);

      return facilities.map((facility) => {
        const stats = availability.get(facility.id);
        return { ...facility, isFull: stats ? stats.free === 0 : false };
      });
    },
    key,
    EMPTY_LIST,
  );

  return { facilities: data, loading, error };
}

export function useWalkInSlots(facilityId, date, reloadKey = 0) {
  const key = facilityId != null ? `walkin-slots:${facilityId}:${date}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(
    () => fetchFacilitySlots(facilityId, date),
    key,
    EMPTY_LIST,
  );

  return { slots: data, loading, error };
}

export function useWalkInPricePreview(facilityId, date, startTime, endTime) {
  const key =
    facilityId != null && startTime && endTime
      ? `walkin-price:${facilityId}:${date}:${startTime}:${endTime}`
      : null;

  const { data, loading } = useAsyncData(
    () => fetchFacilityPricePreview(facilityId, date, startTime, endTime),
    key,
  );

  return { price: data, loading };
}

export function useAvailableFacilityCount(date) {
  const { data, loading } = useAsyncData(
    () => fetchAvailableFacilityCount(date),
    `walkin-available-count:${date}`,
    0,
  );

  return { count: data, loading };
}

// ค้นหาเฉพาะตอนพิมพ์อย่างน้อย 3 ตัวอักษร — กันไม่ให้ยิงคิวรีทุกครั้งที่กดคีย์
// แรก ๆ ซึ่งมักจะไม่ได้ผลลัพธ์ที่มีความหมายอยู่แล้ว
export function useWalkInCustomerSearch(phone) {
  const trimmed = phone.trim();
  const key = trimmed.length >= 3 ? `walkin-customer:${trimmed}` : null;

  const { data, loading } = useAsyncData(
    () => searchCustomersByPhone(trimmed),
    key,
    EMPTY_LIST,
  );

  return { customers: data, loading };
}
