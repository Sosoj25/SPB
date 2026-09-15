// แชท — รายการห้อง ข้อความในห้อง สถานะออนไลน์ และการอ่านแล้ว
//
// ข้อความใหม่/สถานะอ่านแล้วมาทาง Realtime แล้วต่อเข้า state ตรง ๆ ไม่ใช่ดึง
// ทั้งห้องใหม่ทุกครั้ง ห้องที่กางอยู่จึงไม่กระพริบตอนมีคนพิมพ์ตอบ
import { useCallback, useEffect, useRef, useState } from "react";
import { useAsyncData } from "./useAsyncData";
import { errorMessage } from "../lib/errors";
import {
  fetchConversationMembers,
  fetchConversations,
  fetchMessages,
  subscribeToMessages,
  subscribeToReadReceipts,
  touchPresence,
} from "../lib/messages";

const EMPTY = [];

// ส่ง heartbeat ทุก 60 วิระหว่างที่แท็บยังเปิดอยู่ — RPC เขียนจริงเฉพาะตอน
// ค่าเดิมเก่าเกิน 30 วิ (0057) จึงไม่ต้องกลัวว่าหลายแท็บจะยิง UPDATE ทับกันรัว ๆ
//
// หยุดตอนแท็บถูกซ่อน แล้วยิงทันทีหนึ่งครั้งตอนกลับมา — คนที่สลับไปแอปอื่นทิ้งไว้
// ควรถูกนับเป็นออฟไลน์ตามจริง ไม่ใช่ค้างเป็นออนไลน์ตลอดกาลเพราะลืมปิดแท็บ
const HEARTBEAT_MS = 60000;

export function usePresenceHeartbeat(userId) {
  useEffect(() => {
    if (!userId) return undefined;

    const beat = () => {
      if (document.visibilityState !== "visible") return;
      touchPresence().catch((err) => console.error("อัปเดตสถานะออนไลน์ไม่สำเร็จ:", err));
    };

    beat();
    const id = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", beat);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [userId]);
}

// ดึงรายการห้องซ้ำเป็นระยะระหว่างที่แท็บยังเปิดอยู่
//
// สถานะ "ออนไลน์/ใช้งานล่าสุด" มาจาก last_seen_at ที่ติดมากับ
// list_my_conversations ก้อนเดียว ถ้าไม่ดึงซ้ำเลย จุดเขียวจะค้างอยู่จนกว่า
// ผู้ใช้จะกดอะไรสักอย่างที่ดัน reloadKey — อีกฝ่ายปิดแอปไปสิบนาทีแล้วก็ยังขึ้น
// ว่าออนไลน์อยู่ ซึ่งผิดจากที่หน้าจอสัญญาไว้
//
// รอบเดียวกับ heartbeat เพราะเกณฑ์ตัดออนไลน์คือ 2 นาที (ดู presenceState) —
// ถี่กว่านี้ไม่ได้ทำให้ตัวเลขแม่นขึ้น มีแต่จะยิง RPC ฟรี ๆ
export function usePresenceRefresh(enabled, onTick) {
  const tick = useRef(onTick);

  useEffect(() => {
    tick.current = onTick;
  });

  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => {
      if (document.visibilityState === "visible") tick.current();
    };

    const id = setInterval(run, HEARTBEAT_MS);
    // กลับมาที่แท็บแล้วรีเฟรชทันที ไม่ต้องรอรอบถัดไป — ระหว่างที่ซ่อนอยู่
    // interval ถูกเบราว์เซอร์หน่วงไว้ ข้อมูลบนจอจึงเก่ากว่าที่คิดเสมอ
    document.addEventListener("visibilitychange", run);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", run);
    };
  }, [enabled]);
}

// reloadKey เปลี่ยนบ่อยมาก (ทุก 60 วิจาก usePresenceRefresh, ทุกครั้งที่มาร์ก
// อ่านแล้ว/ส่งข้อความ) — keepPreviousData กันไม่ให้รายการห้องหล่นเป็น [] ชั่ว
// ขณะระหว่าง refetch ไม่งั้นทั้งแถบผู้สนทนาและป๊อปอัปที่เปิดอยู่จะกระพริบหาย
// แล้วโผล่กลับมาทุกรอบ
export function useConversations(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchConversations,
    `conversations:${reloadKey}`,
    EMPTY,
    { keepPreviousData: true },
  );

  return { conversations: data, loading, error };
}

// รายชื่อสมาชิกห้องกลุ่ม — ใช้โชว์ในหัวห้องแชท ไม่ผูกกับห้องคู่เพราะฝั่งเว็บ
// รู้จักชื่ออีกฝ่ายจาก display_name ของ list_my_conversations อยู่แล้ว
export function useConversationMembers(conversationId, reloadKey = 0) {
  const { data, loading } = useAsyncData(
    () => fetchConversationMembers(conversationId),
    conversationId ? `conversation-members:${conversationId}:${reloadKey}` : null,
    EMPTY,
  );

  return { members: data, loading };
}

