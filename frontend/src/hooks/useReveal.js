/* ทำให้เนื้อหาค่อย ๆ จาง-เลื่อนขึ้นตอนเลื่อนมาถึง ใช้กับหน้าสาธารณะเท่านั้น
   (Landing / Home / Facilities / News / Contact) — หน้า admin กับขั้นตอนจอง
   เป็นหน้าที่คนเปิดซ้ำวันละหลายรอบ การหน่วงให้ดูสวยกลายเป็นความช้าแทน

   วิธีใช้: ผูก ref ที่ได้กับกล่องนอกสุดของหน้า แล้วติด data-reveal ให้ชิ้นที่
   อยากให้จางเข้ามา เพิ่ม data-reveal-delay="1" (2, 3, ...) เพื่อให้ของในกลุ่ม
   เดียวกันทยอยโผล่ทีละชิ้นแทนที่จะมาพร้อมกันหมด

   ไม่ใช้ไลบรารีอย่าง AOS เพราะสองเหตุผล: แอปนี้ตั้ง zoom ที่ html แล้วซ้อน zoom
   อีกชั้นใน .landing/.home ทำให้ไลบรารีที่คำนวณ offsetTop เองอ่านตำแหน่งเพี้ยน
   ส่วน IntersectionObserver อ่าน rect หลังคิด zoom แล้วจึงตรงเสมอ และแอปนี้
   เคารพ prefers-reduced-motion อยู่แล้วทุกที่ ซึ่งไลบรารีไม่ได้ให้มาโดยปริยาย */
import { useEffect, useRef } from "react";

/* หน่วงทีละชิ้นสำหรับของที่อยู่กลุ่มเดียวกัน (data-reveal-delay="1" = 80ms) */
const STEP_MS = 80;

export default function useReveal() {
  const rootRef = useRef(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    /* ผู้ใช้ที่ขอลดการเคลื่อนไหวไม่ต้องเฝ้าอะไรเลย ไม่ต้องติด .reveal-root ด้วย
       เนื้อหาจะแสดงเต็มตั้งแต่แรกโดยไม่พึ่ง observer มาปลดให้ */
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    /* ติดคลาสนี้ก่อนซ่อนอะไรทั้งนั้น: CSS ซ่อน data-reveal เฉพาะที่อยู่ใต้
       .reveal-root ดังนั้นถ้า JS ไม่ทำงาน เนื้อหาจะแสดงตามปกติ ไม่หายเงียบ ๆ */
    root.classList.add("reveal-root");

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target;
          const step = Number(el.dataset.revealDelay) || 0;
          if (step) el.style.transitionDelay = `${step * STEP_MS}ms`;
          el.classList.add("is-revealed");
          /* เลิกเฝ้าทันทีที่โผล่แล้ว — ตั้งใจให้เล่นครั้งเดียว ไม่ใช่วูบซ้ำทุก
             ครั้งที่เลื่อนผ่านไปมา */
          io.unobserve(el);
        }
      },
      /* -12% ล่าง: รอให้ชิ้นงานโผล่พ้นขอบจอเข้ามาจริง ๆ ก่อนค่อยเล่น ไม่ใช่
         ติดปุ๊บตั้งแต่ขอบบนสุดแตะ */
      { threshold: 0.05, rootMargin: "0px 0px -12% 0px" },
    );

    /* observe ซ้ำที่เดิมไม่มีผลข้างเคียง (สเปกให้ข้ามไปเลยถ้าเฝ้าอยู่แล้ว)
       จึงกวาดทั้ง subtree ใหม่ได้โดยไม่ต้องจำว่าตัวไหนเฝ้าไปแล้วบ้าง */
    const observeAll = () => {
      for (const el of root.querySelectorAll("[data-reveal]:not(.is-revealed)")) {
        io.observe(el);
      }
    };

    observeAll();

    /* เนื้อหาเกือบทุกหน้ามาจาก API ทีหลัง (การ์ดสนาม ข่าว สถิติ) ชิ้นพวกนั้น
       ยังไม่อยู่ใน DOM ตอนกวาดรอบแรก ถ้าไม่เฝ้าการเปลี่ยนแปลงไว้ มันจะค้าง
       จาง ๆ อยู่อย่างนั้นเพราะไม่มีใครมาปลด — เฝ้าที่นี่ที่เดียวจบ ดีกว่าให้
       ทุกหน้าต้องคอยส่งรายการ dependency ที่ถูกต้องมาเอง */
    const mo = new MutationObserver(observeAll);
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      mo.disconnect();
      io.disconnect();
    };
  }, []);

  return rootRef;
}
