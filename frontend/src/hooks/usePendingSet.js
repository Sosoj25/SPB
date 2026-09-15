// กันกดรัว ๆ ยิงซ้ำก่อนคำขอเดิมจบ (เช่นดับเบิลคลิกถูกใจ/ติดตาม แล้วชนคีย์ซ้ำ
// ที่ post_likes/user_follows) — คืนเซตของ id ที่กำลังมีคำขอค้างอยู่ ให้เช็ค
// ก่อนเริ่ม action ใหม่ กับฟังก์ชัน run ที่เพิ่ม/เอา id ออกจากเซตให้เองรอบ action
import { useCallback, useState } from "react";

export function usePendingSet() {
  const [pending, setPending] = useState(() => new Set());

  const run = useCallback(async (id, action) => {
    setPending((prev) => new Set(prev).add(id));
    try {
      await action();
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, []);

  return [pending, run];
}
