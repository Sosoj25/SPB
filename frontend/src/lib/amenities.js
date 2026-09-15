// สิ่งอำนวยความสะดวกของคลับที่โชว์ในหน้า /facilities และข้อความหัวหน้าเพจ
//
// แต่ละรายการมี "ข้อมูลย่อย" (club_amenity_facts) เป็นคู่ label/value และมี
// ลำดับที่แอดมินลากจัดเองได้ทั้งสองระดับ
import { supabase } from "./supabase";
import { assertImageFile, imageExt, removeStorageFolder } from "./uploads";

const AMENITY_SELECT = `
  id,
  name,
  category,
  description,
  image_url,
  position,
  is_visible,
  club_amenity_facts ( id, label, value, position )
`;

function toAmenity(row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    description: row.description,
    imageUrl: row.image_url,
    position: row.position,
    isVisible: row.is_visible,
    facts: [...(row.club_amenity_facts ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ id: f.id, label: f.label, value: f.value, position: f.position })),
  };
}

export async function fetchPublicAmenities() {
  const { data, error } = await supabase
    .from("club_amenities")
    .select(AMENITY_SELECT)
    .eq("is_visible", true)
    .order("position");

  if (error) throw error;
  return (data ?? []).map(toAmenity);
}

// admin เห็นทุกรายการรวมที่ซ่อนอยู่ (RLS: is_visible = true or is_admin())
export async function fetchAdminAmenities() {
  const { data, error } = await supabase
    .from("club_amenities")
    .select(AMENITY_SELECT)
    .order("position");

  if (error) throw error;
  return (data ?? []).map(toAmenity);
}

export async function createAmenity(payload) {
  const { data, error } = await supabase
    .from("club_amenities")
    .insert({
      name: payload.name,
      category: payload.category,
      description: payload.description,
      position: payload.position ?? 0,
      is_visible: payload.isVisible ?? true,
    })
    .select(AMENITY_SELECT)
    .single();

  if (error) throw error;
  return toAmenity(data);
}

export async function updateAmenity(id, payload) {
  const row = {};
  if ("name" in payload) row.name = payload.name;
  if ("category" in payload) row.category = payload.category;
  if ("description" in payload) row.description = payload.description;
  if ("imageUrl" in payload) row.image_url = payload.imageUrl;
  if ("position" in payload) row.position = payload.position;
  if ("isVisible" in payload) row.is_visible = payload.isVisible;

  const { data, error } = await supabase
    .from("club_amenities")
    .update(row)
    .eq("id", id)
    .select(AMENITY_SELECT)
    .single();

  if (error) throw error;
  return toAmenity(data);
}

export async function deleteAmenity(id) {
  const { error } = await supabase.from("club_amenities").delete().eq("id", id);
  if (error) throw error;

  // club_amenity_facts หายตามด้วย on delete cascade อยู่แล้ว แต่รูปใน bucket
  // ไม่มีใครตามลบให้ ต้องเก็บกวาดเอง
  await removeStorageFolder("amenities", id);
}

// ลาก-วางเปลี่ยนลำดับ: อัปเดตเฉพาะแถวที่ index เปลี่ยนจริง ไม่ต้องมี RPC
// เพราะ RLS admin manage ครอบคลุมอยู่แล้ว
async function reorderRows(table, orderedRows) {
  const updates = orderedRows
    .map((row, index) => ({ id: row.id, position: index, changed: row.position !== index }))
    .filter((u) => u.changed);

  if (updates.length === 0) return;

  const results = await Promise.all(
    updates.map((u) => supabase.from(table).update({ position: u.position }).eq("id", u.id)),
  );
  const failed = results.find((r) => r.error);
  if (failed) throw failed.error;
}

export function reorderAmenities(orderedAmenities) {
  return reorderRows("club_amenities", orderedAmenities);
}

export function reorderAmenityFacts(orderedFacts) {
  return reorderRows("club_amenity_facts", orderedFacts);
}

export async function addAmenityFact(amenityId, label, value, position) {
  const { data, error } = await supabase
    .from("club_amenity_facts")
    .insert({ amenity_id: amenityId, label, value, position })
    .select("id, label, value, position")
    .single();

  if (error) throw error;
  return data;
}

export async function updateAmenityFact(factId, { label, value }) {
  const { data, error } = await supabase
    .from("club_amenity_facts")
    .update({ label, value })
    .eq("id", factId)
    .select("id, label, value, position")
    .single();

  if (error) throw error;
  return data;
}

export async function deleteAmenityFact(factId) {
  const { error } = await supabase.from("club_amenity_facts").delete().eq("id", factId);
  if (error) throw error;
}

// path ไม่ผูกกับ user (bucket amenities เขียนได้เฉพาะ admin ทั้งทีม ดู 0020)
export async function uploadAmenityImage(file, amenityId) {
  assertImageFile(file);

  const path = `${amenityId}/${Date.now()}.${imageExt(file)}`;

  const { error } = await supabase.storage.from("amenities").upload(path, file, {
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from("amenities").getPublicUrl(path);
  return data.publicUrl;
}

export async function fetchFacilitiesPageSettings() {
  const { data, error } = await supabase
    .from("facilities_page_settings")
    .select("eyebrow, heading, intro")
    .eq("id", 1)
    .single();

  if (error) throw error;
  return data;
}

export async function updateFacilitiesPageSettings(payload) {
  const { data, error } = await supabase
    .from("facilities_page_settings")
    .update(payload)
    .eq("id", 1)
    .select("eyebrow, heading, intro")
    .single();

  if (error) throw error;
  return data;
}
