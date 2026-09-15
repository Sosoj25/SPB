// เมนู ⋯ จัดการห้องแชทหนึ่งห้อง — ใช้ร่วมกันทั้งรายการห้องและหัวห้องในหน้า
// /messages กับหน้าต่างแชทลอย (ChatPopup) ห้ามก็อปเมนูนี้ไปไว้ที่ใดที่หนึ่ง
// ไม่งั้นสามที่จะมีปุ่มไม่ครบเท่ากัน
//
// ทุกปุ่มยิง RPC ของ 0094 แล้วเรียก onChanged() ให้เจ้าของหน้าไปดึงรายการห้อง
// ใหม่ — คอมโพเนนต์นี้ไม่ถือ state ของรายการเอง จึงไม่มีทางแสดงค่าที่ขัดกับ
// ข้อมูลจริงหลังรีเฟรช
//
// แผงเมนูวาดผ่าน portal ไปที่ <body> แล้ววางด้วย position: fixed แทนการวาง
// absolute ใต้ปุ่ม — จุดที่เรียกใช้ทั้งสามแห่งอยู่ในกล่องที่ครอบเนื้อหาไว้หมด
// (รายการห้องเป็น overflow-y: auto, การ์ดรอบนอกเป็น overflow: hidden,
// หน้าต่างแชทลอยก็กล่องปิดเหมือนกัน) แผงที่กางอยู่ข้างในจึงถูกตัดหายทั้งใบ
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MUTE_OPTIONS,
  blockUser,
  clearConversation,
  isMuted,
  markConversationUnread,
  muteConversation,
  muteLabel,
  leaveConversation,
  setConversationPinned,
  unblockUser,
  unmuteConversation,
} from "../lib/messages";
import { errorMessage } from "../lib/errors";
import "./ConversationMenu.css";

const GAP = 6;
const EDGE = 8;

