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

// นับแยกตามสถานะสำหรับการ์ด KPI บนหัวหน้า
//
// เดิมเป็นสี่ query ซ้อนกัน และอันสุดท้ายดึง view_count ของ "ทุกแถว" กลับมา
// บวกกันฝั่ง client เพื่อให้ได้เลขเดียว — โตตามจำนวนข่าวไปเรื่อย ๆ ไม่มี
// เพดาน ตอนนี้ให้ admin_news_stats() (0021) นับให้ในคำสั่งเดียวที่ฝั่ง DB
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
