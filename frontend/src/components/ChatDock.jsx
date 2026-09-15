// ตัวจัดการหน้าต่างแชทลอยมุมขวาล่าง — ถือรายการห้องที่เปิดอยู่ และรับคำสั่ง
// เปิดห้องจากปุ่มแชทบนแถบหัวเว็บผ่าน ChatPopupProvider
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import { useChatPopup } from "../context/useChatPopup";
import { useAlertSounds } from "../hooks/useAlertSounds";
import { useConversations, usePresenceHeartbeat, usePresenceRefresh } from "../hooks/useMessages";
import ChatPopup from "./ChatPopup";
import "./ChatDock.css";

// เปิดพร้อมกันได้สูงสุดกี่ห้อง (แบบ Facebook ที่เปิดเยอะไปจะดันห้องเก่าสุด
// หลุดออกจากแถว) — ไม่จำกัดจะล้นจอแนวนอนเวลาเปิดรัว ๆ
const MAX_POPUPS = 3;

// วาดเฉพาะ "หน้าต่างแชทลอย" มุมขวาล่างแบบ Facebook — ตัวจุดเปิด (ปุ่ม 💬 บน
// AppHeader + แผงรายชื่อ) ย้ายไปอยู่ที่ ChatFlyout แทนแล้ว (เหมือน Facebook
// ปัจจุบันที่ไม่มีแถบ "chat heads" ลอยค้างข้างจออีกต่อไป) สื่อสารกันผ่าน
// ChatPopupContext เพราะ ChatFlyout อยู่ใน AppHeader ลึกเข้าไปใน <Outlet/>
// คนละก้อนกับที่นี่ (ดูเหตุผลเต็ม ๆ ที่ ChatPopupProvider.jsx)
//
// เมานต์ไว้ที่ ProtectedRoute ข้าง ๆ <Outlet/> เพื่อให้อยู่ข้ามหน้าได้ ไม่ต้อง
// remount ทุกครั้งที่เปลี่ยน route
//
// heartbeat สถานะออนไลน์ก็อยู่ตรงนี้แทนที่จะอยู่แค่ในหน้า /messages — จะได้
// อัปเดตสถานะเราแม้กำลังเปิดแค่ป๊อปอัป ไม่ได้เข้าหน้าข้อความเต็มจอ
export default function ChatDock() {
  const { user } = useAuth();
  const location = useLocation();
  const { request } = useChatPopup();

  const [reloadKey, setReloadKey] = useState(0);
  const [openIds, setOpenIds] = useState([]); // index 0 = ห้องล่าสุดที่โฟกัส
  const [minimized, setMinimized] = useState(() => new Set());

  usePresenceHeartbeat(user?.id);
  usePresenceRefresh(Boolean(user?.id), () => setReloadKey((k) => k + 1));

  const { conversations } = useConversations(reloadKey);

  // เสียงเตือนข้อความ/แจ้งเตือนใหม่แขวนไว้ที่นี่ เพราะก้อนนี้เมานต์ค้างอยู่ทุกหน้า
  // หลังล็อกอิน (ดู ProtectedRoute) และมีรายการห้องพร้อมค่าปิดเสียงรายห้องอยู่ใน
  // มือแล้ว — ไม่ต้องดึงซ้ำอีกชุดเพื่อรู้ว่าห้องไหนถูกกดปิดเสียงไว้
  useAlertSounds(user?.id, { conversations });

  function openPopup(id) {
    setMinimized((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });

    // ย้ายห้องที่กดมาไว้หัวแถวเสมอ (ทั้งเปิดใหม่และโฟกัสห้องที่เปิดอยู่แล้ว)
    setOpenIds((current) => {
      const next = [id, ...current.filter((item) => item !== id)];
      return next.length > MAX_POPUPS ? next.slice(0, MAX_POPUPS) : next;
    });
  }

  // ChatFlyout บน AppHeader ขอเปิดห้องมาผ่าน context — เป็นการตอบสนอง event
  // จากคนละ component tree (ไม่ใช่ derived state sync) จึง setState ใน effect
  // ได้ตามปกติ nonce ใน request กันกรณีกดห้องเดิมซ้ำสองครั้งติดกันแล้ว id ไม่
  // เปลี่ยนจน effect ไม่เห็นว่ามีคำขอใหม่
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (request) openPopup(request.conversationId);
  }, [request]);

  function closePopup(id) {
    setOpenIds((current) => current.filter((item) => item !== id));
    setMinimized((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function toggleMinimize(id) {
    setMinimized((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const openConversations = useMemo(
    () => openIds.map((id) => conversations.find((c) => c.id === id)).filter(Boolean),
    [openIds, conversations],
  );

  // ซ่อนหน้าต่างลอยตอนอยู่หน้า /messages เต็มจออยู่แล้ว ไม่งั้นซ้ำซ้อนกับของเดิม
  if (!user || location.pathname.startsWith("/messages") || openConversations.length === 0) {
    return null;
  }

  // แยกห้องที่ขยายอยู่กับห้องที่ย่อเป็นวงกลมออกจากกัน — วงกลมย่อเรียงเป็น
  // สดมภ์แนวตั้งชิดขอบขวาสุด (แบบ chat head บนมือถือ) ส่วนหน้าต่างที่ขยาย
  // อยู่เรียงกันแนวนอนอยู่ทางซ้ายของสดมภ์นั้น
  const expanded = openConversations.filter((c) => !minimized.has(c.id));
  const bubbles = openConversations.filter((c) => minimized.has(c.id));

  return (
    <div className="chat-dock">
      {expanded.length > 0 && (
        <div className="chat-dock__popups">
          {expanded.map((conversation) => (
            <ChatPopup
              key={conversation.id}
              conversation={conversation}
              minimized={false}
              onClose={() => closePopup(conversation.id)}
              onToggleMinimize={() => toggleMinimize(conversation.id)}
              onRead={() => setReloadKey((k) => k + 1)}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ))}
        </div>
      )}

      {bubbles.length > 0 && (
        <div className="chat-dock__bubbles">
          {bubbles.map((conversation) => (
            <ChatPopup
              key={conversation.id}
              conversation={conversation}
              minimized
              onClose={() => closePopup(conversation.id)}
              onToggleMinimize={() => toggleMinimize(conversation.id)}
              onRead={() => setReloadKey((k) => k + 1)}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