export default function ConversationMenu({
  conversation,
  onChanged,
  onCleared,
  onMarkedUnread,
  onLeft,
  onError,
  className = "",
  label = "ตัวเลือกการสนทนา",
}) {
  const [open, setOpen] = useState(false);
  const [showMute, setShowMute] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);
  const rootRef = useRef(null);
  const panelRef = useRef(null);

  const muted = isMuted(conversation.mutedUntil);

  // วัดขนาดจริงของแผงก่อนวาง เพราะความสูงเปลี่ยนตามเมนูย่อย (ปิดแจ้งเตือน) และ
  // ตามชนิดห้อง (กลุ่มมีปุ่มออกจากกลุ่มเพิ่ม) — useLayoutEffect ทำงานก่อนเบราว์
  // เซอร์วาด จึงไม่เห็นแผงกระโดดจากมุมซ้ายบนไปตำแหน่งจริง
  useLayoutEffect(() => {
    if (!open) return;

    const trigger = rootRef.current?.getBoundingClientRect();
    const panel = panelRef.current?.getBoundingClientRect();
    if (!trigger || !panel) return;

    // ชิดขวาของปุ่มเป็นค่าตั้งต้น แล้วดันกลับเข้าจอถ้าล้น
    let left = Math.min(trigger.right - panel.width, window.innerWidth - panel.width - EDGE);
    left = Math.max(EDGE, left);

    // กางลงล่างก่อน ไม่พอที่ค่อยพลิกขึ้นบน (ปุ่มในหน้าต่างแชทลอยอยู่ชิดขอบล่างจอ)
    let top = trigger.bottom + GAP;
    if (top + panel.height > window.innerHeight - EDGE) {
      const above = trigger.top - panel.height - GAP;
      top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - panel.height - EDGE);
    }

    setPos({ top, left });
  }, [open, showMute, conversation.isGroup, muted]);

  useEffect(() => {
    if (!open) return undefined;

    // แผงอยู่นอก rootRef แล้ว (portal) จึงต้องเช็คทั้งสองก้อน ไม่งั้นคลิกในเมนู
    // ตัวเองจะนับเป็นคลิกข้างนอกและปิดก่อนที่ onClick ของปุ่มจะทำงาน
    const handlePointerDown = (event) => {
      const inside =
        rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target);
      if (!inside) closeMenu();
    };

    const handleKey = (event) => {
      if (event.key === "Escape") closeMenu();
    };

    // ตำแหน่งที่คำนวณไว้เป็นพิกัดบนจอ ณ ตอนกด — พอเลื่อนรายการหรือย่อขยายหน้าต่าง
    // แผงจะลอยค้างผิดที่ ปิดไปเลยตรงไปตรงมากว่าการไล่คำนวณใหม่ทุกเฟรม
    // (capture = true เพราะ event scroll ของกล่องข้างในไม่ bubble ขึ้นมาถึง window)
    const handleReflow = () => closeMenu();

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("resize", handleReflow);
    window.addEventListener("scroll", handleReflow, true);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", handleReflow);
      window.removeEventListener("scroll", handleReflow, true);
    };
  }, [open]);

  // ปิดเมนูย่อย "ปิดการแจ้งเตือน" ไปพร้อมกับเมนูหลักเสมอ ไม่งั้นเปิดเมนูรอบ
  // ถัดไปจะค้างอยู่ที่รายการระยะเวลาแทนที่จะเริ่มจากเมนูหลัก
  function closeMenu() {
    setOpen(false);
    setShowMute(false);
    setPos(null);
  }

  // ครอบทุกปุ่มด้วย busy ตัวเดียว — กดรัว ๆ ระหว่างรอ RPC ตอบจะยิงซ้อนกันจน
  // ผลลัพธ์สลับกันได้ (เช่นกดปักหมุดแล้วกดเลิกปักหมุดทันที)
  async function run(action) {
    if (busy) return;

    setBusy(true);

    try {
      await action();
      onChanged?.();
    } catch (err) {
      console.error("จัดการห้องสนทนาไม่สำเร็จ:", err);
      const message = errorMessage(err);
      if (onError) onError(message);
      else window.alert(message);
    } finally {
      setBusy(false);
      closeMenu();
    }
  }

  function handlePin() {
    run(() => setConversationPinned(conversation.id, !conversation.isPinned));
  }

  function handleMute(minutes) {
    run(() => muteConversation(conversation.id, minutes));
  }

  function handleUnmute() {
    run(() => unmuteConversation(conversation.id));
  }

  // ห้องที่เปิดค้างอยู่จะถูกมาร์กว่าอ่านแล้วทันทีที่ effect ของหน้ารอบถัดไป
  // ทำงาน — เจ้าของหน้าจึงต้องพาออกจากห้องนั้นก่อนผ่าน onMarkedUnread
  function handleUnread() {
    run(async () => {
      await markConversationUnread(conversation.id);
      onMarkedUnread?.(conversation.id);
    });
  }

  function handleClear() {
    const ok = window.confirm(
      `ลบแชทกับ "${conversation.name}" ใช่ไหม?\n\nประวัติจะหายเฉพาะฝั่งคุณ อีกฝ่ายยังเห็นข้อความเดิมอยู่ และห้องจะกลับมาเมื่อมีข้อความใหม่`,
    );
    if (!ok) return;

    run(async () => {
      await clearConversation(conversation.id);
      onCleared?.(conversation.id);
    });
  }

  function handleBlock() {
    if (conversation.blockedByMe) {
      run(() => unblockUser(conversation.otherUserId));
      return;
    }

    const ok = window.confirm(
      `บล็อก "${conversation.name}" ใช่ไหม?\n\nคุณกับผู้ใช้นี้จะส่งข้อความหากันไม่ได้ และจะเลิกติดตามกันทั้งสองฝ่าย`,
    );
    if (!ok) return;

    run(() => blockUser(conversation.otherUserId));
  }

  function handleLeave() {
    const ok = window.confirm(`ออกจากกลุ่ม "${conversation.name}" ใช่ไหม?`);
    if (!ok) return;

    run(async () => {
      await leaveConversation(conversation.id);
      onLeft?.(conversation.id);
    });
  }

  const panel = (
    <span
      className="conv-menu__panel"
      role="menu"
      ref={panelRef}
      // ซ่อนไว้ก่อนจนกว่าจะวัดขนาดเสร็จในรอบ layout — ต้องได้วาดลง DOM จริง
      // ก่อนถึงจะวัดความสูงได้ จึงใช้ visibility ไม่ใช่การไม่ render
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      {showMute ? (
        <>
          <span className="conv-menu__head">ปิดการแจ้งเตือนนาน</span>
          {MUTE_OPTIONS.map((option) => (
            <button
              key={option.label}
              type="button"
              className="conv-menu__item"
              role="menuitem"
              onClick={() => handleMute(option.minutes)}
            >
              {option.label}
            </button>
          ))}
          <button
            type="button"
            className="conv-menu__item conv-menu__item--back"
            role="menuitem"
            onClick={() => setShowMute(false)}
          >
            ← ย้อนกลับ
          </button>
        </>
      ) : (
        <>
          <button type="button" className="conv-menu__item" role="menuitem" onClick={handlePin}>
            {conversation.isPinned ? "📌 เลิกปักหมุด" : "📌 ปักหมุดไว้บนสุด"}
          </button>

          {muted ? (
            <button
              type="button"
              className="conv-menu__item"
              role="menuitem"
              onClick={handleUnmute}
            >
              🔔 เปิดการแจ้งเตือน
              <span className="conv-menu__hint">{muteLabel(conversation.mutedUntil)}</span>
            </button>
          ) : (
            <button
              type="button"
              className="conv-menu__item"
              role="menuitem"
              aria-haspopup="true"
              onClick={() => setShowMute(true)}
            >
              🔕 ปิดการแจ้งเตือน
              <span className="conv-menu__chevron" aria-hidden="true">
                ›
              </span>
            </button>
          )}

          <button type="button" className="conv-menu__item" role="menuitem" onClick={handleUnread}>
            ✉️ ทำเครื่องหมายว่ายังไม่อ่าน
          </button>

          <button
            type="button"
            className="conv-menu__item conv-menu__item--danger"
            role="menuitem"
            onClick={handleClear}
          >
            🗑 ลบแชท
          </button>

          {/* บล็อกได้เฉพาะห้องคู่ — ในกลุ่มยังมีคนอื่นอยู่ด้วย การบล็อก
              รายคนจึงไม่ได้ทำให้ห้องเงียบลงอย่างที่ผู้ใช้คาด */}
          {!conversation.isGroup && conversation.otherUserId && (
            <button
              type="button"
              className="conv-menu__item conv-menu__item--danger"
              role="menuitem"
              onClick={handleBlock}
            >
              {conversation.blockedByMe ? "✅ เลิกบล็อกผู้ใช้นี้" : "🚫 บล็อกผู้ใช้นี้"}
            </button>
          )}

          {conversation.isGroup && (
            <button
              type="button"
              className="conv-menu__item conv-menu__item--danger"
              role="menuitem"
              onClick={handleLeave}
            >
              🚪 ออกจากกลุ่ม
            </button>
          )}
        </>
      )}
    </span>
  );

  return (
    <span className={`conv-menu ${className}`} ref={rootRef}>
      <button
        type="button"
        className="conv-menu__trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => (open ? closeMenu() : setOpen(true))}
      >
        ⋯
      </button>

      {open && createPortal(panel, document.body)}
    </span>
  );
}
