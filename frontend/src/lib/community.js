// ฟีด/โพสต์/โปรไฟล์ชุมชน — ต่อกับตารางที่มีมาตั้งแต่ 0000 (community_posts,
// community_comments, post_likes, post_images, user_follows) ผ่าน view ที่
// เพิ่มใน 0041 ซึ่งรวมยอดถูกใจ/คอมเมนต์กับชื่อคนเขียนมาให้ในคิวรีเดียว
//
// อ่านชื่อคนอื่นตรง ๆ จาก profiles ไม่ได้ (profiles_select_own) ทุกที่ที่ต้อง
// ใช้ชื่อ/รูปของคนอื่นจึงต้องผ่าน public_profiles หรือ view ที่ join มาแล้ว
import { supabase } from "./supabase";
import { assertImageFile, imageExt, removeStorageFolder } from "./uploads";
import { escapeSearchTerm } from "./searchTerm";

const FEED_SELECT = `
  id,
  user_id,
  category_id,
  category_name,
  title,
  content,
  status,
  is_pinned,
  view_count,
  created_at,
  edited_at,
  author_username,
  author_full_name,
  author_avatar_url,
  like_count,
  comment_count,
  is_liked,
  is_bookmarked,
  is_author_followed,
  cover_image
`;

export const FEED_FILTERS = ["ล่าสุด", "กำลังฮิต", "ที่ติดตาม", "บันทึกไว้"];

export const FEED_PAGE_SIZE = 20;

// เพดานจำนวนรูปต่อโพสต์ — กันโพสต์เดียวลากยาวจนฟีดอืด (ไม่มีข้อจำกัดฝั่ง DB
// เพราะ post_images ไม่ได้ผูก check ไว้ นี่เป็นแค่กติกาฝั่งแอป)
export const MAX_POST_IMAGES = 10;

export const displayName = (row, prefix = "author") =>
  row?.[`${prefix}_full_name`] || row?.[`${prefix}_username`] || "ผู้ใช้";

// images ส่งเข้ามาแยกจากแถวของ view — อ่านจากตาราง post_images ตรง ๆ
// (fetchImagesByPost / fetchPostImages) ไม่ได้เอามาจากคอลัมน์ array ใน view
function toPost(row, images = []) {
  const title = row.title ?? "";
  const content = row.content ?? "";

  return {
    id: row.id,
    userId: row.user_id,
    categoryId: row.category_id,
    category: row.category_name ?? "ทั่วไป",
    // โพสต์ที่เขียนจากฟีดไม่มีช่องหัวข้อแยก — deriveTitle ตัดบรรทัดแรกของ
    // เนื้อหามาลง title ให้ (คอลัมน์เป็น NOT NULL) ถ้าเอามาแสดงเป็นหัวข้อคู่กับ
    // เนื้อหาเต็มก็จะเห็นข้อความเดิมซ้ำสองรอบ จึงเก็บไว้เฉพาะหัวข้อที่ตั้งมา
    // ต่างหากจริง ๆ เช่นโพสต์รีวิวที่ submit_review สร้างให้ (0080)
    title: title === deriveTitle(content) ? "" : title,
    content,
    isPinned: row.is_pinned ?? false,
    viewCount: row.view_count ?? 0,
    createdAt: row.created_at,
    editedAt: row.edited_at,
    isEdited: Boolean(row.edited_at),
    author: displayName(row),
    authorUsername: row.author_username,
    authorAvatar: row.author_avatar_url,
    likeCount: row.like_count ?? 0,
    commentCount: row.comment_count ?? 0,
    isLiked: row.is_liked ?? false,
    isBookmarked: row.is_bookmarked ?? false,
    isAuthorFollowed: row.is_author_followed ?? false,
    coverImage: row.cover_image,
    images,
  };
}

export async function fetchCategories() {
  const { data, error } = await supabase
    .from("community_categories")
    .select("id, name, description")
    .order("id");

  if (error) throw error;
  return data ?? [];
}

// หมวด "รีวิว" มีไว้ให้ submit_review() โพสต์ให้อัตโนมัติเท่านั้น (ดู
// 0080_review_community_category.sql) — ผู้ใช้เลือกหมวดนี้เองตอนสร้าง/แก้โพสต์
// ไม่ได้ (policy ฝั่ง DB บล็อกไว้อีกชั้นอยู่แล้ว นี่แค่ไม่โชว์ตัวเลือกให้เลือก)
export const SYSTEM_ONLY_CATEGORY = "รีวิว";

