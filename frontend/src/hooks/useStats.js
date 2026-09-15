// ตัวเลขชุดเดียวกันถูกใช้ทั้งหน้าแรกและหน้าสิ่งอำนวยความสะดวก จึงดึงผ่าน
// hook ตัวเดียวกัน ไม่ให้สองหน้าเขียนเงื่อนไข "โชว์/ไม่โชว์" แยกกันเอง
import { useAsyncData } from "./useAsyncData";
import { fetchPlatformStats } from "../lib/stats";

export function usePlatformStats() {
  const { data: stats, loading, error } = useAsyncData(fetchPlatformStats, "platform-stats");
  return { stats, loading, error };
}
