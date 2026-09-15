// เช็คจุดตัดหน้าจอจากฝั่ง JS — ใช้เฉพาะตอนที่ "พฤติกรรม" ต่างกันจริงระหว่าง
// จอกว้างกับจอแคบ ไม่ใช่แค่หน้าตา (อย่างหลัง CSS @media จัดการได้เองหมด)
//
// เคสที่ต้องใช้ตอนนี้คือหน้าข้อความ: จอกว้างเปิดห้องบนสุดให้เองเพราะมีสองแผง
// ข้าง ๆ กัน ปล่อยแผงขวาว่างไว้ก็เสียที่เปล่า แต่จอแคบแสดงทีละจอ ถ้าเปิดให้เอง
// ผู้ใช้จะกดเข้าหน้าข้อความแล้วเด้งเข้าห้องใดห้องหนึ่งทันทีโดยไม่ได้เลือก
//
// useSyncExternalStore แทน useState + useEffect เพราะค่านี้อยู่นอก React
// (ตัว matchMedia) — และหลบกฎ lint ของโปรเจกต์ที่ห้าม setState ใน effect ด้วย
import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query) {
  const subscribe = useCallback(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    // ค่าตอนไม่มี window (ไม่ได้ใช้ตอนนี้เพราะเรนเดอร์ฝั่งเบราว์เซอร์ล้วน)
    () => false,
  );
}