// หมวดที่ผู้ใช้เขียนถึงได้เอง — ใช้ทั้งในกล่องเขียนโพสต์และแถบหมวดข้างฟีด
// เพราะรีวิวย้ายไปอยู่หน้าของตัวเองแล้ว (/community/reviews) จึงไม่ต้องมีปุ่ม
// หมวดรีวิวปนอยู่ในรายการหมวดของฟีดคุยกันอีก
export function postableCategories(categories) {
  return (categories ?? []).filter((cat) => cat.name !== SYSTEM_ONLY_CATEGORY);
}

// ตัวกรองคะแนนของหน้ารีวิว — submit_review() ขึ้นต้นเนื้อหาด้วยดาวห้าดวงเสมอ
// (0080) กรองที่ฐานข้อมูลด้วย like จึงพอ ไม่ต้องลากทุกรีวิวมานับดาวฝั่งหน้าเว็บ
export const REVIEW_RATINGS = [5, 4, 3, 2, 1];

export const ratingStars = (rating) => "★".repeat(rating) + "☆".repeat(5 - rating);

// โพสต์ในหมวด "รีวิว" ถูก submit_review() ประกอบข้อความให้เป็นรูปแบบตายตัว
// (ดู 0080) คือ title = "รีวิว <ชื่อสนาม>" และบรรทัดแรกของเนื้อหา = ดาวห้าดวง
// ตามด้วยชื่อสาขา แล้วค่อยเป็นคำติชมของผู้ใช้ในบรรทัดถัด ๆ ไป
//
// แกะกลับมาเป็นข้อมูลเพื่อให้หน้าชุมชนวาดดาวเป็นดาวจริง ๆ แทนที่จะโชว์
// "★★★★☆ ..." เป็นข้อความดิบปนอยู่กับโพสต์ทั่วไป — ถ้ารูปแบบไม่ตรง (โพสต์เก่า
// หรือแอดมินแก้ข้อความเอง) คืน null แล้วให้การ์ดตกกลับไปแสดงแบบโพสต์ธรรมดา
const REVIEW_LINE = /^([★☆]{5})[ \t]*(.*)$/;

export const isReviewPost = (post) => post?.category === SYSTEM_ONLY_CATEGORY;

export function parseReviewPost(post) {
  if (!isReviewPost(post)) return null;

  const [firstLine = "", ...rest] = (post.content ?? "").split("\n");
  const match = REVIEW_LINE.exec(firstLine.trim());
  if (!match) return null;

  return {
    rating: (match[1].match(/★/g) ?? []).length,
    venue: match[2].trim(),
    facility: (post.title ?? "").replace(/^รีวิว\s*/, "").trim(),
    comment: rest.join("\n").trim(),
  };
}

