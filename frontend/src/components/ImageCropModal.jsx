// กล่องครอบตัดรูปก่อนอัปโหลด — เลือกอัตราส่วน ลากเลื่อน ซูม แล้วตัดออกมา
// เป็น JPEG ผ่าน canvas
import { useLayoutEffect, useRef, useState } from "react";
import "./ImageCropModal.css";

const RATIOS = [
  { key: "16:9", label: "16:9", value: 16 / 9 },
  { key: "4:3", label: "4:3", value: 4 / 3 },
  { key: "1:1", label: "1:1", value: 1 },
  { key: "free", label: "อิสระ", value: null },
];

const FRAME_WIDTH = 440;
const OUTPUT_MAX = 1600;

// ความกว้างกรอบครอบตัดต้องเป็นตัวเลขเดียวกับที่วาดจริงบนจอ เพราะตำแหน่งที่
// ผู้ใช้ลาก (offset) และพื้นที่ที่ตัดออกมาลงผืนผ้าใบ คำนวณจากค่านี้ทั้งคู่ —
// ถ้าปล่อยให้ CSS ย่อกรอบลงบนมือถือ (max-width: 100%) โดยที่สูตรยังคิดจาก
// 440 รูปที่ได้จะไม่ตรงกับที่เห็นในกรอบเลย จึงวัดความกว้างที่มีจริงแล้วส่ง
// ค่านั้นกลับเข้าสูตรแทน
function useFrameWidth(wrapRef) {
  const [width, setWidth] = useState(FRAME_WIDTH);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;

    const measure = () => {
      const available = el.clientWidth;
      if (available > 0) setWidth(Math.min(FRAME_WIDTH, available));
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [wrapRef]);

  return width;
}

