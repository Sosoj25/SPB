// หน้าแอดมิน "จัดการชุมชน" — คิวรายงาน โพสต์ ความคิดเห็น และหมวดหมู่
// (ต่อกับ view/RPC ที่เพิ่มใน 0043)
//
// การซ่อน/ปักหมุด/ลบ ยิง update ตรง ๆ ได้เลย ไม่ต้องผ่าน RPC เพราะ
// posts_update_own กับ posts_delete_own (0000) มี `or is_admin()` อยู่แล้ว
// ส่วนการปิดคิวรายงานต้องแตะสองตารางพร้อมกันจึงต้องผ่าน admin_resolve_report
//
// ฝั่งผู้ใช้ทั่วไปของชุมชนอยู่ที่ lib/community.js
import { supabase } from "./supabase";
import { escapeSearchTerm } from "./searchTerm";
import {
  REPORT_REASON_GROUPS,
  SYSTEM_ONLY_CATEGORY,
  reportReasonGroup,
  reportReasonLabel,
} from "./community";

export const POST_FILTERS = [
  { key: "all", label: "ทั้งหมด" },
  { key: "reported", label: "ถูกรายงาน" },
  { key: "pinned", label: "ปักหมุด" },
  { key: "hidden", label: "ซ่อนแล้ว" },
];

export const ADMIN_POSTS_PAGE_SIZE = 20;

// ตัวกรองคิวรายงานตามหมวด — "ทั้งหมด" ต้องมาก่อนเสมอ
export const REPORT_FILTERS = [
  { key: "", label: "ทุกประเภท", reasons: null },
  ...REPORT_REASON_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    reasons: group.reasons.map((item) => item.value),
  })),
];

const ADMIN_POST_SELECT = `
  id,
  user_id,
  category_id,
  category_name,
  title,
  content,
  status,
  is_pinned,
  hidden_by,
  created_at,
  author_username,
  author_full_name,
  author_avatar_url,
  author_is_active,
  like_count,
  comment_count,
  pending_report_count
`;

function toAdminPost(row) {
  return {
    id: row.id,
    userId: row.user_id,
    category: row.category_name ?? "ไม่ระบุหมวด",
    title: row.title ?? "",
    content: row.content ?? "",
    status: row.status,
    isPinned: row.is_pinned,
    // แยก "แอดมินซ่อน" ออกจาก "เจ้าของซ่อนเอง" — สองอย่างนี้กดเลิกซ่อนได้
    // ไม่เหมือนกัน (ดู trigger ใน 0043)
    hiddenByAdmin: Boolean(row.hidden_by),
    createdAt: row.created_at,
    author: row.author_full_name || row.author_username || "ผู้ใช้ไม่ระบุตัวตน",
    authorAvatar: row.author_avatar_url,
    authorSuspended: row.author_is_active === false,
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    reportCount: row.pending_report_count ?? 0,
  };
}

export async function fetchAdminStats() {
  const { data, error } = await supabase.rpc("admin_community_stats");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    totalPosts: row?.total_posts ?? 0,
    totalComments: row?.total_comments ?? 0,
    pendingReports: row?.pending_reports ?? 0,
    newReports24h: row?.new_reports_24h ?? 0,
    flaggedPosts: row?.flagged_posts ?? 0,
    flaggedComments: row?.flagged_comments ?? 0,
    hiddenPosts: row?.hidden_posts ?? 0,
    pinnedPosts: row?.pinned_posts ?? 0,
    suspendedMembers: row?.suspended_members ?? 0,
    totalMembers: row?.total_members ?? 0,
  };
}