// ค้นหายิงไปที่ฐานข้อมูล ไม่ใช่กรองเฉพาะแถวที่โหลดมาแล้ว — เดิมหน้าฟีดกรอง
// ใน useMemo ทับผลลัพธ์ 20 แถวแรก พอโพสต์เกิน 20 อันการค้นหาจะไม่เจอทั้งที่
// ของมีอยู่จริง
//
// limit+1 เพื่อรู้ว่ามีหน้าถัดไปไหมโดยไม่ต้องยิง count แยก (pattern เดียวกับ
// fetchAdminNews ใน lib/news.js)
export async function fetchFeed({
  categoryId,
  filter = FEED_FILTERS[0],
  query,
  page = 1,
  limit = FEED_PAGE_SIZE,
  reviewsOnly = false,
  rating = 0,
} = {}) {
  const from = (page - 1) * limit;

  // posts_public_read ปล่อยให้เจ้าของเห็นโพสต์ตัวเองทุกสถานะ — ถ้าไม่กรองตรงนี้
  // โพสต์ที่แอดมินเพิ่งซ่อนจะยังโผล่ในฟีดของคนเขียนเหมือนไม่มีอะไรเกิดขึ้น
  let q = supabase
    .from("community_feed_posts")
    .select(FEED_SELECT)
    .eq("status", "published");

  // รีวิวกับโพสต์คุยกันแยกกันคนละหน้า — ฟีดชุมชนตัดหมวดรีวิวออกทุกแท็บ ไม่ใช่
  // แค่ตอนเลือก "ทั้งหมด" ไม่งั้นพอกด "กำลังฮิต" รีวิวที่คนกดถูกใจเยอะจะไหล
  // กลับมาเบียดโพสต์คุยกันอยู่ดี
  //
  // กรองด้วย category_name ได้เพราะ community_posts.category_id เป็น NOT NULL
  // และ FK เป็น on delete restrict — ทุกแถวใน view จึง join เจอชื่อหมวดเสมอ
  q = reviewsOnly
    ? q.eq("category_name", SYSTEM_ONLY_CATEGORY)
    : q.neq("category_name", SYSTEM_ONLY_CATEGORY);

  if (reviewsOnly && rating) q = q.like("content", `${ratingStars(rating)}%`);

  if (categoryId) q = q.eq("category_id", categoryId);

  // "ที่ติดตาม"/"บันทึกไว้" กรองด้วยคอลัมน์ที่ view คำนวณมาให้แล้ว — ฝั่ง
  // หน้าเว็บจึงไม่ต้องดึงรายชื่อที่ติดตาม/บุ๊กมาร์กมาก่อนแล้วค่อยยิงรอบสอง
  if (filter === "ที่ติดตาม") q = q.eq("is_author_followed", true);
  if (filter === "บันทึกไว้") q = q.eq("is_bookmarked", true);

  const term = query ? escapeSearchTerm(query) : "";
  if (term) q = q.or(`content.ilike.%${term}%,title.ilike.%${term}%`);

  // โพสต์ที่แอดมินปักหมุด (0043) ขึ้นก่อนเสมอไม่ว่าจะเลือกแท็บไหน แล้วค่อย
  // เรียงตามเงื่อนไขของแท็บนั้นภายในกลุ่มที่เหลือ
  q = q.order("is_pinned", { ascending: false });

  q =
    filter === "กำลังฮิต"
      ? q.order("like_count", { ascending: false }).order("created_at", { ascending: false })
      : q.order("created_at", { ascending: false });

  const { data, error } = await q.range(from, from + limit);
  if (error) throw error;

  const rows = (data ?? []).slice(0, limit);
  const imagesByPost = await fetchImagesByPost(rows.map((row) => row.id));

  return {
    posts: rows.map((row) => toPost(row, imagesByPost.get(row.id) ?? [])),
    hasMore: (data ?? []).length > limit,
  };
}

// สรุปคะแนนของหน้ารีวิว — นับจากโพสต์ในหมวด "รีวิว" ตัวเดียวกับที่หน้าแสดง
// (ไม่ใช่ตาราง reviews ทั้งตาราง) ตัวเลขสรุปกับรายการข้างล่างจะได้ตรงกันเสมอ
export async function fetchReviewStats() {
  const { data, error } = await supabase.rpc("community_review_stats");
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  return {
    total: Number(row?.total ?? 0),
    average: Number(row?.average ?? 0),
    counts: {
      1: Number(row?.count_1 ?? 0),
      2: Number(row?.count_2 ?? 0),
      3: Number(row?.count_3 ?? 0),
      4: Number(row?.count_4 ?? 0),
      5: Number(row?.count_5 ?? 0),
    },
  };
}

export async function fetchPostById(id) {
  const { data, error } = await supabase
    .from("community_feed_posts")
    .select(FEED_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("ไม่พบโพสต์นี้ หรือโพสต์ถูกลบไปแล้ว");

  return toPost(data, await fetchPostImages(id));
}

// รูปของหลายโพสต์ในคิวรีเดียว แล้วค่อยจับกลุ่มตาม post_id — อ่านจากตาราง
// post_images ตรง ๆ (เส้นทางเดียวกับกล่องแก้ไขโพสต์) ไม่ได้เอามาจากคอลัมน์
// array ที่รวมมาให้ใน view เพราะยิงทีละโพสต์ในฟีดจะกลายเป็น N+1
async function fetchImagesByPost(postIds) {
  const byPost = new Map();
  if (postIds.length === 0) return byPost;

  const { data, error } = await supabase
    .from("post_images")
    .select("post_id, image_url, sort_order")
    .in("post_id", postIds)
    .order("sort_order")
    .order("id");

  if (error) throw error;

  for (const row of data ?? []) {
    const list = byPost.get(row.post_id);
    if (list) list.push(row.image_url);
    else byPost.set(row.post_id, [row.image_url]);
  }

  return byPost;
}

export async function fetchPostImages(postId) {
  const { data, error } = await supabase
    .from("post_images")
    .select("id, image_url, sort_order")
    .eq("post_id", postId)
    .order("sort_order")
    .order("id");

  if (error) throw error;
  return (data ?? []).map((row) => row.image_url);
}

export async function fetchComments(postId) {
  const { data, error } = await supabase
    .from("community_post_comments")
    .select(
      "id, post_id, user_id, parent_id, content, created_at, author_username, author_full_name, author_avatar_url",
    )
    .eq("post_id", postId)
    .eq("status", "published")
    .order("created_at");

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    parentId: row.parent_id,
    content: row.content,
    createdAt: row.created_at,
    author: displayName(row),
    authorAvatar: row.author_avatar_url,
  }));
}

