// แชท — ตาราง conversations / conversation_members / messages เพิ่มใน 0041
//
// การสร้างห้องและการทำเครื่องหมายว่าอ่านแล้วไม่ได้ยิง insert/update ตรง ๆ
// เพราะสองตารางนั้นตั้งใจไม่มี policy INSERT/UPDATE เลย ทุกอย่างผ่าน RPC
// security definer ที่ล็อก auth.uid() ไว้ข้างใน คนอื่นจึงยัดตัวเองเข้าห้อง
// ที่ไม่ได้ถูกเชิญไม่ได้
import { supabase } from "./supabase";
import { assertImageFile, imageExt } from "./uploads";

export const THREAD_FILTERS = ["ทั้งหมด", "ยังไม่อ่าน", "กลุ่ม"];

// ตัวเลือกระยะเวลาปิดการแจ้งเตือน — minutes null = ปิดยาวจนกว่าจะกดเปิดเอง
// (RPC mute_conversation แปลงเป็น 'infinity' ให้ ดู 0094) ชุดเดียวกับที่
// Messenger/LINE ใช้ เพราะเคสจริงคือ "ประชุมอยู่" กับ "นอนแล้ว" เป็นหลัก
export const MUTE_OPTIONS = [
  { label: "15 นาที", minutes: 15 },
  { label: "1 ชั่วโมง", minutes: 60 },
  { label: "8 ชั่วโมง", minutes: 480 },
  { label: "จนกว่าจะเปิดเอง", minutes: null },
];

// ชุดอีโมจิที่ใช้บ่อยในบริบทนัดเล่นกีฬา — ตั้งใจไม่โหลดไลบรารี emoji picker
// เพิ่ม (ตัวที่นิยมกันหนัก 200–400 kB) เพราะแค่ต้องการปุ่มลัดไม่กี่ตัว ส่วน
// อีโมจิเต็มชุดผู้ใช้เรียกจากคีย์บอร์ดของเครื่องตัวเองได้อยู่แล้ว — ใช้ร่วมกัน
// ทั้งหน้า /messages เต็มจอและหน้าต่างแชทลอย (ChatPopup)
export const EMOJI_SET = [
  "😀", "😄", "😅", "😂", "🙂", "😉", "😍", "😘",
  "🤝", "👍", "👏", "🙏", "💪", "🔥", "✨", "🎉",
  "⚽", "🏀", "🏸", "🏐", "🎾", "🏆", "🥅", "🏃",
  "😢", "😭", "😡", "😴", "🤔", "👀", "❤️", "💯",
];

// ใช้ร่วมกันทั้งหน้า /messages เต็มจอและแผงแชทลัดบนหัวเว็บ (ChatFlyout) —
// กรองจากรายการที่ดึงมาแล้วในเครื่อง ไม่ยิงคิวรีใหม่ต่อการเปลี่ยนตัวกรอง/พิมพ์ค้นหา
export function filterConversations(conversations, filter, query) {
  const term = (query ?? "").trim().toLowerCase();

  return conversations.filter((c) => {
    if (filter === "ยังไม่อ่าน" && c.unread === 0) return false;
    if (filter === "กลุ่ม" && !c.isGroup) return false;
    return !term || c.name.toLowerCase().includes(term);
  });
}

export async function fetchConversations() {
  const { data, error } = await supabase.rpc("list_my_conversations");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    isGroup: row.is_group,
    otherUserId: row.other_user_id,
    name: row.display_name,
    avatar: row.avatar_url,
    // ข้อความล่าสุดที่เป็นรูปล้วนไม่มี content ให้แสดง — บอกว่าเป็นรูปแทน
    // ไม่ใช่ปล่อยว่างจนดูเหมือนห้องที่ยังไม่มีใครพิมพ์อะไร
    preview: row.last_deleted
      ? "ข้อความถูกลบแล้ว"
      : row.last_message || (row.last_has_image ? "📷 รูปภาพ" : ""),
    lastMessageAt: row.last_message_at,
    unread: row.unread_count ?? 0,
    lastSenderId: row.last_sender_id,
    myLastReadAt: row.my_last_read_at,
    // เวลาที่อีกฝ่าย (คนที่ตามอ่านช้าที่สุดในห้องกลุ่ม) อ่านถึง — ใช้ตัดสินว่า
    // ข้อความของเราขึ้น "อ่านแล้ว" ได้หรือยัง
    peerLastReadAt: row.peer_last_read_at,
    otherLastSeenAt: row.other_last_seen_at,
    memberCount: row.member_count ?? 0,
    // การตั้งค่าของเราต่อห้องนี้ (0094) — ทั้งสามค่าเป็นของเราคนเดียว คนอื่น
    // ในห้องเดียวกันเห็นค่าของตัวเอง
    mutedUntil: row.muted_until,
    isPinned: Boolean(row.is_pinned),
    clearedAt: row.my_cleared_at,
    // blockedByMe = เราเป็นคนบล็อก (เลิกบล็อกเองได้) ส่วน blockedAny รวมทาง
    // ที่อีกฝ่ายบล็อกเราด้วย ซึ่งบอกได้แค่ว่าส่งไม่ได้ ไม่บอกว่าใครบล็อกใคร
    blockedByMe: Boolean(row.blocked_by_me),
    blockedAny: Boolean(row.blocked_any),
  }));
}

