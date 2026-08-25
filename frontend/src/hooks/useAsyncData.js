import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";

// ครอบ query ที่ยิงครั้งเดียวจบให้เหลือ { data, loading, error } เหมือนกันทุกหน้า
//
// key คือ "คำถาม" ที่กำลังถามอยู่ (เช่น `${facilityId}:${date}`) ผลลัพธ์ถูกเก็บ
// คู่กับ key ที่ยิงไป แล้วค่อยเทียบตอน render แทนการ setState({loading:true})
// ตั้งต้นใน effect — พอผู้ใช้เปลี่ยนวันในปฏิทิน ค่าจะกลับเป็น "กำลังโหลด" เอง
// ทันทีในรอบเดียว ไม่มีจังหวะที่ข้อมูลของวันเก่าค้างอยู่บนหน้าจอของวันใหม่
//
// fetcher ถูกเก็บใน ref เพราะหน้าที่เรียกส่ง arrow function ใหม่ทุกรอบ render
// ถ้าใส่ไว้ใน deps จะยิงซ้ำไม่จบ
export function useAsyncData(fetcher, key, fallback = null) {
  const run = useRef(fetcher);
  const [result, setResult] = useState(null);

  // อัปเดต ref ใน effect ไม่ใช่ตอน render — และต้องประกาศไว้ก่อน effect ที่ยิง
  // query ข้างล่าง เพราะ React รัน effect ตามลำดับที่เขียน ถ้าสลับกันรอบที่
  // key เปลี่ยนจะยิงด้วย fetcher ของรอบก่อนหน้า
  useEffect(() => {
    run.current = fetcher;
  });

  useEffect(() => {
    if (key == null) return undefined;

    let alive = true;

    Promise.resolve()
      .then(() => run.current())
      .then((data) => {
        if (alive) setResult({ key, data, error: "" });
      })
      .catch((err) => {
        console.error("Supabase query failed:", err);
        if (alive) setResult({ key, data: null, error: errorMessage(err) });
      });

    return () => {
      alive = false;
    };
  }, [key]);

  const settled = result?.key === key;

  return {
    data: settled && result.data != null ? result.data : fallback,
    loading: key != null && !settled,
    error: settled ? result.error : "",
  };
}