export async function addComment({ postId, userId, content, parentId = null }) {
  const text = content.trim();
  if (!text) throw new Error("กรุณาพิมพ์ความคิดเห็นก่อนส่ง");

  const { error } = await supabase.from("community_comments").insert({
    post_id: postId,
    user_id: userId,
    parent_id: parentId,
    content: text,
  });

  if (error) throw error;
}

// กดถูกใจ/เลิกถูกใจ — post_likes ใช้ (post_id, user_id) เป็น primary key อยู่
// แล้ว การกดรัว ๆ จึงได้ error ซ้ำคีย์แทนที่จะได้แถวซ้ำ
export async function togglePostLike({ postId, userId, liked }) {
  if (liked) {
    const { error } = await supabase
      .from("post_likes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);

    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from("post_likes")
    .insert({ post_id: postId, user_id: userId });

  if (error) throw error;
  return true;
}

export async function toggleFollow({ targetId, userId, following }) {
  if (following) {
    const { error } = await supabase
      .from("user_follows")
      .delete()
      .eq("follower_id", userId)
      .eq("following_id", targetId);

    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from("user_follows")
    .insert({ follower_id: userId, following_id: targetId });

  if (error) throw error;
  return true;
}

// สร้างโพสต์ + อัปโหลดรูป (ได้หลายรูปต่อโพสต์ — post_images รองรับอยู่แล้วผ่าน
// sort_order ดู 0000)
//
// รูปอัปโหลดหลังจากได้ post id แล้ว เพราะ path ต้องมี id อยู่ในนั้น และ policy
// ของ bucket ล็อกโฟลเดอร์ชั้นแรกไว้ที่ user id (ดู 0041) — ถ้าอัปโหลดล้มเหลว
// โพสต์ที่สร้างไปแล้วยังอยู่ ผู้ใช้จึงไม่เสียข้อความที่พิมพ์มาทั้งหมด
// community_posts.title เป็น NOT NULL varchar(255) แต่ช่องเขียนโพสต์ในฟีดมี
// ช่องเดียวตามแบบ (ไม่มีช่องหัวข้อแยก) — ตัดบรรทัดแรกของเนื้อหามาเป็นหัวข้อ
// ให้แทน ไม่งั้น insert ตายทุกครั้งที่โพสต์จากฟีด
function deriveTitle(content) {
  const firstLine = content.split("\n")[0].trim();
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}...` : firstLine;
}

// ชื่อไฟล์ต้องไม่ซ้ำกันเองภายในโพสต์เดียว — ผสม timestamp + ลำดับรูป
// กันชนกันตอนอัปโหลดหลายไฟล์พร้อมกัน
async function uploadCommunityImages(folder, files) {
  return Promise.all(
    files.map(async (file, index) => {
      const path = `${folder}/${Date.now()}-${index}.${imageExt(file)}`;

      const { error: uploadError } = await supabase.storage
        .from("community")
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("community").getPublicUrl(path);
      return publicUrl;
    }),
  );
}

export async function createPost({ userId, categoryId, title, content, imageFiles = [] }) {
  const text = content.trim();
  // เหมือนเฟซบุ๊ก — โพสต์แค่รูปอย่างเดียวโดยไม่พิมพ์อะไรเลยได้ แค่ต้องมีอย่าง
  // น้อยหนึ่งอย่าง (ข้อความหรือรูป) ไม่ให้โพสต์ว่างเปล่าจริง ๆ
  if (!text && imageFiles.length === 0) {
    throw new Error("กรุณาเขียนเนื้อหาหรือแนบรูปอย่างน้อยหนึ่งอย่าง");
  }
  if (!categoryId) throw new Error("กรุณาเลือกหมวดหมู่ของโพสต์");
  imageFiles.forEach(assertImageFile);

  const { data, error } = await supabase
    .from("community_posts")
    .insert({
      user_id: userId,
      category_id: categoryId,
      title: title?.trim() || deriveTitle(text),
      content: text,
      post_type: imageFiles.length > 0 ? "image" : "text",
    })
    .select("id")
    .single();

  if (error) throw error;

  if (imageFiles.length > 0) {
    const uploaded = await uploadCommunityImages(`${userId}/${data.id}`, imageFiles);

    const { error: imageError } = await supabase.from("post_images").insert(
      uploaded.map((image_url, sort_order) => ({ post_id: data.id, image_url, sort_order })),
    );
    if (imageError) throw imageError;
  }

  return data.id;
}

// ลบไฟล์เดิมในโฟลเดอร์ของโพสต์ที่ไม่ได้อยู่ในรายการ "เก็บไว้ต่อ" อีกแล้ว —
// เทียบชื่อไฟล์ท้าย URL แทนการลบทั้งโฟลเดอร์ (removeStorageFolder) เพราะรูปที่
// ผู้ใช้ไม่ได้เอาออกต้องยังอยู่ ลบไม่สำเร็จไม่ถือเป็น error ของการบันทึกโพสต์
// (เนื้อหา/รูปใหม่บันทึกไปแล้วจริง) แค่บันทึกไว้ใน console เหมือน
// removeStorageFolder ใน lib/uploads.js
async function removeUnkeptCommunityImages(folder, keepUrls) {
  try {
    const { data, error } = await supabase.storage.from("community").list(folder);
    if (error) throw error;

    const keepNames = new Set(keepUrls.map((url) => url.split("/").pop()));
    const toRemove = (data ?? [])
      .filter((file) => !keepNames.has(file.name))
      .map((file) => `${folder}/${file.name}`);

    if (toRemove.length === 0) return;

    const { error: removeError } = await supabase.storage.from("community").remove(toRemove);
    if (removeError) throw removeError;
  } catch (err) {
    console.error(`ลบไฟล์ใน bucket community/${folder} ไม่สำเร็จ:`, err);
  }
}

// แก้โพสต์ตัวเอง — posts_update_own เปิดให้อยู่แล้ว เดิมแก้ได้แค่เนื้อหา
// ตอนนี้แก้หมวดหมู่/รูป(หลายรูป)ได้ด้วย ให้ทำได้ทุกอย่างเหมือนตอนสร้างโพสต์
//
// keepImageUrls = รูปเดิมที่ยังเก็บไว้ (เรียงตามลำดับที่ต้องการ), imageFiles =
// ไฟล์ใหม่ที่เพิ่มเข้ามา (ต่อท้ายรูปเดิมเสมอ) — ฝั่งเรียกส่งมาเป็น "สถานะ
// สุดท้ายที่ต้องการ" เต็มชุดทุกครั้งที่มีการแก้ไข ไม่ต้องคำนวณ diff เอง
//
// edited_at ตั้งทุกครั้งที่แก้ (แม้ไม่ได้แตะรูปเลย) — เป็นคอลัมน์แยกจาก
// updated_at เพราะ updated_at ขยับจากการนับยอด view/like/comment/ปักหมุดด้วย
// (ดู 0081) ใช้เทียบว่า "เจ้าของแก้เนื้อหาจริงไหม" ไม่ได้
export async function updateOwnPost(
  postId,
  { userId, content, categoryId, imageFiles = [], keepImageUrls = [] } = {},
) {
  const text = content.trim();
  const finalImageCount = keepImageUrls.length + imageFiles.length;
  if (!text && finalImageCount === 0) {
    throw new Error("กรุณาเขียนเนื้อหาหรือแนบรูปอย่างน้อยหนึ่งอย่าง");
  }
  if (!categoryId) throw new Error("กรุณาเลือกหมวดหมู่ของโพสต์");
  imageFiles.forEach(assertImageFile);

  const { error } = await supabase
    .from("community_posts")
    .update({
      title: deriveTitle(text),
      content: text,
      category_id: categoryId,
      post_type: finalImageCount > 0 ? "image" : "text",
      edited_at: new Date().toISOString(),
    })
    .eq("id", postId);

  if (error) throw error;

  const folder = `${userId}/${postId}`;
  await removeUnkeptCommunityImages(folder, keepImageUrls);

  const uploaded = imageFiles.length > 0 ? await uploadCommunityImages(folder, imageFiles) : [];

  // ลบแถวรูปเดิมก่อนแล้วค่อยแทรกชุดใหม่ทั้งหมด แทนการ upsert ทีละแถว — ไม่ต้อง
  // พึ่งว่ามี unique constraint บน (post_id, sort_order) จริงไหม
  const { error: deleteImagesError } = await supabase
    .from("post_images")
    .delete()
    .eq("post_id", postId);
  if (deleteImagesError) throw deleteImagesError;

  const orderedUrls = [...keepImageUrls, ...uploaded];
  if (orderedUrls.length > 0) {
    const { error: imageError } = await supabase.from("post_images").insert(
      orderedUrls.map((image_url, sort_order) => ({ post_id: postId, image_url, sort_order })),
    );
    if (imageError) throw imageError;
  }
}

// ลบแบบ soft ให้ตรงกับฝั่งแอดมิน (0043) — แถวยังอยู่ให้ตรวจย้อนหลังได้ แต่
// หายจากทุกหน้า ส่วนไฟล์รูปลบทิ้งจริงเพราะไม่มีอะไรอ้างถึงอีกแล้ว
export async function deleteOwnPost(postId, userId) {
  const { error } = await supabase
    .from("community_posts")
    .update({ status: "deleted" })
    .eq("id", postId);

  if (error) throw error;

  await removeStorageFolder("community", `${userId}/${postId}`);
}

export async function deleteOwnComment(commentId) {
  const { error } = await supabase
    .from("community_comments")
    .update({ status: "deleted" })
    .eq("id", commentId);

  if (error) throw error;
}

// เหตุผลการรายงานแบ่งเป็นหมวด — ค่า value ยังเป็น enum report_reason ตัวเดิม
// ทุกตัว (0000) ที่เพิ่มคือชั้นการจัดกลุ่มข้างบนเพื่อให้ผู้ใช้หาข้อที่ตรงกับ
// เรื่องของตัวเองเจอเร็วขึ้น และให้แอดมินอ่านคิวได้ว่าปัญหาส่วนใหญ่เป็นแนวไหน
//
// หมวดเป็นเรื่องของการแสดงผลล้วน ๆ ไม่ได้เก็บลงฐานข้อมูล — ถ้าวันหนึ่งอยาก
// ย้ายเหตุผลข้อไหนข้ามหมวด แก้ที่นี่ที่เดียวโดยไม่ต้องแตะข้อมูลเก่าเลย
export const REPORT_REASON_GROUPS = [
  {
    key: "content",
    label: "เนื้อหาไม่เหมาะสม",
    description: "ตัวโพสต์หรือรูปภาพมีปัญหาในตัวมันเอง",
    reasons: [
      {
        value: "inappropriate",
        label: "เนื้อหาไม่เหมาะสม",
        hint: "ภาพ/ข้อความลามก รุนแรง หรือไม่เหมาะกับพื้นที่สาธารณะ",
      },
      {
        value: "misinformation",
        label: "ข้อมูลเท็จ",
        hint: "ให้ข้อมูลสนาม ราคา หรือกิจกรรมที่ไม่ตรงความจริง",
      },
    ],
  },
  {
    key: "behavior",
    label: "พฤติกรรมผู้ใช้",
    description: "ปัญหาที่ตัวคนโพสต์ ไม่ใช่ตัวเนื้อหา",
    reasons: [
      {
        value: "harassment",
        label: "คุกคาม / ใช้ถ้อยคำรุนแรง",
        hint: "ด่าทอ ข่มขู่ เหยียด หรือตามรังควานผู้อื่น",
      },
      {
        value: "spam",
        label: "สแปม / โฆษณา",
        hint: "โพสต์ซ้ำ ๆ หรือขายของที่ไม่เกี่ยวกับชุมชน",
      },
    ],
  },
  {
    key: "safety",
    label: "ความปลอดภัยและการเงิน",
    description: "เรื่องที่อาจทำให้สมาชิกเสียเงินหรือเสียหาย",
    reasons: [
      {
        value: "scam",
        label: "หลอกลวง / ฉ้อโกง",
        hint: "หลอกโอนค่ามัดจำ ขายตั๋วปลอม หรือแอบอ้างเป็นสนาม",
      },
      {
        value: "other",
        label: "อื่น ๆ",
        hint: "ไม่เข้าข้อไหนเลย — ช่วยอธิบายเพิ่มในช่องรายละเอียด",
      },
    ],
  },
];

// เพดานเดียวกับที่ community_reports_reasons_check บังคับไว้ฝั่งฐานข้อมูล (0052)
// — เก็บเป็นค่าคงที่ตัวเดียวเพื่อให้ข้อความบนหน้าจอกับกติกาจริงตรงกันเสมอ
export const MAX_REPORT_REASONS = 3;

const REASON_LOOKUP = new Map(
  REPORT_REASON_GROUPS.flatMap((group) =>
    group.reasons.map((reason) => [reason.value, { ...reason, groupLabel: group.label }]),
  ),
);

export const reportReasonLabel = (value) => REASON_LOOKUP.get(value)?.label ?? value;

export const reportReasonGroup = (value) => REASON_LOOKUP.get(value)?.groupLabel ?? "อื่น ๆ";

// รายงานโพสต์หรือคอมเมนต์เข้าคิวตรวจสอบของแอดมิน
//
// ยิงผ่าน RPC ไม่ใช่ insert ตรงแล้ว (0052) เพราะการรายงานหนึ่งครั้งต้องทำสาม
// อย่างในทรานแซกชันเดียว: ตรวจว่าเนื้อหามีจริงและไม่ใช่ของตัวเอง เขียนใบรายงาน
// และแจ้งแอดมินทุกคน — ฝั่งหน้าเว็บทำสองอย่างหลังเองไม่ได้เลย
//
// reporterId ไม่ได้ส่งไปแล้ว (RPC อ่าน auth.uid() เอง) แต่ยังรับพารามิเตอร์ไว้
// เพื่อไม่ให้ที่เรียกอยู่เดิมพัง
export async function reportContent({ postId, commentId, reasons, description }) {
  const picked = (reasons ?? []).filter(Boolean);

  if (picked.length === 0) throw new Error("กรุณาเลือกเหตุผลในการรายงานอย่างน้อย 1 ข้อ");
  if (picked.length > MAX_REPORT_REASONS) {
    throw new Error(`เลือกเหตุผลได้ไม่เกิน ${MAX_REPORT_REASONS} ข้อต่อหนึ่งรายงาน`);
  }

  const { error } = await supabase.rpc("report_content", {
    p_post_id: postId ?? null,
    p_comment_id: commentId ?? null,
    p_reasons: picked,
    p_description: description?.trim() || null,
  });

  if (error) throw error;
}

export async function toggleBookmark({ postId, userId, bookmarked }) {
  if (bookmarked) {
    const { error } = await supabase
      .from("post_bookmarks")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", userId);

    if (error) throw error;
    return false;
  }

  const { error } = await supabase
    .from("post_bookmarks")
    .insert({ post_id: postId, user_id: userId });

  if (error) throw error;
  return true;
}

// นับยอดเข้าชม — RPC เพราะผู้ใช้อัปเดตโพสต์ของคนอื่นเองไม่ได้ และ RPC
// ไม่นับให้เจ้าของโพสต์เอง (ดู 0044) ยอดพลาดไม่ใช่เรื่องคอขวด จึงกลืน error
// ทิ้งไม่ให้ไปกวนการเปิดอ่านโพสต์
export async function incrementPostView(postId) {
  try {
    const { error } = await supabase.rpc("increment_post_view", { p_post_id: postId });
    if (error) throw error;
  } catch (err) {
    console.error("นับยอดเข้าชมไม่สำเร็จ:", err);
  }
}

export async function fetchCommunityProfile(userId) {
  const { data, error } = await supabase
    .from("community_profile_stats")
    .select(
      "id, username, full_name, avatar_url, cover_url, bio, sports, area, home_venue, available_time, created_at, post_count, follower_count, following_count, team_post_count, is_following",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("ไม่พบผู้ใช้นี้");

  return {
    id: data.id,
    username: data.username,
    name: data.full_name || data.username || "ผู้ใช้",
    avatar: data.avatar_url,
    cover: data.cover_url,
    bio: data.bio ?? "",
    sports: data.sports ?? [],
    area: data.area,
    homeVenue: data.home_venue,
    availableTime: data.available_time,
    joinedAt: data.created_at,
    postCount: data.post_count ?? 0,
    followerCount: data.follower_count ?? 0,
    followingCount: data.following_count ?? 0,
    teamPostCount: data.team_post_count ?? 0,
    isFollowing: data.is_following ?? false,
  };
}

export async function fetchUserPosts(userId, limit = 20) {
  const { data, error } = await supabase
    .from("community_feed_posts")
    .select(FEED_SELECT)
    .eq("user_id", userId)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  const rows = data ?? [];
  const imagesByPost = await fetchImagesByPost(rows.map((row) => row.id));

  return rows.map((row) => toPost(row, imagesByPost.get(row.id) ?? []));
}

// คนที่ยังไม่ได้ติดตาม เอาไว้โชว์ในกล่อง "ผู้ใช้แนะนำ" ข้างฟีด
export async function fetchSuggestedUsers(userId, limit = 15) {
  const { data: follows, error: followError } = await supabase
    .from("user_follows")
    .select("following_id")
    .eq("follower_id", userId);

  if (followError) throw followError;

  const exclude = [userId, ...(follows ?? []).map((row) => row.following_id)];

  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, username, full_name, avatar_url")
    .not("id", "in", `(${exclude.join(",")})`)
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name || row.username || "ผู้ใช้",
    // การ์ดผู้ใช้แนะนำบนมือถือมีที่ว่างใต้ชื่อพอดีหนึ่งบรรทัด ใส่ @username ไว้
    // ช่วยแยกคนที่ตั้งชื่อซ้ำกัน — คิวรีดึงคอลัมน์นี้มาอยู่แล้วเพื่อใช้เป็นชื่อ
    // สำรอง จึงไม่มีต้นทุนเพิ่ม (หน้าเว็บเลือกเองว่าจะโชว์ตรงไหน)
    username: row.username || "",
    avatar: row.avatar_url,
  }));
}

// "เพื่อนร่วมกัน" = คนที่เราติดตามและเจ้าของโปรไฟล์ก็ติดตามเหมือนกัน
//
// ทำเป็นสองคิวรีแล้ว intersect ฝั่งหน้าเว็บ แทนที่จะเป็น view อีกตัว เพราะ
// ต้องรับ "อีกฝ่ายคือใคร" เป็นพารามิเตอร์ ซึ่ง view ทำไม่ได้ และรายการติดตาม
// ของคนคนหนึ่งไม่ได้ยาวจนต้องกลัวเรื่องขนาด
export async function fetchMutualFollows(userId, otherId, limit = 6) {
  if (!userId || !otherId || userId === otherId) return [];

  const [mine, theirs] = await Promise.all([
    supabase.from("user_follows").select("following_id").eq("follower_id", userId),
    supabase.from("user_follows").select("following_id").eq("follower_id", otherId),
  ]);

  if (mine.error) throw mine.error;
  if (theirs.error) throw theirs.error;

  const mineSet = new Set((mine.data ?? []).map((row) => row.following_id));
  const shared = (theirs.data ?? [])
    .map((row) => row.following_id)
    .filter((id) => mineSet.has(id))
    .slice(0, limit);

  if (shared.length === 0) return [];

  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, username, full_name, avatar_url")
    .in("id", shared);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name || row.username || "ผู้ใช้",
    avatar: row.avatar_url,
  }));
}

export async function searchPeople(query, limit = 8) {
  const term = escapeSearchTerm(query ?? "");
  if (!term) return [];

  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, username, full_name, avatar_url")
    .or(`full_name.ilike.%${term}%,username.ilike.%${term}%`)
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name || row.username || "ผู้ใช้",
    avatar: row.avatar_url,
  }));
}

// "2 ชม.ที่แล้ว" แบบใน Figma — เกิน 7 วันแล้วเปลี่ยนไปบอกวันที่จริงแทน เพราะ
// "45 วันที่แล้ว" อ่านยากกว่าวันที่
const dateFormatter = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });

export function relativeTime(value) {
  if (!value) return "";

  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return "เมื่อสักครู่";
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชม.ที่แล้ว`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "เมื่อวาน";
  if (days < 7) return `${days} วันก่อน`;

  return dateFormatter.format(new Date(value));
}
