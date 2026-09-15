// สะพานเบา ๆ ระหว่าง AppHeader (ปุ่มแชทบนหัวเว็บ ซึ่งอยู่คนละจุดในต้นไม้
// component กับ ChatDock) กับ ChatDock (ตัวจริงที่ถือ state ห้องที่เปิดอยู่
// และวาดหน้าต่างแชทลอย) — ไม่ผูกกับ hooks/lib ของแชทเลยสักตัว (ไม่มี
// useConversations ฯลฯ) เพื่อให้ตัวนี้เบามากพอจะอยู่ eager ครอบ <Outlet/>
// ได้โดยไม่พองก้อน bundle หลัก ส่วนของหนัก ๆ ทั้งหมดยังอยู่ใน ChatDock ที่
// lazy-load เหมือนเดิม
//
// nonce กันกรณีกดเปิดห้องเดิมซ้ำสองครั้งติดกัน — ถ้าใช้แค่ id เฉย ๆ ค่าจะไม่
// เปลี่ยนระหว่างสองคลิก ChatDock ที่ฟังผ่าน useEffect([request]) จะไม่เห็นว่า
// มีคำขอใหม่เข้ามารอบที่สอง
import { useCallback, useMemo, useState } from "react";
import { ChatPopupContext } from "./chat-popup-context";

export function ChatPopupProvider({ children }) {
  const [request, setRequest] = useState(null);

  const requestOpen = useCallback((conversationId) => {
    setRequest({ conversationId, nonce: Date.now() });
  }, []);

  const value = useMemo(() => ({ request, requestOpen }), [request, requestOpen]);

  return <ChatPopupContext.Provider value={value}>{children}</ChatPopupContext.Provider>;
}