// ครอบตัดแบบ "แพนรูปหลังกรอบขนาดคงที่" (เหมือน crop รูปโปรไฟล์ทั่วไป) —
// กรอบเป็นสัดส่วนที่เลือกเสมอ ผู้ใช้ลากรูปด้านหลังกรอบเพื่อเลือกส่วนที่
// อยากได้ ไม่ใช่ลากกรอบไปมาบนรูปที่นิ่งอยู่ ทำให้คำนวณง่ายกว่าและกันกรอบ
// หลุดขอบรูปได้ตรงไปตรงมา (clamp offset ให้กรอบเต็มพื้นที่รูปเสมอ)
export default function ImageCropModal({ imageUrl, onCancel, onConfirm }) {
  const [ratioKey, setRatioKey] = useState("16:9");
  const [natural, setNatural] = useState(null); // { width, height }
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [saving, setSaving] = useState(false);
  const dragRef = useRef(null); // { startX, startY, offsetX, offsetY }
  const wrapRef = useRef(null);
  const frameWidth = useFrameWidth(wrapRef);

  const ratio = RATIOS.find((r) => r.key === ratioKey);
  const effectiveRatio = ratio.value ?? (natural ? natural.width / natural.height : 1);
  const frameHeight = frameWidth / effectiveRatio;

  const scale = natural
    ? Math.max(frameWidth / natural.width, frameHeight / natural.height)
    : 1;
  const displayedW = natural ? natural.width * scale : 0;
  const displayedH = natural ? natural.height * scale : 0;

  function clamp(offsetX, offsetY) {
    const minX = frameWidth - displayedW;
    const minY = frameHeight - displayedH;
    return {
      x: Math.min(0, Math.max(minX, offsetX)),
      y: Math.min(0, Math.max(minY, offsetY)),
    };
  }

  // หมุนจอ/ย่อหน้าต่างแล้วกรอบเปลี่ยนขนาด — รูปที่เคยลากไว้อาจหลุดขอบกรอบใหม่
  // ต้องดึงกลับเข้ากรอบทันที ไม่ใช่รอให้ผู้ใช้ไปลากเอง และต่างจากบล็อกข้างล่าง
  // ตรงที่ไม่จัดกึ่งกลางใหม่ เพราะส่วนที่ผู้ใช้เลือกไว้แล้วไม่ควรกระโดดเพราะ
  // แค่หมุนจอ
  //
  // ต้องจำค่ากรอบไว้แม้ตอนที่รูปยังโหลดไม่เสร็จ (จึงเช็ค natural แค่ตอนจะขยับ
  // รูป ไม่ใช่เอามาเป็นเงื่อนไขของทั้งบล็อก) ไม่งั้นการวัดกรอบครั้งแรกซึ่ง
  // เกิดก่อนรูปโหลดเสร็จเสมอ จะค้างเป็น "ยังไม่เคยเห็น" ไว้ แล้วไปเด้งพร้อม
  // กับบล็อกจัดกึ่งกลางข้างล่างในรอบเดียวกันจนทับกันเอง
  const [prevFrameWidth, setPrevFrameWidth] = useState(frameWidth);
  if (frameWidth !== prevFrameWidth) {
    setPrevFrameWidth(frameWidth);
    if (natural) setOffset(clamp(offset.x, offset.y));
  }

  // เปลี่ยนสัดส่วนหรือรูปเพิ่งโหลดเสร็จ แล้วกรอบ/ขนาดที่แสดงเปลี่ยน — จัดรูป
  // กึ่งกลางกรอบใหม่เสมอ คำนวณระหว่าง render ตรง ๆ แทน useEffect (เทียบ
  // ค่ารอบก่อนหน้ากับตอนนี้ เหมือน pattern ใน AdminFacilities.jsx)
  //
  // อยู่หลังบล็อกกรอบเปลี่ยนขนาด เพื่อให้รอบที่ทั้งสองเงื่อนไขจริงพร้อมกัน
  // จบด้วยการจัดกึ่งกลาง ซึ่งเป็นผลลัพธ์ที่ถูกกว่าเมื่อรูปเพิ่งเปลี่ยน
  const [prevRatioKey, setPrevRatioKey] = useState(ratioKey);
  const [prevNatural, setPrevNatural] = useState(natural);
  if (natural && (ratioKey !== prevRatioKey || natural !== prevNatural)) {
    setPrevRatioKey(ratioKey);
    setPrevNatural(natural);
    setOffset(clamp((frameWidth - displayedW) / 2, (frameHeight - displayedH) / 2));
  }

  function handleImageLoad(e) {
    setNatural({ width: e.target.naturalWidth, height: e.target.naturalHeight });
  }

  function handlePointerDown(e) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, offsetX: offset.x, offsetY: offset.y };
  }

  function handlePointerMove(e) {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset(clamp(dragRef.current.offsetX + dx, dragRef.current.offsetY + dy));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }

  async function handleConfirm() {
    if (!natural) return;
    setSaving(true);

    const sourceX = -offset.x / scale;
    const sourceY = -offset.y / scale;
    const sourceW = frameWidth / scale;
    const sourceH = frameHeight / scale;

    const outW = Math.min(OUTPUT_MAX, Math.round(sourceW));
    const outH = Math.round(outW / effectiveRatio);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });

    ctx.drawImage(img, sourceX, sourceY, sourceW, sourceH, 0, 0, outW, outH);

    canvas.toBlob(
      (blob) => {
        setSaving(false);
        if (blob) onConfirm(blob);
      },
      "image/jpeg",
      0.9,
    );
  }

  return (
    <div className="dash-modal-overlay" onClick={onCancel}>
      <div className="dash-modal crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dash-modal__header">
          <h2>ครอบตัดรูป</h2>
          <button type="button" className="dash-modal__close" onClick={onCancel} aria-label="ปิด">
            ✕
          </button>
        </div>

        <div className="crop-modal__ratios">
          {RATIOS.map((r) => (
            <button
              key={r.key}
              type="button"
              className={`dash-pill ${ratioKey === r.key ? "dash-pill--active" : ""}`}
              onClick={() => setRatioKey(r.key)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* กล่องนอกมีไว้ให้วัดความกว้างที่เหลือจริงในโมดัล (ดู useFrameWidth) */}
        <div className="crop-modal__frame-wrap" ref={wrapRef}>
          <div
            className="crop-modal__frame"
            style={{ width: frameWidth, height: frameHeight }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <img
              src={imageUrl}
              alt=""
              crossOrigin="anonymous"
              onLoad={handleImageLoad}
              draggable={false}
              style={{
                width: displayedW || "100%",
                height: displayedH || "100%",
                transform: `translate(${offset.x}px, ${offset.y}px)`,
              }}
            />
          </div>
        </div>

        <p className="crop-modal__hint">ลากรูปเพื่อเลือกส่วนที่ต้องการ</p>

        <div className="crop-modal__actions">
          <button type="button" className="dash-btn" onClick={onCancel}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="dash-btn dash-btn--add"
            disabled={!natural || saving}
            onClick={handleConfirm}
          >
            {saving ? "กำลังบันทึก..." : "ใช้รูปนี้"}
          </button>
        </div>
      </div>
    </div>
  );
}
