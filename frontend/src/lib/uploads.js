import { supabase } from "./supabase";

// ข้อจำกัดชุดเดียวกับที่ตั้งไว้บน bucket ฝั่ง Supabase (avatars ตั้งมาตั้งแต่
// 0001, news/amenities ตั้งเพิ่มใน 0021) — ที่นี่ไม่ใช่ด่านความปลอดภัย
// ด่านจริงอยู่ที่ bucket ซึ่งข้ามไม่ได้ ตรงนี้มีไว้ให้ผู้ใช้รู้ตัวก่อนรอ
// อัปโหลดไฟล์ 40 MB จนจบแล้วค่อยเจอ error ดิบ ๆ จาก storage
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const MB = (bytes) => Math.round((bytes / (1024 * 1024)) * 10) / 10;

// โยน Error ข้อความไทย — errorMessage() ใน lib/errors.js ปล่อยข้อความไทยผ่าน
// ไปแสดงผลตรง ๆ อยู่แล้ว จึงไม่ต้องมีทางส่งข้อความแยก
export function assertImageFile(file) {
  if (!file) return;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("รองรับเฉพาะไฟล์ภาพ JPG, PNG, WebP หรือ GIF เท่านั้น");
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`ไฟล์ใหญ่เกินไป (${MB(file.size)} MB) ขนาดสูงสุดคือ 5 MB`);
  }
}

// นามสกุลจากชนิดไฟล์จริง ไม่ใช่จากชื่อไฟล์ที่ผู้ใช้ตั้ง — "photo" เฉย ๆ
// ไม่มีจุดเลยจะได้ path ที่ลงท้ายด้วยชื่อไฟล์ทั้งก้อนแทนที่จะเป็นนามสกุล
const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const imageExt = (file) => EXT_BY_TYPE[file.type] ?? "bin";

// ลบไฟล์ทั้งหมดใต้โฟลเดอร์ของเรคอร์ดหนึ่ง ๆ (news/<id>/, amenities/<id>/)
//
// เดิมการลบข่าว/สิ่งอำนวยความสะดวกลบแค่แถวใน DB ปล่อยให้รูปค้างอยู่ใน bucket
// ตลอดไปโดยไม่มีอะไรอ้างถึงอีกเลย — ลบไม่สำเร็จไม่ถือเป็น error ของการลบ
// เรคอร์ด (แถวหายไปแล้วจริง) แค่บันทึกไว้ใน console
export async function removeStorageFolder(bucket, folder) {
  try {
    const { data, error } = await supabase.storage.from(bucket).list(String(folder));
    if (error) throw error;

    const paths = (data ?? []).map((file) => `${folder}/${file.name}`);
    if (paths.length === 0) return;

    const { error: removeError } = await supabase.storage.from(bucket).remove(paths);
    if (removeError) throw removeError;
  } catch (err) {
    console.error(`ลบไฟล์ใน bucket ${bucket}/${folder} ไม่สำเร็จ:`, err);
  }
}
