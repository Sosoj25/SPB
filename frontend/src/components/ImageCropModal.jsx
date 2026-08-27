import { useRef, useState } from "react";
import "./ImageCropModal.css";

const RATIOS = [
  { key: "16:9", label: "16:9", value: 16 / 9 },
  { key: "4:3", label: "4:3", value: 4 / 3 },
  { key: "1:1", label: "1:1", value: 1 },
  { key: "free", label: "อิสระ", value: null },
];

const FRAME_WIDTH = 440;
const OUTPUT_MAX = 1600;

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

  const ratio = RATIOS.find((r) => r.key === ratioKey);
  const effectiveRatio = ratio.value ?? (natural ? natural.width / natural.height : 1);
  const frameHeight = FRAME_WIDTH / effectiveRatio;

  const scale = natural
    ? Math.max(FRAME_WIDTH / natural.width, frameHeight / natural.height)
    : 1;
  const displayedW = natural ? natural.width * scale : 0;
  const displayedH = natural ? natural.height * scale : 0;

  function clamp(offsetX, offsetY) {
    const minX = FRAME_WIDTH - displayedW;
    const minY = frameHeight - displayedH;
    return {
      x: Math.min(0, Math.max(minX, offsetX)),
      y: Math.min(0, Math.max(minY, offsetY)),
    };
  }

  // เปลี่ยนสัดส่วนหรือรูปเพิ่งโหลดเสร็จ แล้วกรอบ/ขนาดที่แสดงเปลี่ยน — จัดรูป
  // กึ่งกลางกรอบใหม่เสมอ คำนวณระหว่าง render ตรง ๆ แทน useEffect (เทียบ
  // ค่ารอบก่อนหน้ากับตอนนี้ เหมือน pattern ใน AdminFacilities.jsx)
  const [prevRatioKey, setPrevRatioKey] = useState(ratioKey);
  const [prevNatural, setPrevNatural] = useState(natural);
  if (natural && (ratioKey !== prevRatioKey || natural !== prevNatural)) {
    setPrevRatioKey(ratioKey);
    setPrevNatural(natural);
    setOffset(clamp((FRAME_WIDTH - displayedW) / 2, (frameHeight - displayedH) / 2));
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
    const sourceW = FRAME_WIDTH / scale;
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

        <div
          className="crop-modal__frame"
          style={{ width: FRAME_WIDTH, height: frameHeight }}
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
