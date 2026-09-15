// ตัดข้อความยาวด้วย CSS line-clamp แล้วมีปุ่ม "ดูเพิ่มเติม" กดขยายเต็ม
// ใช้กับเนื้อโพสต์/คอมเมนต์ที่ความยาวไม่จำกัด
//
// เช็คความยาวด้วย text.length แทนการวัด DOM จริง (rough แต่พอ) เพื่อไม่ต้อง
// ยุ่งกับ ResizeObserver ข้ามรอบ render — โพสต์สั้นกว่าเกณฑ์นี้แทบไม่มีทาง
// ล้น 3-4 บรรทัดจริง ๆ อยู่แล้ว จึงไม่โชว์ปุ่มให้กดเปล่า ๆ
import { useState } from "react";

const LONG_THRESHOLD = 220;

export default function ClampText({ text, prefix, className, lines = 4 }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = (text ?? "").length > LONG_THRESHOLD;

  return (
    <>
      <p
        className={`${className} ${!expanded && isLong ? "clamp-text--clamped" : ""}`}
        style={!expanded && isLong ? { "--clamp-lines": lines } : undefined}
      >
        {prefix}
        {text}
      </p>
      {isLong && (
        <button
          type="button"
          className="clamp-text__toggle"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((current) => !current);
          }}
        >
          {expanded ? "ย่อ" : "ดูเพิ่มเติม"}
        </button>
      )}
    </>
  );
}