// ปิดเสียงอยู่ไหม ณ ตอนนี้ — muted_until เก็บเป็นเวลาหมดอายุ ไม่ใช่ boolean
// ห้องที่ปิดไว้ 1 ชั่วโมงจึงกลับมาดังเองโดยไม่ต้องมีใครไปเคลียร์ค่า
export function isMuted(mutedUntil) {
  if (!mutedUntil) return false;

  const until = new Date(mutedUntil).getTime();
  // 'infinity' จาก Postgres มาถึงเป็นสตริงที่ Date แปลงเป็น NaN — ถือว่าปิดถาวร
  return Number.isNaN(until) || until > Date.now();
}

// ป้ายบอกว่าปิดเสียงถึงเมื่อไหร่ ใช้ในเมนูจัดการห้อง
export function muteLabel(mutedUntil) {
  if (!isMuted(mutedUntil)) return "";

  const until = new Date(mutedUntil).getTime();
  if (Number.isNaN(until)) return "ปิดการแจ้งเตือนอยู่";

  const minutes = Math.max(1, Math.round((until - Date.now()) / 60000));
  if (minutes < 60) return `ปิดเสียงอีก ${minutes} นาที`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `ปิดเสียงอีก ${hours} ชั่วโมง`;

  return `ปิดเสียงอีก ${Math.round(hours / 24)} วัน`;
}

// เรียงจากใหม่ไปเก่าแล้วจำกัดจำนวนก่อน ถึงจะได้ข้อความ "ล่าสุด" จริง ๆ —
// เรียง created_at ขึ้นตรง ๆ แล้ว limit จะได้ข้อความเก่าสุดแทน ห้องที่คุยเกิน
// จำนวน limit จะค้างไม่เห็นข้อความใหม่เลย จึงต้องกลับลำดับหลังดึงมาอีกที
export async function fetchMessages(conversationId, limit = 100) {
  const { data, error } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, image_url, created_at, deleted_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).reverse().map(toMessage);
}

export function toMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    content: row.content ?? "",
    imageUrl: row.image_url,
    createdAt: row.created_at,
    // ข้อความที่ถูกลบยังอยู่ในลำดับเวลาเดิม แต่เนื้อหาถูกล้างทิ้งจากฐานข้อมูล
    // แล้ว (0094) — หน้าเว็บวาดเป็นฟองจาง ๆ ว่า "ข้อความถูกลบแล้ว"
    deleted: Boolean(row.deleted_at),
  };
}

// ส่งข้อความ รูป หรือทั้งสองอย่างพร้อมกัน — constraint messages_not_empty
// (0041) บังคับให้ต้องมีอย่างน้อยหนึ่งอย่าง ฝั่งนี้จึงกันไว้ก่อนไม่ให้ยิงคำขอ
// ที่รู้อยู่แล้วว่าจะถูกปฏิเสธ
export async function sendMessage({ conversationId, userId, content, imageUrl }) {
  const text = (content ?? "").trim();
  if (!text && !imageUrl) return null;

  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      sender_id: userId,
      content: text || null,
      image_url: imageUrl ?? null,
    })
    .select("id, conversation_id, sender_id, content, image_url, created_at, deleted_at")
    .single();

  if (error) throw error;
  return toMessage(data);
}