// limit+1 เพื่อรู้ว่ามีหน้าถัดไปไหมโดยไม่ต้องยิง count แยก — pattern เดียวกับ
// fetchAdminNews ใน lib/news.js
export async function fetchAdminPosts({
  filter = "all",
  query,
  page = 1,
  limit = ADMIN_POSTS_PAGE_SIZE,
} = {}) {
  const from = (page - 1) * limit;

  // count: "exact" เพื่อให้บรรทัด "แสดง N จาก M" ท้ายตารางบอกยอดของ "ตัวกรอง
  // ที่เลือกอยู่" จริง ๆ ไม่ใช่ยอดโพสต์ทั้งระบบ
  let q = supabase
    .from("admin_community_posts")
    .select(ADMIN_POST_SELECT, { count: "exact" })
    // ปักหมุดขึ้นก่อนเหมือนฟีดจริง แอดมินจะได้เห็นตรงกับที่ผู้ใช้เห็น
    .order("is_pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (filter === "reported") q = q.gt("pending_report_count", 0);
  if (filter === "pinned") q = q.eq("is_pinned", true);
  if (filter === "hidden") q = q.eq("status", "hidden");

  const term = query ? escapeSearchTerm(query) : "";
  if (term) q = q.or(`content.ilike.%${term}%,title.ilike.%${term}%`);

  const { data, error, count } = await q;
  if (error) throw error;

  const total = count ?? 0;
  return {
    posts: (data ?? []).map(toAdminPost),
    total,
    hasMore: from + limit < total,
  };
}

// รายการความคิดเห็นทั้งหมด — แอดมินเข้าถึงได้โดยไม่ต้องรอให้มีคนรายงาน
// (กรอง filter="reported" เพื่อดูเฉพาะที่ถูกรายงาน)
export async function fetchAdminComments({ filter = "all", query, page = 1, limit = ADMIN_POSTS_PAGE_SIZE } = {}) {
  const from = (page - 1) * limit;

  let q = supabase
    .from("admin_community_comments")
    .select(
      "id, post_id, user_id, content, status, created_at, author_username, author_full_name, author_avatar_url, author_is_active, post_title, pending_report_count",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, from + limit - 1);

  if (filter === "reported") q = q.gt("pending_report_count", 0);

  const term = query ? escapeSearchTerm(query) : "";
  if (term) q = q.ilike("content", `%${term}%`);

  const { data, error, count } = await q;
  if (error) throw error;

  const total = count ?? 0;
  return {
    comments: (data ?? []).map((row) => ({
      id: row.id,
      postId: row.post_id,
      userId: row.user_id,
      content: row.content ?? "",
      status: row.status,
      createdAt: row.created_at,
      author: row.author_full_name || row.author_username || "ผู้ใช้ไม่ระบุตัวตน",
      authorAvatar: row.author_avatar_url,
      authorSuspended: row.author_is_active === false,
      postTitle: row.post_title ?? "",
      reportCount: row.pending_report_count ?? 0,
    })),
    total,
    hasMore: from + limit < total,
  };
}

export async function deleteComment(commentId) {
  const { error } = await supabase
    .from("community_comments")
    .update({ status: "deleted" })
    .eq("id", commentId);

  if (error) throw error;
}

const REPORT_SELECT = `
  post_id,
  comment_id,
  target_type,
  link_post_id,
  report_count,
  reasons,
  reason_counts,
  top_reason,
  descriptions,
  first_reported_at,
  last_reported_at,
  target_content,
  target_title,
  target_author,
  target_author_id,
  target_author_avatar,
  post_status
`;

// เหตุผลของเนื้อหาชิ้นหนึ่งมาเป็น array เรียงตามจำนวนคนที่เลือกข้อนั้น (0052)
// — คลี่ออกมาเป็นรายการที่มีทั้งป้าย หมวด และจำนวน เพื่อให้หน้าแอดมินโชว์ได้
// ว่า "สแปม 4 · หลอกลวง 2" ไม่ใช่แค่ชื่อข้อลอย ๆ ที่ไม่รู้ว่าอันไหนหนักกว่า
function toReasonBreakdown(reasons, counts) {
  return (reasons ?? []).map((value) => ({
    value,
    label: reportReasonLabel(value),
    group: reportReasonGroup(value),
    count: counts?.[value] ?? 0,
  }));
}

export async function fetchPendingReports({ group = "", limit = 20 } = {}) {
  let query = supabase
    .from("admin_community_reports")
    .select(REPORT_SELECT)
    .order("report_count", { ascending: false })
    .order("last_reported_at", { ascending: false })
    .limit(limit);

  // กรองที่ฝั่งฐานข้อมูลด้วย overlaps — reasons เป็น text[] ที่ view รวมมาแล้ว
  // จึงถามได้ตรง ๆ ว่า "มีข้อไหนในหมวดนี้บ้างไหม" ไม่ต้องลากทุกแถวมากรองเอง
  const filter = REPORT_FILTERS.find((item) => item.key === group);
  if (filter?.reasons) query = query.overlaps("reasons", filter.reasons);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    postId: row.post_id,
    commentId: row.comment_id,
    targetType: row.target_type,
    // โพสต์ที่ต้องเปิดเพื่อดูของจริง — รายงานคอมเมนต์ชี้ไปที่โพสต์แม่ของมัน
    linkPostId: row.link_post_id,
    reportCount: row.report_count ?? 0,
    reasons: toReasonBreakdown(row.reasons, row.reason_counts),
    topReason: row.top_reason ? reportReasonLabel(row.top_reason) : "",
    topGroup: row.top_reason ? reportReasonGroup(row.top_reason) : "",
    notes: row.descriptions ?? [],
    firstReportedAt: row.first_reported_at,
    lastReportedAt: row.last_reported_at,
    content: row.target_content ?? "(เนื้อหาถูกลบไปแล้ว)",
    title: row.target_title ?? "",
    author: row.target_author,
    authorId: row.target_author_id,
    authorAvatar: row.target_author_avatar,
    postStatus: row.post_status,
  }));
}