// อีกฝ่ายอ่านถึงเวลาไหนแล้ว — ใช้ตัดสินว่าฟองข้อความของเราขึ้น "อ่านแล้ว" ได้
// หรือยัง เริ่มจากค่าที่มากับรายการห้อง (peerLastReadAt) แล้วขยับตาม event
// ของ Realtime ต่อไปเอง จึงไม่ต้องดึงรายการห้องใหม่ทั้งก้อนทุกครั้งที่อีกฝ่าย
// เปิดอ่าน
//
// เก็บคู่กับ conversationId เหมือน useConversationMessages เพื่อให้ค่าของห้อง
// เก่าไม่ค้างมาโชว์บนห้องใหม่ในรอบ render ที่เพิ่งสลับ
export function usePeerReadAt(conversationId, initialReadAt, myUserId) {
  const [state, setState] = useState({ key: null, at: null });

  useEffect(() => {
    if (!conversationId) return undefined;

    return subscribeToReadReceipts(conversationId, (row) => {
      // แถวของตัวเองไม่เกี่ยว — "อ่านแล้ว" หมายถึงอีกฝ่ายอ่านของเรา
      if (row.user_id === myUserId || !row.last_read_at) return;

      setState((current) => {
        const known = current.key === conversationId ? current.at : null;
        if (known && new Date(known) >= new Date(row.last_read_at)) return current;
        return { key: conversationId, at: row.last_read_at };
      });
    });
  }, [conversationId, myUserId]);

  const live = state.key === conversationId ? state.at : null;

  // ค่าที่สดกว่าชนะ — initialReadAt อาจใหม่กว่าถ้าเพิ่งโหลดรายการห้องมา
  if (!live) return initialReadAt ?? null;
  if (!initialReadAt) return live;

  return new Date(live) > new Date(initialReadAt) ? live : initialReadAt;
}

const byTime = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);

// รวมข้อความสองทางเข้าด้วยกันโดยตัดตัวซ้ำออกด้วย id — ข้อความหนึ่งข้อความมา
// ถึงได้ทั้งจากผลของ insert (เพื่อให้ฟองขึ้นจอทันทีไม่ต้องรอ) และจาก event
// ของ Realtime อีกรอบ
function merge(current, incoming) {
  const byId = new Map(incoming.map((item) => [item.id, item]));
  current.forEach((item) => byId.set(item.id, item));
  return [...byId.values()].sort(byTime);
}

// ข้อความในห้องเดียว — ไม่ใช้ useAsyncData เพราะรายการนี้ต้องโตต่อได้เองจาก
// event ของ Realtime หลังโหลดครั้งแรก ไม่ใช่ผลลัพธ์ก้อนเดียวที่นิ่งแล้ว
//
// เก็บ key คู่กับข้อมูลแบบเดียวกับ useAsyncData เพื่อให้ตอนสลับห้อง ค่าที่คืน
// กลับเป็น "กำลังโหลด" ทันทีในรอบ render เดียว ไม่มีจังหวะที่ข้อความของห้อง
// เก่าค้างอยู่บนจอของห้องใหม่ (และไม่ต้อง setState ใน effect ซึ่งทำให้ render
// ซ้อนกันหลายรอบ)
export function useConversationMessages(conversationId) {
  const [state, setState] = useState({ key: null, messages: EMPTY, error: "" });

  // เพิ่มหรือทับของเดิมด้วย id — ข้อความหนึ่งข้อความมาถึงได้หลายรอบ (ผลของ
  // insert เพื่อให้ฟองขึ้นจอทันที + event ของ Realtime) และยังถูกแก้ทีหลังได้
  // อีกเมื่อคนส่งกดลบ (0094) ซึ่งมาเป็น UPDATE ที่ต้องทับฟองเดิมในตำแหน่งเดิม
  const append = useCallback((message) => {
    setState((current) => {
      const known = current.key === message.conversationId ? current.messages : EMPTY;
      const existing = known.find((item) => item.id === message.id);

      // ตัวซ้ำที่ไม่มีอะไรเปลี่ยน — ไม่ต้อง setState ให้ทั้งห้อง re-render ฟรี ๆ
      if (existing && existing.deleted === message.deleted) return current;

      return {
        key: message.conversationId,
        messages: existing
          ? known.map((item) => (item.id === message.id ? message : item))
          : [...known, message].sort(byTime),
        error: "",
      };
    });
  }, []);

  useEffect(() => {
    if (!conversationId) return undefined;

    let alive = true;

    // subscribe ก่อนแล้วค่อย fetch — ถ้ามีข้อความเข้ามาระหว่างรอ fetch จะถูก
    // append ไว้ก่อน แล้ว merge() ตอน fetch เสร็จเก็บมันไว้ ไม่ทับหาย
    const unsubscribe = subscribeToMessages(conversationId, (message) => {
      if (alive) append(message);
    });

    fetchMessages(conversationId)
      .then((rows) => {
        if (!alive) return;
        setState((current) => ({
          key: conversationId,
          messages: merge(current.key === conversationId ? current.messages : EMPTY, rows),
          error: "",
        }));
      })
      .catch((err) => {
        console.error("โหลดข้อความไม่สำเร็จ:", err);
        if (!alive) return;
        setState({ key: conversationId, messages: EMPTY, error: errorMessage(err) });
      });

    return () => {
      alive = false;
      unsubscribe();
    };
  }, [conversationId, append]);

  const settled = state.key === conversationId;

  return {
    messages: settled ? state.messages : EMPTY,
    loading: Boolean(conversationId) && !settled,
    error: settled ? state.error : "",
    append,
  };
}
