// ครอบ query ที่ยิงครั้งเดียวจบให้เหลือ { data, loading, error } เหมือนกันทุกหน้า
//
// key คือ "คำถาม" ที่กำลังถามอยู่ (เช่น `${facilityId}:${date}`) ผลลัพธ์ถูกเก็บ
// คู่กับ key ที่ยิงไป แล้วค่อยเทียบตอน render แทนการ setState({loading:true})
// ตั้งต้นใน effect — พอผู้ใช้เปลี่ยนวันในปฏิทิน ค่าจะกลับเป็น "กำลังโหลด" เอง
// ทันทีในรอบเดียว ไม่มีจังหวะที่ข้อมูลของวันเก่าค้างอยู่บนหน้าจอของวันใหม่
//
// fetcher ถูกเก็บใน ref เพราะหน้าที่เรียกส่ง arrow function ใหม่ทุกรอบ render
// ถ้าใส่ไว้ใน deps จะยิงซ้ำไม่จบ
//
// keepPreviousData: true ให้คงข้อมูลชุดล่าสุดที่โหลดสำเร็จค้างไว้ระหว่างที่
// key เปลี่ยน (เช่น bump reloadKey หลังกดถูกใจ/คอมเมนต์) แทนที่จะรีเซ็ตเป็น
// fallback ทันที — ใช้ตอนที่ key เปลี่ยนบ่อยแต่ยังเป็น "คำถามเดิม" อยู่จริง ๆ
// (แค่สั่งดึงใหม่) ไม่ใช่ตอนเปลี่ยนไปถามคำถามใหม่จริง (เช่น เปลี่ยนวันที่ใน
// ปฏิทิน) ซึ่งยังต้องรีเซ็ตทันทีเหมือนเดิมเพื่อไม่ให้ข้อมูลชุดเก่าค้างผิดที่
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";

export function useAsyncData(fetcher, key, fallback = null, { keepPreviousData = false } = {}) {
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
  const showStaleData = keepPreviousData && !settled && result != null;

  return {
    data: (settled || showStaleData) && result.data != null ? result.data : fallback,
    loading: key != null && !settled,
    error: settled ? result.error : "",
  };
}