// ฟังรายงานที่เพิ่งเข้ามาแบบเรียลไทม์ (0052 พา community_reports เข้า
// publication แล้ว) — RLS ของตารางปล่อยให้แอดมินอ่านได้ทุกใบ event จึงมาถึง
// ครบ ส่วนคนทั่วไปที่ subscribe channel ชื่อเดียวกันจะได้เฉพาะใบของตัวเอง
//
// คืน unsubscribe ให้ผู้เรียกไปใช้ใน cleanup ของ useEffect เหมือน
// subscribeToMessages ใน lib/messages.js — และต่อ counter ท้ายชื่อ channel
// ด้วยเหตุผลเดียวกับที่นั่น (ชื่อซ้ำจะได้ instance เดิมที่ join ไปแล้วกลับมา
// แล้ว subscribe() รอบสอง throw) จังหวะที่ชนคือกดออกจากหน้า /admin/community
// แล้วกดกลับเข้ามาทันทีก่อน channel เก่าจะถอดเสร็จ
let reportsChannelSeq = 0;

export function subscribeToReports(onInsert) {
  const channel = supabase
    .channel(`admin:community-reports:${++reportsChannelSeq}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "community_reports" },
      (payload) => onInsert(payload.new),
    )
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// หมวด "รีวิว" เป็นของระบบ ไม่ใช่หมวดที่แอดมินตั้งเอง — submit_review() หา
// หมวดนี้จาก "ชื่อ" ตอนโพสต์รีวิวให้ผู้ใช้ (0080) และทั้งหน้าชุมชนกับหน้ารีวิว
// ก็แยกโพสต์รีวิวออกจากฟีดด้วยชื่อเดียวกันนี้ ถ้าลบทิ้งหรือเปลี่ยนชื่อ รีวิวที่
// ส่งหลังจากนั้นจะไม่ถูกโพสต์ลงชุมชนอีกเลยโดยไม่มีอะไรฟ้อง
export const isSystemCategory = (category) => category?.name === SYSTEM_ONLY_CATEGORY;

const SYSTEM_CATEGORY_ERROR =
  'หมวด "รีวิว" เป็นหมวดของระบบ ลบหรือเปลี่ยนชื่อไม่ได้ เพราะระบบใช้หมวดนี้โพสต์รีวิวให้อัตโนมัติ';

export async function fetchCategoryStats() {
  const { data, error } = await supabase
    .from("admin_community_categories")
    .select("id, name, description, post_count")
    .order("id");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    postCount: row.post_count ?? 0,
    isSystem: row.name === SYSTEM_ONLY_CATEGORY,
  }));
}

export async function fetchReportedUsers(limit = 5) {
  const { data, error } = await supabase
    .from("admin_reported_users")
    .select("id, username, full_name, avatar_url, is_active, report_count, pending_report_count, reasons")
    .order("report_count", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name || row.username || "ผู้ใช้ไม่ระบุตัวตน",
    avatar: row.avatar_url,
    isActive: row.is_active,
    reportCount: row.report_count ?? 0,
    pendingCount: row.pending_report_count ?? 0,
    // เอาแค่สองข้อแรก — พอให้เห็นว่าคนนี้มีปัญหาแนวไหนโดยไม่กินพื้นที่การ์ด
    topReasons: (row.reasons ?? []).slice(0, 2).map(reportReasonLabel),
  }));
}

export async function setPostPinned(postId, isPinned) {
  const { error } = await supabase
    .from("community_posts")
    .update({ is_pinned: isPinned })
    .eq("id", postId);

  if (error) throw error;
}

// บันทึก hidden_by ไว้ด้วยตอนซ่อน เพื่อให้ trigger ใน 0043 รู้ว่าโพสต์นี้แอดมิน
// เป็นคนซ่อน เจ้าของจะกดแสดงกลับเองไม่ได้ — ตอนเลิกซ่อนก็ล้างค่ากลับเป็น null
export async function setPostHidden(postId, hidden, adminId) {
  const { error } = await supabase
    .from("community_posts")
    .update({
      status: hidden ? "hidden" : "published",
      hidden_by: hidden ? adminId : null,
    })
    .eq("id", postId);

  if (error) throw error;
}

// ลบแบบ soft — แถวยังอยู่ให้ตรวจย้อนหลังได้ แต่หายจากทั้งฟีดและหน้าแอดมิน
// (posts_public_read ปล่อยเฉพาะ status = 'published' ส่วน view ฝั่งแอดมิน
//  ก็กรอง status <> 'deleted' ออกไปแล้ว)
export async function deletePost(postId, adminId) {
  const { error } = await supabase
    .from("community_posts")
    .update({ status: "deleted", hidden_by: adminId })
    .eq("id", postId);

  if (error) throw error;
}

export async function resolveReport({ postId, commentId, action }) {
  const { error } = await supabase.rpc("admin_resolve_report", {
    p_post_id: postId ?? null,
    p_comment_id: commentId ?? null,
    p_action: action,
  });

  if (error) throw error;
}

export async function createCategory({ name, description }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาตั้งชื่อหมวดหมู่");

  if (trimmed === SYSTEM_ONLY_CATEGORY) {
    throw new Error('ชื่อ "รีวิว" สงวนไว้ให้หมวดของระบบ ใช้ชื่ออื่นแทน');
  }

  const { error } = await supabase
    .from("community_categories")
    .insert({ name: trimmed, description: description?.trim() || null });

  if (error) throw error;
}

// categories_admin_manage (0000) เปิดให้อยู่แล้ว — แต่ถ้ายังมีโพสต์ผูกอยู่
// FK จะกันไว้เอง แปลง error ให้อ่านรู้เรื่องแทนข้อความ constraint ดิบ ๆ
//
// หมวดระบบกันไว้ทั้งสองชั้น: ตรงนี้กันไม่ให้ยิงคำขอที่ยังไงก็ถูกปฏิเสธ ส่วน
// trigger ฝั่งฐานข้อมูล (0095) กันของจริงไม่ว่าคำขอจะมาจากไหน
export async function deleteCategory(category) {
  if (isSystemCategory(category)) throw new Error(SYSTEM_CATEGORY_ERROR);

  const { error } = await supabase.from("community_categories").delete().eq("id", category.id);

  if (error) {
    if (error.code === "23503") {
      throw new Error("ลบไม่ได้ เพราะยังมีโพสต์อยู่ในหมวดนี้ ย้ายโพสต์ออกก่อน");
    }
    throw error;
  }
}

export async function renameCategory(category, name) {
  if (isSystemCategory(category)) throw new Error(SYSTEM_CATEGORY_ERROR);

  const trimmed = name.trim();
  if (!trimmed) throw new Error("กรุณาตั้งชื่อหมวดหมู่");

  if (trimmed === SYSTEM_ONLY_CATEGORY) {
    throw new Error('ชื่อ "รีวิว" สงวนไว้ให้หมวดของระบบ ใช้ชื่ออื่นแทน');
  }

  const { error } = await supabase
    .from("community_categories")
    .update({ name: trimmed })
    .eq("id", category.id);

  if (error) throw error;
}
