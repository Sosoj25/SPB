// เสียงเตือนข้อความ/แจ้งเตือนใหม่ และสวิตช์เปิด-ปิดเสียง
import { useCallback, useEffect, useRef, useState } from "react";
import {
  isAlertSoundOn,
  playAlertSound,
  primeAlertSound,
  setAlertSoundOn,
} from "../lib/alertSound";
import { isMuted, subscribeToUnreadMessages } from "../lib/messages";
import { subscribeToNotifications } from "../lib/notifications";
import { subscribeToSupportThreads } from "../lib/support";

// ประเภทแจ้งเตือนที่ไม่ต้องมีเสียงของตัวเอง เพราะมีเสียงจากอีกทางอยู่แล้ว —
// ทุกข้อความแชทเขียนแถว community_message เข้าตาราง notifications ด้วย (0044)
// ถ้าปล่อยไว้ผู้ใช้จะได้ยินสองเสียงซ้อนกันต่อข้อความเดียว
const SILENT_NOTIFICATION_TYPES = ["community_message"];

// เล่นเสียงเตือนเมื่อมีข้อความใหม่หรือมีการแจ้งเตือนเข้ามาแบบเรียลไทม์
//
// ใช้ช่องทางเดียวกับที่ป้ายตัวเลขบนหัวเว็บใช้อยู่แล้ว (subscribeToUnreadMessages
// + subscribeToNotifications) เสียงจึงดังพร้อมกับที่ตัวเลขขยับเสมอ ไม่มีจังหวะ
// ที่ดังแล้วหาไม่เจอว่ามาจากอะไร
//
// conversations ส่งมาได้เพื่อให้เคารพห้องที่ผู้ใช้กดปิดการแจ้งเตือนไว้ —
// ผู้เรียกที่มีรายการห้องอยู่ในมือแล้ว (ChatDock) ส่งมาเลย ส่วนฝั่งที่ไม่มี
// (แดชบอร์ดแอดมิน) ปล่อยว่างได้ แค่จะไม่รู้จักห้องที่ปิดเสียงไว้
//
// supportThreads เปิดเฉพาะฝั่งแอดมิน — เรื่องที่ลูกค้าส่งเข้ามาทางหน้าติดต่อเรา
// ไม่ได้เขียนแถวแจ้งเตือนถึงแอดมิน (0096 เขียนให้ฝั่งลูกค้าทางเดียว) ถ้าไม่ฟัง
// ตารางเธรดตรง ๆ แอดมินจะไม่มีทางรู้ว่ามีคนกำลังรอคำตอบอยู่จนกว่าจะเปิดหน้านั้น
// เอง ส่วนฝั่งลูกค้าไม่ต้องเปิด เพราะได้เสียงจากแถว support_reply อยู่แล้ว
export function useAlertSounds(userId, { conversations = null, supportThreads = false } = {}) {
  // อ่านค่าล่าสุดตอน event มาถึงโดยไม่ต้อง subscribe ใหม่ทุกครั้งที่รายการห้อง
  // ถูกดึงซ้ำ (ChatDock ดึงใหม่ทุก 60 วิ) — ไม่งั้น channel จะถูกถอด/ต่อใหม่
  // รัว ๆ จนพลาด event ที่มาถึงพอดีช่วงคาบเกี่ยว
  const latest = useRef(conversations);

  useEffect(() => {
    latest.current = conversations;
  });

  useEffect(() => primeAlertSound(), []);

  useEffect(() => {
    if (!userId) return undefined;

    const stopMessages = subscribeToUnreadMessages(userId, (payload) => {
      // channel เดียวกันส่ง UPDATE ของ conversation_members มาด้วย (ใช้สั่ง
      // รีเฟรชยอดยังไม่อ่าน) — เอาเฉพาะข้อความที่เพิ่งถูกส่งเข้ามาจริง
      if (payload.eventType !== "INSERT" || payload.table !== "messages") return;

      const row = payload.new;
      // ข้อความของตัวเองก็เด้งกลับมาทาง Realtime เหมือนกัน ไม่ต้องดังบอกเราว่า
      // เราเพิ่งพิมพ์อะไรไป
      if (!row || row.sender_id === userId) return;

      const conversation = latest.current?.find((item) => item.id === row.conversation_id);
      if (conversation && isMuted(conversation.mutedUntil)) return;

      playAlertSound("message");
    });

    const stopNotifications = subscribeToNotifications(userId, (payload) => {
      // channel นี้ฟัง event "*" เพราะอีกฝั่งใช้จับตอนมาร์กอ่านแล้วด้วย —
      // เสียงเอาเฉพาะของใหม่ที่เพิ่งเข้ามา
      if (payload.eventType !== "INSERT") return;
      if (SILENT_NOTIFICATION_TYPES.includes(payload.new?.type)) return;

      playAlertSound("notification");
    });

    return () => {
      stopMessages();
      stopNotifications();
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !supportThreads) return undefined;

    return subscribeToSupportThreads((payload) => {
      if (payload.eventType !== "INSERT") return;

      // คำตอบที่เจ้าหน้าที่พิมพ์เองก็เด้งกลับมาทาง Realtime เหมือนกัน — เอา
      // เฉพาะที่ลูกค้าเป็นคนพิมพ์ ส่วนตาราง support_tickets แถวใหม่คือเรื่องที่
      // เพิ่งถูกส่งเข้ามา มีแต่ของลูกค้าอยู่แล้ว
      if (payload.table === "support_ticket_replies" && payload.new?.is_staff) return;

      playAlertSound("notification");
    });
  }, [userId, supportThreads]);
}

// สวิตช์เปิด/ปิดเสียงสำหรับปุ่มบนหน้าจอ — ค่าจริงอยู่ใน localStorage (ตัว
// playAlertSound อ่านเองทุกครั้งที่จะดัง) ที่นี่เก็บแค่สำเนาไว้วาดสถานะปุ่ม
//
// กดเปิดแล้วเล่นตัวอย่างให้ฟังทันที ไม่ใช่แค่สลับสีปุ่มเงียบ ๆ — ผู้ใช้จะได้
// รู้เดี๋ยวนั้นว่าเสียงดังจริงและดังแบบไหน แทนที่จะต้องรอลุ้นว่าข้อความถัดไป
// จะมีเสียงไหม (ถ้าลำโพงปิดอยู่ก็รู้ตั้งแต่ตอนนี้เลย)
export function useAlertSoundSetting() {
  const [on, setOn] = useState(isAlertSoundOn);

  const toggle = useCallback(() => {
    // อ่านค่าจาก localStorage แทน state ในมือ เผื่อมีอีกแท็บ/อีกปุ่มสลับไว้
    const next = !isAlertSoundOn();

    setAlertSoundOn(next);
    setOn(next);
    if (next) playAlertSound("message", { force: true });
  }, []);

  return { on, toggle };
}
