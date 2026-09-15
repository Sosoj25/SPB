// ข่าวประชาสัมพันธ์ — ทั้งฝั่งแอดมินที่เขียน/ตั้งเวลาเผยแพร่ และฝั่งผู้อ่าน
//
// ไฟล์นี้มีสามส่วน: จัดการข่าวของแอดมิน, หน้ารวมข่าวสาธารณะ และการจำว่า
// ผู้ใช้อ่านข่าวไหนไปแล้ว (สำหรับป้ายข่าวใหม่)
import { supabase } from "./supabase";
import { assertImageFile, imageExt, removeStorageFolder } from "./uploads";
import { stripNewsFormatting } from "./newsContent";

const NEWS_SELECT = `
  id,
  title,
  subtitle,
  content,
  cover_image,
  status,
  category,
  tags,
  is_featured,
  notify_message,
  view_count,
  published_at,
  created_at,
  updated_at,
  profiles ( full_name, username )
`;

function toNews(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? "",
    content: row.content,
    coverImage: row.cover_image,
    status: row.status,
    category: row.category,
    tags: row.tags ?? [],
    isFeatured: row.is_featured,
    notifyMessage: row.notify_message ?? "",
    viewCount: row.view_count,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.profiles?.full_name || row.profiles?.username || "",
    // สถานะ "ตั้งเวลา" ไม่มีคอลัมน์ของตัวเอง — derive จาก published_at ที่ยังไม่ถึง
    // (ดู news_public_read ใน 0018 ที่กันไม่ให้ข่าวลักษณะนี้โชว์สาธารณะก่อนถึงเวลา)
    isScheduled:
      row.status === "published" && row.published_at && new Date(row.published_at) > new Date(),
  };
}

export const NEWS_CATEGORIES = ["การแข่งขัน", "กิจกรรม", "ประกาศ", "โปรโมชัน"];

export const ADMIN_NEWS_PAGE_SIZE = 5;

export async function fetchAdminNews({
  category,
  query,
  page = 1,
  limit = ADMIN_NEWS_PAGE_SIZE,
} = {}) {
  let q = supabase
    .from("news")
    .select(NEWS_SELECT)
    .order("created_at", { ascending: false });

  if (category) q = q.eq("category", category);
  if (query) q = q.ilike("title", `%${query.replace(/[%_,()]/g, "")}%`);

  const from = (page - 1) * limit;
  const { data, error } = await q.range(from, from + limit);

  if (error) throw error;

  const rows = (data ?? []).map(toNews);
  return { news: rows.slice(0, limit), hasMore: rows.length > limit };
}

// นับแยกตามสถานะสำหรับการ์ด KPI บนหัวหน้า — ให้ admin_news_stats() (0021)
// นับที่ฝั่ง DB คำสั่งเดียว ห้ามดึงทุกแถวมาบวกฝั่ง client เพราะโตตามจำนวนข่าว
// ไปเรื่อย ๆ โดยไม่มีเพดาน
export async function fetchAdminNewsStats() {
  const { data, error } = await supabase.rpc("admin_news_stats");

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    published: row?.published_count ?? 0,
    draft: row?.draft_count ?? 0,
    scheduled: row?.scheduled_count ?? 0,
    totalViews: Number(row?.total_views ?? 0),
  };
}

export async function fetchNewsById(id) {
  const { data, error } = await supabase.from("news").select(NEWS_SELECT).eq("id", id).single();

  if (error) throw error;
  return toNews(data);
}

function fromNewsPayload(payload) {
  const row = {};
  if ("title" in payload) row.title = payload.title;
  if ("subtitle" in payload) row.subtitle = payload.subtitle || null;
  if ("content" in payload) row.content = payload.content;
  if ("coverImage" in payload) row.cover_image = payload.coverImage || null;
  if ("status" in payload) row.status = payload.status;
  if ("category" in payload) row.category = payload.category;
  if ("tags" in payload) row.tags = payload.tags;
  if ("isFeatured" in payload) row.is_featured = payload.isFeatured;
  if ("notifyMessage" in payload) row.notify_message = payload.notifyMessage || null;
  if ("publishedAt" in payload) row.published_at = payload.publishedAt;
  if ("authorId" in payload) row.author_id = payload.authorId;
  return row;
}

export async function createNews(payload) {
  const { data, error } = await supabase
    .from("news")
    .insert(fromNewsPayload(payload))
    .select(NEWS_SELECT)
    .single();

  if (error) throw error;
  return toNews(data);
}

export async function updateNews(id, payload) {
  const { data, error } = await supabase
    .from("news")
    .update(fromNewsPayload(payload))
    .eq("id", id)
    .select(NEWS_SELECT)
    .single();

  if (error) throw error;
  return toNews(data);
}

export async function deleteNews(id) {
  const { error } = await supabase.from("news").delete().eq("id", id);
  if (error) throw error;

  // ลบรูปปกที่ผูกกับข่าวนี้ตามไปด้วย ไม่งั้นไฟล์ค้างอยู่ใน bucket ตลอดไป
  // โดยไม่มีอะไรอ้างถึง (ทำหลังลบแถวสำเร็จ ถ้าลบแถวไม่ผ่านก็ไม่ควรแตะไฟล์)
  await removeStorageFolder("news", id);
}