// รูปในแชทใช้ bucket 'community' ตัวเดิม (0041) — policy ของ bucket นั้นล็อกให้
// เขียนได้เฉพาะในโฟลเดอร์ที่ชื่อตรงกับ user id ของตัวเอง จึงต้องขึ้นต้น path
// ด้วย userId เสมอ ส่วนโฟลเดอร์ chat/<conversationId> เป็นแค่การจัดระเบียบ
export async function uploadChatImage(file, userId, conversationId) {
  assertImageFile(file);

  const path = `${userId}/chat/${conversationId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("community").upload(path, file);
  if (error) throw error;

  const { data } = supabase.storage.from("community").getPublicUrl(path);
  return data.publicUrl;
}

export async function startDirectConversation(otherUserId) {
  const { data, error } = await supabase.rpc("start_direct_conversation", {
    p_other_user: otherUserId,
  });

  if (error) throw error;
  return data;
}

// สร้างห้องกลุ่ม — validation (ชื่อ/จำนวนสมาชิกขั้นต่ำ) ทำที่ RPC ทั้งหมด
// (0051) ฝั่งนี้แค่ส่งต่อ error ให้อ่านรู้เรื่อง
export async function createGroupConversation({ title, memberIds }) {
  const { data, error } = await supabase.rpc("create_group_conversation", {
    p_title: title,
    p_member_ids: memberIds,
  });

  if (error) throw error;
  return data;
}

export async function fetchConversationMembers(conversationId) {
  const { data, error } = await supabase.rpc("list_conversation_members", {
    p_conversation: conversationId,
  });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.user_id,
    name: row.name,
    avatar: row.avatar_url,
    lastReadAt: row.last_read_at,
    lastSeenAt: row.last_seen_at,
  }));
}

export async function addConversationMembers(conversationId, memberIds) {
  const { error } = await supabase.rpc("add_conversation_members", {
    p_conversation: conversationId,
    p_member_ids: memberIds,
  });

  if (error) throw error;
}

export async function leaveConversation(conversationId) {
  const { error } = await supabase.rpc("leave_conversation", {
    p_conversation: conversationId,
  });

  if (error) throw error;
}

export async function markConversationRead(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_read", {
    p_conversation: conversationId,
  });

  if (error) throw error;
}

// ---------- จัดการห้อง (0094) ----------
//
// ทั้งหมดเป็น RPC security definer ที่ล็อก auth.uid() ไว้ข้างใน เพราะ
// conversation_members ตั้งใจไม่มี policy UPDATE ให้ยิงตรง

// minutes = null หมายถึงปิดยาวจนกว่าจะกดเปิดเอง
export async function muteConversation(conversationId, minutes = null) {
  const { data, error } = await supabase.rpc("mute_conversation", {
    p_conversation: conversationId,
    p_minutes: minutes,
  });

  if (error) throw error;
  return data;
}

export async function unmuteConversation(conversationId) {
  const { error } = await supabase.rpc("unmute_conversation", {
    p_conversation: conversationId,
  });

  if (error) throw error;
}

export async function setConversationPinned(conversationId, pinned) {
  const { error } = await supabase.rpc("set_conversation_pinned", {
    p_conversation: conversationId,
    p_pinned: pinned,
  });

  if (error) throw error;
}

// "ลบแชท" — ล้างประวัติเฉพาะฝั่งเรา ห้องหายจากรายการจนกว่าจะมีข้อความใหม่
export async function clearConversation(conversationId) {
  const { error } = await supabase.rpc("clear_conversation", {
    p_conversation: conversationId,
  });

  if (error) throw error;
}

export async function markConversationUnread(conversationId) {
  const { error } = await supabase.rpc("mark_conversation_unread", {
    p_conversation: conversationId,
  });

  if (error) throw error;
}

// ลบข้อความของตัวเอง — ลบให้ทุกคนในห้องเห็นตรงกัน ไม่ใช่ซ่อนฝั่งเดียว
export async function deleteMessage(messageId) {
  const { error } = await supabase.rpc("delete_message", { p_message: messageId });
  if (error) throw error;
}

// ---------- บล็อกผู้ใช้ ----------

export async function blockUser(userId) {
  const { error } = await supabase.rpc("block_user", { p_user: userId });
  if (error) throw error;
}

export async function unblockUser(userId) {
  const { error } = await supabase.rpc("unblock_user", { p_user: userId });
  if (error) throw error;
}

export async function fetchBlockedUsers() {
  const { data, error } = await supabase.rpc("list_blocked_users");
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.user_id,
    name: row.name,
    avatar: row.avatar_url,
    blockedAt: row.blocked_at,
  }));
}

// ใช้กับเคสที่ยังไม่มีห้อง (?to=<userId> จากปุ่มส่งข้อความในโพสต์/โปรไฟล์) —
// ห้องที่มีอยู่แล้วรู้สถานะบล็อกจาก list_my_conversations อยู่แล้ว
//
// คืนแค่ true/false ไม่บอกว่าใครเป็นคนบล็อก (ดูเหตุผลใน 0094)
export async function isBlockedWith(userId) {
  const { data, error } = await supabase.rpc("is_blocked_with", { p_user: userId });
  if (error) throw error;
  return Boolean(data);
}

// ฟังข้อความใหม่ของห้องเดียว — postgres_changes เคารพ RLS ของ messages อยู่แล้ว
// (ดู 0041) คนนอกห้องจึงไม่ได้รับ event ถึงจะ subscribe ชื่อ channel เดียวกัน
//
// ฟัง UPDATE ด้วยเพราะการลบข้อความ (0094) ไม่ได้ลบแถวทิ้ง แต่ล้างเนื้อหาแล้ว
// ประทับ deleted_at — ฟองของอีกฝ่ายจึงต้องเปลี่ยนเป็น "ข้อความถูกลบแล้ว" เอง
// ทันที ไม่ใช่รอให้เขากดรีเฟรชหน้า ผู้รับ event ใช้ตัวเดียวกันทั้งสองกรณี
// เพราะฝั่งนั้นรวมข้อความด้วย id อยู่แล้ว (append ใน useConversationMessages)
//
// คืน unsubscribe ให้ผู้เรียกไปใช้ใน cleanup ของ useEffect — ถ้าลืมถอด channel
// จะค้างสะสมทุกครั้งที่ผู้ใช้กดสลับห้อง
//
// ชื่อ channel ต้องไม่ซ้ำข้ามการเรียกแต่ละครั้ง เหมือน subscribeToNotifications
// ใน lib/notifications.js — เดิมสองตัวข้างล่างใช้ชื่อคงที่ (`messages:<id>`) แล้ว
// เจอบั๊กนี้:
//
//   RealtimeClient.channel(topic) หา topic ซ้ำแล้วคืน "instance เดิม" ไม่ได้
//   สร้างใหม่ ส่วน removeChannel() ต้อง await unsubscribe() รอ reply จาก
//   เซิร์ฟเวอร์ก่อน channel เก่าถึงจะหลุดออกจาก client.channels
//
//   ช่วงคาบเกี่ยวนั้น ถ้ามีใครขอ topic เดิมอีกครั้งจะได้ instance ที่ join ไปแล้ว
//   กลับมา แล้ว subscribe() รอบสองชน `if (joinedOnce) throw new Error("tried to
//   join multiple times...")` — throw ออกมาใน useEffect หน้าแชทพังทั้งหน้า
//
// จังหวะที่ชนจริงคือสลับห้องไปกลับเร็ว ๆ (A -> B -> A) หรือปิดป๊อปอัปแชทแล้วเข้า
// /messages ห้องเดิมทันที ต่อ counter ท้ายชื่อแล้วทุกการเรียกได้ channel ของ
// ตัวเองเสมอ ไม่ต้องไปลุ้นว่าตัวเก่าถอดเสร็จหรือยัง
let messageChannelSeq = 0;

export function subscribeToMessages(conversationId, onChange) {
  const filter = `conversation_id=eq.${conversationId}`;

  const channel = supabase
    .channel(`messages:${conversationId}:${++messageChannelSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter },
      (payload) => onChange(toMessage(payload.new)),
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "messages", filter },
      (payload) => onChange(toMessage(payload.new)),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ฟังสถานะ "อ่านแล้ว" ของห้องที่เปิดอยู่ — mark_conversation_read() ยิง UPDATE
// ลง conversation_members ซึ่ง 0057 พาเข้า publication แล้ว ติ๊กอ่านแล้วจึงขึ้น
// เองตอนอีกฝ่ายเปิดห้อง ไม่ต้องรอให้เรากดรีเฟรช
let readReceiptChannelSeq = 0;

export function subscribeToReadReceipts(conversationId, onChange) {
  const channel = supabase
    .channel(`read-receipts:${conversationId}:${++readReceiptChannelSeq}`)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversation_members",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onChange(payload.new),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ฟังข้อความใหม่ทุกห้องแบบเรียลไทม์ — ไม่ใส่ filter conversation_id เพราะ
// ต้องการทุกห้องที่เราอยู่ RLS (messages_member_read) กรองให้เหลือเฉพาะห้องที่
// เป็นสมาชิกอยู่แล้วเหมือน subscribeToReports ใน lib/adminCommunity.js ใช้เป็น
// ตัวสั่งรีเฟรชยอดรวมป้าย "ข้อความ" บนเมนู ไม่ได้ต่อฟองข้อความเข้าจอตรง ๆ
//
// ฟัง conversation_members UPDATE ของตัวเองด้วย — mark_conversation_read()
// เขียน last_read_at ของเราเอง ยอดนับต้องลดตามทันทีตอนกดเข้าห้องอ่าน ไม่ต้อง
// รอสลับหน้าไปมา
//
// ชื่อ channel ต้องไม่ซ้ำกันข้ามการเรียกแต่ละครั้ง เหมือน
// subscribeToNotifications ใน lib/notifications.js — เผื่อมีมากกว่าหนึ่งจุด
// เรียกพร้อมกัน .channel(topic) ซ้ำชื่อจะได้ instance เดิมที่ subscribe()
// ไปแล้ว แล้ว .on() ซ้ำจะ throw ทันที
let unreadMessagesChannelSeq = 0;

export function subscribeToUnreadMessages(userId, onChange) {
  const channel = supabase
    .channel(`unread-messages:${userId}:${++unreadMessagesChannelSeq}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, onChange)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "conversation_members",
        filter: `user_id=eq.${userId}`,
      },
      onChange,
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// บอกระบบว่ายังใช้งานอยู่ — เขียนจริงเฉพาะตอนค่าเดิมเก่าเกิน 30 วิ (0057)
// เรียกถี่กว่านั้นได้โดยไม่เปลือง write
export async function touchPresence() {
  const { error } = await supabase.rpc("touch_presence");
  if (error) throw error;
}

// ---------- ออนไลน์ / ออฟไลน์ ----------
//
// ถือว่า "ออนไลน์" ถ้าเพิ่งส่ง heartbeat มาไม่เกิน 2 นาที — กว้างกว่าช่วง
// heartbeat (60 วิ) เท่าตัว เผื่อรอบที่พลาดไปหนึ่งครั้งจากเน็ตสะดุด ไม่งั้น
// สถานะจะกระพริบเข้าออกตลอดเวลาทั้งที่คนยังนั่งอยู่หน้าจอ
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

export function presenceState(lastSeenAt) {
  if (!lastSeenAt) return { online: false, label: "ไม่ทราบสถานะ", short: "ออฟไลน์" };

  const elapsed = Date.now() - new Date(lastSeenAt).getTime();

  if (elapsed <= ONLINE_WINDOW_MS) {
    return { online: true, label: "ออนไลน์", short: "ออนไลน์" };
  }

  const minutes = Math.floor(elapsed / 60000);

  if (minutes < 60) {
    const text = `ใช้งานล่าสุด ${minutes} นาทีที่แล้ว`;
    return { online: false, label: text, short: `${minutes} นาที` };
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    const text = `ใช้งานล่าสุด ${hours} ชั่วโมงที่แล้ว`;
    return { online: false, label: text, short: `${hours} ชม.` };
  }

  const days = Math.floor(hours / 24);

  // เกินสัปดาห์แล้วบอกจำนวนวันต่อไปก็ไม่ได้ให้ข้อมูลเพิ่ม — สรุปเป็น "นานแล้ว"
  if (days <= 7) {
    const text = `ใช้งานล่าสุด ${days} วันที่แล้ว`;
    return { online: false, label: text, short: `${days} วัน` };
  }

  return { online: false, label: "ไม่ได้ใช้งานมานาน", short: "นานแล้ว" };
}

const timeFormatter = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
});

export const messageTime = (value) => (value ? timeFormatter.format(new Date(value)) : "");

const dayFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });

// หัวคั่นวันระหว่างฟองข้อความ — วันนี้/เมื่อวาน แล้วค่อยเป็นวันที่จริง
export function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  if (sameDay(date, today)) return "วันนี้";
  if (sameDay(date, yesterday)) return "เมื่อวาน";
  return dayFormatter.format(date);
}

// เวลาในรายการห้องแชทฝั่งซ้าย — วันนี้โชว์เป็นเวลา เกินกว่านั้นโชว์เป็นวัน
export function conversationTime(value) {
  if (!value) return "";
  const label = dayLabel(value);
  return label === "วันนี้" ? messageTime(value) : label;
}
