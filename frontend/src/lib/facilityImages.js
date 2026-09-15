// แกลเลอรีรูปของสนาม — อัปโหลด/ครอบตัด/จัดลำดับ/ตั้งรูปหลัก
//
// ไฟล์จริงอยู่ใน bucket "facility-images" ส่วนแถวในตาราง facility_images เก็บ
// public URL + ลำดับ + ขนาด ทั้งสองฝั่งต้องถูกลบ/อัปเดตคู่กันเสมอ
import { supabase } from "./supabase";
import { assertImageFile, imageExt } from "./uploads";

export const MAX_IMAGES_PER_FACILITY = 10;
export const RECOMMENDED_WIDTH = 1600;
export const RECOMMENDED_HEIGHT = 900;

const IMAGE_SELECT = "id, facility_id, image_url, caption, is_primary, sort_order, width, height, size_bytes";

function toImage(row) {
  return {
    id: row.id,
    facilityId: row.facility_id,
    imageUrl: row.image_url,
    caption: row.caption ?? "",
    isPrimary: row.is_primary,
    sortOrder: row.sort_order,
    width: row.width,
    height: row.height,
    sizeBytes: row.size_bytes,
  };
}

export async function fetchFacilityImages(facilityId) {
  const { data, error } = await supabase
    .from("facility_images")
    .select(IMAGE_SELECT)
    .eq("facility_id", facilityId)
    .order("sort_order");

  if (error) throw error;
  return (data ?? []).map(toImage);
}

// อ่านขนาดจริงของรูปจากฝั่ง client ก่อนอัปโหลด — ใช้เตือน "ความละเอียดต่ำ"
// บนหน้า admin โดยไม่ต้องให้ server มา probe ไฟล์ซ้ำทีหลัง
function readImageDimensions(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });
}

export async function uploadFacilityImage(file, facilityId, { existingCount = 0, isFirst = false } = {}) {
  assertImageFile(file);

  if (existingCount >= MAX_IMAGES_PER_FACILITY) {
    throw new Error(`สนามหนึ่งอัปโหลดได้สูงสุด ${MAX_IMAGES_PER_FACILITY} รูป`);
  }

  const { width, height } = await readImageDimensions(file);
  const path = `${facilityId}/${Date.now()}.${imageExt(file)}`;

  const { error: uploadError } = await supabase.storage
    .from("facility-images")
    .upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("facility-images").getPublicUrl(path);

  const { data, error } = await supabase
    .from("facility_images")
    .insert({
      facility_id: facilityId,
      image_url: publicData.publicUrl,
      caption: "",
      is_primary: isFirst,
      sort_order: existingCount,
      width,
      height,
      size_bytes: file.size,
    })
    .select(IMAGE_SELECT)
    .single();

  if (error) throw error;
  return toImage(data);
}

// ใช้ตอนยืนยันครอบตัดรูป — อัปโหลดทับไฟล์เดิม (คนละ path ใหม่กันแคชเบราว์เซอร์
// ค้าง) แล้วอัปเดตแถวเดิมให้ชี้ไปที่ไฟล์ใหม่ + ขนาดใหม่
export async function replaceImageFile(image, blob) {
  const path = `${image.facilityId}/${Date.now()}-cropped.jpg`;

  const { error: uploadError } = await supabase.storage
    .from("facility-images")
    .upload(path, blob, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) throw uploadError;

  const { data: publicData } = supabase.storage.from("facility-images").getPublicUrl(path);

  const dims = await new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: null, height: null });
    };
    img.src = url;
  });

  const { data, error } = await supabase
    .from("facility_images")
    .update({
      image_url: publicData.publicUrl,
      width: dims.width,
      height: dims.height,
      size_bytes: blob.size,
    })
    .eq("id", image.id)
    .select(IMAGE_SELECT)
    .single();

  if (error) throw error;
  return toImage(data);
}

export async function updateImageCaption(imageId, caption) {
  const { error } = await supabase.from("facility_images").update({ caption }).eq("id", imageId);
  if (error) throw error;
}

export async function setPrimaryImage(imageId) {
  const { error } = await supabase.rpc("set_facility_primary_image", { p_image_id: imageId });
  if (error) throw error;
}

export async function deleteFacilityImage(image) {
  const { error } = await supabase.from("facility_images").delete().eq("id", image.id);
  if (error) throw error;

  // path เดิมไม่ได้เก็บแยกไว้ในแถว มีแค่ public URL — ตัดเอาส่วนท้ายหลังชื่อ
  // bucket ออกมาใช้ลบไฟล์จริงใน storage กันขยะค้าง (เหมือน removeStorageFolder
  // ใน lib/uploads.js แต่ที่นี่ลบทีละไฟล์ ไม่ใช่ทั้งโฟลเดอร์ เพราะโฟลเดอร์
  // ของสนามหนึ่งมีรูปอื่นที่ยังต้องเก็บอยู่)
  const marker = "/facility-images/";
  const idx = image.imageUrl.indexOf(marker);
  if (idx === -1) return;

  const path = image.imageUrl.slice(idx + marker.length);
  await supabase.storage.from("facility-images").remove([path]).catch((err) => {
    console.error("ลบไฟล์รูปสนามใน storage ไม่สำเร็จ:", err);
  });
}

async function reorderRows(table, orderedRows) {
  const updates = orderedRows
    .map((row, index) => ({ id: row.id, sortOrder: index, changed: row.sortOrder !== index }))
    .filter((u) => u.changed);

  if (updates.length === 0) return;

  const results = await Promise.all(
    updates.map((u) => supabase.from(table).update({ sort_order: u.sortOrder }).eq("id", u.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export function reorderFacilityImages(orderedImages) {
  return reorderRows("facility_images", orderedImages);
}