// path ไม่ผูกกับ user เหมือน avatars (bucket news เขียนได้เฉพาะ admin ทั้งทีม
// อยู่แล้ว ดู 0018) — ใช้ news id + timestamp กันชื่อไฟล์ชนกัน
export async function uploadNewsCoverImage(file, newsId) {
  assertImageFile(file);

  const path = `${newsId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("news").upload(path, file, { upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from("news").getPublicUrl(path);
  return data.publicUrl;
}

// ---------- หน้ารวมข่าวสาธารณะ ----------

const PUBLIC_NEWS_SELECT = `
  id,
  title,
  subtitle,
  content,
  cover_image,
  category,
  is_featured,
  notify_message,
  published_at
`;

function toPublicNews(row) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? "",
    content: row.content,
    excerpt: stripNewsFormatting(row.content).slice(0, 140),
    coverImage: row.cover_image,
    category: row.category,
    isFeatured: row.is_featured,
    notifyMessage: row.notify_message ?? "",
    publishedAt: row.published_at,
  };
}

// RLS (news_public_read, 0018) กรองให้เหลือแค่ข่าวที่เผยแพร่แล้วและถึงเวลาจริง
// อยู่แล้ว — ฝั่งนี้แค่เรียงและตัดจำนวน
export async function fetchPublicNews({ limit = 20 } = {}) {
  const { data, error } = await supabase
    .from("news")
    .select(PUBLIC_NEWS_SELECT)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []).map(toPublicNews);
}

// สำหรับหน้ารายละเอียดข่าวของ user — ใช้ select ชุดเดียวกับหน้ารวม (ไม่มี
// status/view_count/profiles) เพราะ RLS ข้างต้นกันข่าวที่ยังไม่เผยแพร่ไว้แล้ว
// แถวจะไม่ถูกส่งกลับมาเลยถ้ายังไม่ถึงเวลาเผยแพร่หรือเป็นฉบับร่าง
export async function fetchPublicNewsById(id) {
  const { data, error } = await supabase
    .from("news")
    .select(PUBLIC_NEWS_SELECT)
    .eq("id", id)
    .single();

  if (error) throw error;
  return toPublicNews(data);
}

// ฟังข่าวใหม่/แก้ไข/ลบแบบเรียลไทม์ (news ต้องอยู่ใน publication supabase_realtime
// ก่อน ดู 0071_news_realtime.sql) — เหมือน subscribeToNotifications ใน
// lib/notifications.js: postgres_changes เคารพ RLS ของตารางเอง (news_public_read,
// 0018) จึงไม่ต้องใส่ filter เพิ่ม ผู้ใช้จะได้รับ event เฉพาะแถวที่เผยแพร่แล้ว
// และถึงเวลาจริงเท่านั้น
//
// ชื่อ channel ต้องไม่ซ้ำกันข้ามการเรียกแต่ละครั้งด้วยเหตุผลเดียวกับ
// notificationChannelSeq — usePublicNews ถูกเรียกพร้อมกันได้จากหลายจุด
// (AppHeader ผ่าน useHasUnseenNews + News.jsx) แต่ละจุดต้องได้ channel ของตัวเอง
let newsChannelSeq = 0;

export function subscribeToPublicNews(onChange) {
  const channel = supabase
    .channel(`public-news:${++newsChannelSeq}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "news" }, onChange)
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// ---------- ข่าวที่ยังไม่เคยอ่าน (badge บนปุ่ม "ข่าว" + ป้ายหมวดใหม่) ----------

// จำเป็น "รายข่าว" ว่าอ่านไปแล้วหรือยัง ไม่ใช่จำแค่เวลาเข้าหน้า /news ล่าสุด
// — ถ้าจำแค่เวลา แค่เปิดหน้ารวมข่าวก็จะถือว่าอ่านทุกข่าวในหน้านั้นแล้วทันที
// ป้ายข่าวใหม่ของทุกหมวดจะหายพร้อมกันทั้งที่ยังไม่ได้อ่าน
//
// เก็บใน localStorage แยกตาม user — เป็นค่าของ "เครื่อง/เบราว์เซอร์นี้"
// ไม่ใช่สถานะกลางที่ต้องซิงก์ข้ามอุปกรณ์ จึงไม่ต้องมีตารางในฐานข้อมูล
const NEWS_READ_STORAGE_PREFIX = "spb.news.readIds.v1";

// กันรายการยาวไม่รู้จบ — fetchPublicNews ดึงมาแค่ 60 ข่าวล่าสุดอยู่แล้ว
// (ดู usePublicNews) เก่ากว่านี้ไม่โผล่ในหน้ารวมให้ต้องเทียบอยู่ดี
const MAX_TRACKED_READ_IDS = 200;

const readIdsKey = (userId) => `${NEWS_READ_STORAGE_PREFIX}.${userId}`;

export function loadReadNewsIds(userId) {
  if (!userId) return new Set();
  try {
    const raw = window.localStorage.getItem(readIdsKey(userId));
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    // โหมดส่วนตัว/เบราว์เซอร์ที่บล็อก storage หรือ JSON เสีย — ไม่ต้องพัง
    // แค่ไม่มีป้ายข่าวใหม่ให้ตัด
    return new Set();
  }
}

export function markNewsRead(userId, newsId) {
  if (!userId || newsId == null) return;
  try {
    const ids = loadReadNewsIds(userId);
    ids.add(String(newsId));
    window.localStorage.setItem(
      readIdsKey(userId),
      JSON.stringify([...ids].slice(-MAX_TRACKED_READ_IDS)),
    );
  } catch {
    // เช่นเดียวกับด้านบน
  }
}

export function isNewsUnseen(news, readIds) {
  return !readIds.has(String(news.id));
}
