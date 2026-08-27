import { useEffect, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Switch } from "../components/DashboardWidgets";
import { useAdminAmenities, useFacilitiesPageSettings } from "../hooks/useAmenities";
import {
  addAmenityFact,
  createAmenity,
  deleteAmenity,
  deleteAmenityFact,
  reorderAmenities,
  reorderAmenityFacts,
  updateAmenity,
  updateAmenityFact,
  updateFacilitiesPageSettings,
  uploadAmenityImage,
} from "../lib/amenities";
import { assertImageFile } from "../lib/uploads";
import { errorMessage } from "../lib/errors";
import "./AdminFacilities.css";

const EMPTY_HEADER = { eyebrow: "", heading: "", intro: "" };

const BASE_NEW_NAME = "รายการใหม่";

// "รายการใหม่", "รายการใหม่ 2", "รายการใหม่ 3", ...
function nextAmenityName(amenities) {
  const taken = new Set(amenities.map((a) => a.name));
  if (!taken.has(BASE_NEW_NAME)) return BASE_NEW_NAME;

  for (let n = 2; ; n += 1) {
    const candidate = `${BASE_NEW_NAME} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function DragHandle() {
  return (
    <span className="admin-facilities__drag-handle" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <span key={i} />
      ))}
    </span>
  );
}

// ระหว่างลากสลับลำดับ ข้อมูลจริงบนเซิร์ฟเวอร์ยังไม่เปลี่ยนจนกว่า reorder
// จะเสร็จและ reload ข้อมูลใหม่มา — ถ้าไม่มี order ชั่วคราวนี้ แถวจะกระตุก
// กลับตำแหน่งเดิมทันทีที่ปล่อยเมาส์ (เพราะ dragOver state ถูกเคลียร์ก่อน)
// แล้วค่อยกระโดดไปตำแหน่งใหม่อีกทีตอนข้อมูลโหลดเสร็จ — ฟังก์ชันนี้เอา order
// ชั่วคราวมาจัดเรียงรายการจริงให้เห็นผลทันทีโดยไม่ต้องรอเครือข่าย พร้อมเผื่อ
// รายการที่เพิ่ม/ลบไประหว่างนั้น (ไม่มีใน order เดิมก็ต่อท้ายหรือหายไปเอง)
function applyLocalOrder(items, orderIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(orderIds);
  const rest = items.filter((item) => !orderedIds.has(item.id));
  return [...ordered, ...rest];
}

// แยกเป็นคอมโพเนนต์ลูก + key={amenity.id} จากฝั่งเรียก แทนการ sync ฟอร์มด้วย
// useEffect เวลาสลับรายการที่เลือก — เปลี่ยน key แล้ว React unmount/mount
// ใหม่ให้เอง ฟอร์มจึงเริ่มจาก props ล่าสุดเสมอโดยไม่ต้อง setState ใน effect
// (ตรงกับ react-hooks/set-state-in-effect ของ eslint-plugin-react-hooks)
function AmenityEditPanel({
  amenity,
  categories,
  loading,
  onSave,
  onAddFact,
  onEditFact,
  onRemoveFact,
  onReorderFacts,
}) {
  const [form, setForm] = useState({
    name: amenity.name,
    category: amenity.category,
    description: amenity.description,
    isVisible: amenity.isVisible,
  });
  // เก็บ object URL คู่กับไฟล์ ไม่สร้างใหม่ทุก render (เหตุผลเดียวกับ
  // AdminNewsEditor)
  const [image, setImage] = useState({ file: null, url: null });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // ฟอร์ม facts แยก error/สถานะของตัวเองออกจากฟอร์มข้อมูลพื้นฐานด้านบน
  // เพราะเป็นการกระทำคนละก้อน (แก้ไข/เพิ่ม/ลบ/ลากสลับลำดับ) ที่เกิดขึ้นได้
  // พร้อมกันได้อิสระจากปุ่ม "บันทึก" หลัก
  const [factError, setFactError] = useState("");
  const [factBusy, setFactBusy] = useState(false);
  const [editingFactId, setEditingFactId] = useState(null);
  const [factDraft, setFactDraft] = useState({ label: "", value: "" });
  const [addingFact, setAddingFact] = useState(false);
  const [newFact, setNewFact] = useState({ label: "", value: "" });
  const [confirmRemoveFactId, setConfirmRemoveFactId] = useState(null);
  const [dragFactIndex, setDragFactIndex] = useState(null);
  const [dragOverFactIndex, setDragOverFactIndex] = useState(null);
  // order ชั่วคราวระหว่างรอ reorder จริงยืนยันกลับมา (ดู applyLocalOrder) —
  // ล้างทิ้งด้วยการเทียบ loading กับรอบก่อนหน้าตอน render ตรง ๆ (ไม่ใช้
  // useEffect ตั้ง state ตามที่ eslint-plugin-react-hooks ห้ามไว้) เมื่อ
  // loading เปลี่ยนจาก true เป็น false แปลว่าข้อมูลใหม่มาแล้ว ของชั่วคราว
  // ไม่จำเป็นอีกต่อไป
  const [localFactOrder, setLocalFactOrder] = useState(null);
  const [prevLoading, setPrevLoading] = useState(loading);
  if (loading !== prevLoading) {
    setPrevLoading(loading);
    if (!loading) setLocalFactOrder(null);
  }

  useEffect(() => {
    if (!image.url) return undefined;
    return () => URL.revokeObjectURL(image.url);
  }, [image.url]);

  const displayFacts = localFactOrder ? applyLocalOrder(amenity.facts, localFactOrder) : amenity.facts;

  function pickImage(file) {
    setSaveError("");

    try {
      assertImageFile(file);
    } catch (err) {
      setSaveError(err.message);
      return;
    }

    setImage(file ? { file, url: URL.createObjectURL(file) } : { file: null, url: null });
  }

  function handleCancel() {
    setForm({
      name: amenity.name,
      category: amenity.category,
      description: amenity.description,
      isVisible: amenity.isVisible,
    });
    setImage({ file: null, url: null });
    setSaveError("");
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave(amenity, form, image.file);
      setImage({ file: null, url: null });
    } catch (err) {
      console.error("updateAmenity failed:", err);
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function startEditFact(fact) {
    setFactError("");
    setConfirmRemoveFactId(null);
    setEditingFactId(fact.id);
    setFactDraft({ label: fact.label, value: fact.value });
  }

  async function saveEditFact(fact) {
    if (!factDraft.label.trim() || !factDraft.value.trim()) return;

    setFactBusy(true);
    setFactError("");
    try {
      await onEditFact(fact, { label: factDraft.label.trim(), value: factDraft.value.trim() });
      setEditingFactId(null);
    } catch (err) {
      console.error("updateAmenityFact failed:", err);
      setFactError(errorMessage(err));
    } finally {
      setFactBusy(false);
    }
  }

  function startAddFact() {
    setFactError("");
    setNewFact({ label: "", value: "" });
    setAddingFact(true);
  }

  async function confirmAddFact() {
    if (!newFact.label.trim() || !newFact.value.trim()) return;

    setFactBusy(true);
    setFactError("");
    try {
      await onAddFact(amenity, newFact.label.trim(), newFact.value.trim());
      setAddingFact(false);
    } catch (err) {
      console.error("addAmenityFact failed:", err);
      setFactError(errorMessage(err));
    } finally {
      setFactBusy(false);
    }
  }

  async function confirmRemoveFact(fact) {
    setFactBusy(true);
    setFactError("");
    try {
      await onRemoveFact(fact);
      setConfirmRemoveFactId(null);
    } catch (err) {
      console.error("deleteAmenityFact failed:", err);
      setFactError(errorMessage(err));
    } finally {
      setFactBusy(false);
    }
  }

  function handleFactDragEnd() {
    setDragFactIndex(null);
    setDragOverFactIndex(null);
  }

  async function handleFactDrop(index) {
    const from = dragFactIndex;
    handleFactDragEnd();
    if (from === null || from === index) return;

    const reordered = [...displayFacts];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);

    setLocalFactOrder(reordered.map((f) => f.id));
    setFactError("");
    try {
      await onReorderFacts(reordered);
    } catch (err) {
      console.error("reorderAmenityFacts failed:", err);
      setFactError(errorMessage(err));
      setLocalFactOrder(null);
    }
  }

  const imagePreview = image.url ?? amenity.imageUrl;

  return (
    <aside className="dash-card admin-facilities__edit">
      <div className="admin-facilities__edit-header">
        <h2>แก้ไข: {amenity.name}</h2>
      </div>

      {saveError && <div className="dash-message dash-message--error">{saveError}</div>}

      <label htmlFor="amenity-image" className="admin-facilities__edit-photo-label">
        <div
          className="admin-facilities__edit-photo"
          style={imagePreview ? { backgroundImage: `url(${imagePreview})` } : undefined}
        />
      </label>
      <input
        id="amenity-image"
        type="file"
        accept="image/*"
        className="admin-facilities__file-input"
        onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
      />
      <label htmlFor="amenity-image" className="dash-btn admin-facilities__image-btn">
        เปลี่ยนรูปภาพ
      </label>

      <div className="dash-field">
        <label className="dash-field__label">ชื่อ</label>
        <input
          className="dash-input"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </div>

      <div className="dash-field">
        <label className="dash-field__label">หมวดหมู่</label>
        <input
          className="dash-input"
          list="admin-facilities-categories"
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
        />
        <datalist id="admin-facilities-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="dash-field">
        <label className="dash-field__label">คำอธิบาย</label>
        <textarea
          className="dash-textarea"
          rows={3}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>

      <p className="admin-facilities__facts-label">ข้อมูลรายละเอียด</p>
      {factError && <div className="dash-message dash-message--error">{factError}</div>}

      {displayFacts.map((fact, index) => (
        <div
          key={fact.id}
          className={`admin-facilities__fact ${
            dragFactIndex === index ? "admin-facilities__fact--dragging" : ""
          } ${dragOverFactIndex === index ? "admin-facilities__fact--drag-over" : ""}`}
          draggable={editingFactId !== fact.id && confirmRemoveFactId !== fact.id}
          onDragStart={() => setDragFactIndex(index)}
          onDragEnter={() => {
            if (dragFactIndex !== null && index !== dragFactIndex) setDragOverFactIndex(index);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => handleFactDrop(index)}
          onDragEnd={handleFactDragEnd}
        >
          <span className="admin-facilities__fact-drag" aria-hidden="true">
            ⠿
          </span>

          {editingFactId === fact.id ? (
            <>
              <input
                className="dash-input admin-facilities__fact-input admin-facilities__fact-input--label"
                value={factDraft.label}
                onChange={(e) => setFactDraft((f) => ({ ...f, label: e.target.value }))}
                autoFocus
              />
              <input
                className="dash-input admin-facilities__fact-input admin-facilities__fact-input--value"
                value={factDraft.value}
                onChange={(e) => setFactDraft((f) => ({ ...f, value: e.target.value }))}
              />
              <button
                type="button"
                className="admin-facilities__fact-icon-btn admin-facilities__fact-icon-btn--save"
                aria-label="บันทึกข้อมูล"
                disabled={factBusy}
                onClick={() => saveEditFact(fact)}
              >
                ✓
              </button>
              <button
                type="button"
                className="admin-facilities__fact-icon-btn"
                aria-label="ยกเลิกการแก้ไข"
                onClick={() => setEditingFactId(null)}
              >
                ✕
              </button>
            </>
          ) : confirmRemoveFactId === fact.id ? (
            <>
              <span className="admin-facilities__fact-confirm-text">ลบข้อมูลนี้?</span>
              <button
                type="button"
                className="dash-btn"
                onClick={() => setConfirmRemoveFactId(null)}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                className="dash-btn dash-btn--cancel"
                disabled={factBusy}
                onClick={() => confirmRemoveFact(fact)}
              >
                ยืนยัน
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="admin-facilities__fact-label"
                onClick={() => startEditFact(fact)}
              >
                {fact.label}
              </button>
              <button
                type="button"
                className="admin-facilities__fact-value"
                onClick={() => startEditFact(fact)}
              >
                {fact.value}
              </button>
              <button
                type="button"
                className="admin-facilities__fact-remove"
                aria-label="ลบข้อมูล"
                onClick={() => setConfirmRemoveFactId(fact.id)}
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}

      {addingFact ? (
        <div className="admin-facilities__fact-add-form">
          <input
            className="dash-input"
            placeholder="ชื่อรายการ เช่น ตำแหน่ง, เวลาเปิด"
            value={newFact.label}
            onChange={(e) => setNewFact((f) => ({ ...f, label: e.target.value }))}
            autoFocus
          />
          <input
            className="dash-input"
            placeholder="รายละเอียด"
            value={newFact.value}
            onChange={(e) => setNewFact((f) => ({ ...f, value: e.target.value }))}
          />
          <div className="admin-facilities__fact-add-actions">
            <button type="button" className="dash-btn" onClick={() => setAddingFact(false)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="dash-btn dash-btn--add"
              disabled={factBusy}
              onClick={confirmAddFact}
            >
              เพิ่ม
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="dash-btn" onClick={startAddFact}>
          ＋ เพิ่มข้อมูล
        </button>
      )}

      <div className="admin-facilities__toggle-row">
        <p>แสดงบนหน้าเว็บ</p>
        <Switch
          on={form.isVisible}
          onChange={(v) => setForm((f) => ({ ...f, isVisible: v }))}
          label="แสดงบนหน้าเว็บ"
        />
      </div>

      <div className="admin-facilities__edit-actions">
        <button type="button" className="dash-btn admin-facilities__cancel" onClick={handleCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--add admin-facilities__save"
          disabled={saving}
          onClick={handleSave}
        >
          {saving ? "กำลังบันทึก..." : "บันทึก"}
        </button>
      </div>
    </aside>
  );
}

export default function AdminFacilities() {
  const [reloadKey, setReloadKey] = useState(0);
  const { amenities, loading, error } = useAdminAmenities(reloadKey);
  const { settings } = useFacilitiesPageSettings(reloadKey);

  const [selectedId, setSelectedId] = useState(null);
  const [actionError, setActionError] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  // order ชั่วคราวระหว่างรอ reorder จริงยืนยันกลับมา — ล้างด้วยการเทียบ
  // loading กับรอบก่อนหน้าตอน render แทน useEffect (เหตุผลเดียวกับ
  // localFactOrder ใน AmenityEditPanel)
  const [localOrder, setLocalOrder] = useState(null);
  const [prevAmenitiesLoading, setPrevAmenitiesLoading] = useState(loading);
  if (loading !== prevAmenitiesLoading) {
    setPrevAmenitiesLoading(loading);
    if (!loading) setLocalOrder(null);
  }

  const displayAmenities = localOrder ? applyLocalOrder(amenities, localOrder) : amenities;
  const categories = [...new Set(amenities.map((a) => a.category).filter(Boolean))].sort();

  // headerDraft เป็น null จนกว่าผู้ใช้จะเริ่มพิมพ์ — ก่อนหน้านั้นแสดงค่าจาก
  // settings ที่โหลดมาตรง ๆ (แทนการ setState ใน effect เมื่อ settings มาถึง)
  const [headerDraft, setHeaderDraft] = useState(null);
  const [savingHeader, setSavingHeader] = useState(false);
  const header = headerDraft ?? settings ?? EMPTY_HEADER;

  // ถ้ายังไม่เคยเลือก หรือของเดิมถูกลบไปแล้ว ใช้รายการแรกแทน — คำนวณระหว่าง
  // render ไม่ต้องมี effect
  const effectiveSelectedId = amenities.some((a) => a.id === selectedId)
    ? selectedId
    : (amenities[0]?.id ?? null);
  const selected = amenities.find((a) => a.id === effectiveSelectedId) ?? null;

  async function handleAdd() {
    setActionError("");
    try {
      const created = await createAmenity({
        // club_amenities.name เป็น unique — กด "เพิ่มรายการ" สองครั้งติดโดยยัง
        // ไม่ทันตั้งชื่อจะชนกันเองแล้วเด้ง error ดิบภาษาอังกฤษออกมา
        name: nextAmenityName(amenities),
        category: "",
        description: "",
        position: amenities.length,
        isVisible: true,
      });
      setReloadKey((k) => k + 1);
      setSelectedId(created.id);
    } catch (err) {
      console.error("createAmenity failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleDelete(item) {
    // ลบทีเดียวหายทั้งรายการ ทั้งรูปใน bucket และ facts ที่ผูกอยู่ (cascade)
    // ไม่มีถังขยะให้กู้คืน — ยืนยันแบบ inline ในแถวก่อนแทน window.confirm
    setActionError("");
    try {
      await deleteAmenity(item.id);
      setConfirmDeleteId(null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("deleteAmenity failed:", err);
      setActionError(errorMessage(err));
    }
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  async function handleDrop(index) {
    const from = dragIndex;
    handleDragEnd();
    if (from === null || from === index) return;

    const reordered = [...displayAmenities];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);

    setLocalOrder(reordered.map((a) => a.id));
    setActionError("");
    try {
      await reorderAmenities(reordered);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("reorderAmenities failed:", err);
      setActionError(errorMessage(err));
      setLocalOrder(null);
    }
  }

  async function handleSaveAmenity(amenity, form, imageFile) {
    let imageUrl = amenity.imageUrl;
    if (imageFile) {
      imageUrl = await uploadAmenityImage(imageFile, amenity.id);
    }

    await updateAmenity(amenity.id, { ...form, imageUrl });
    setReloadKey((k) => k + 1);
  }

  // handler ของ facts ต่อไปนี้ตั้งใจไม่ catch error เอง — ปล่อยให้
  // AmenityEditPanel ที่เป็นเจ้าของ UI ของ facts จัดการ error/สถานะกำลังโหลด
  // ของตัวเอง (ต่างจาก handleDelete/handleAdd ด้านบนที่ error แสดงที่หน้ารวม)
  async function handleAddFact(amenity, label, value) {
    await addAmenityFact(amenity.id, label, value, amenity.facts.length);
    setReloadKey((k) => k + 1);
  }

  async function handleEditFact(fact, { label, value }) {
    await updateAmenityFact(fact.id, { label, value });
    setReloadKey((k) => k + 1);
  }

  async function handleRemoveFact(fact) {
    await deleteAmenityFact(fact.id);
    setReloadKey((k) => k + 1);
  }

  async function handleReorderFacts(reorderedFacts) {
    await reorderAmenityFacts(reorderedFacts);
    setReloadKey((k) => k + 1);
  }

  async function handleSaveHeader() {
    setSavingHeader(true);
    setActionError("");
    try {
      await updateFacilitiesPageSettings(header);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("updateFacilitiesPageSettings failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingHeader(false);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการสิ่งอำนวยความสะดวก"
      subtitle="แก้ไขเนื้อหาที่แสดงบนหน้า FACILITIES ของเว็บไซต์"
      headerExtra={
        <div className="admin-facilities__actions">
          <a href="/facilities" target="_blank" rel="noreferrer" className="dash-btn">
            ดูหน้าเว็บ
          </a>
          <button type="button" className="dash-btn dash-btn--add" onClick={handleAdd}>
            ＋ เพิ่มรายการ
          </button>
        </div>
      }
    >
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="admin-facilities">
        <div className="admin-facilities__main">
          <section className="dash-card admin-facilities__section">
            <h2>ส่วนหัวของหน้า</h2>
            <div className="dash-field">
              <label className="dash-field__label">ป้ายกำกับ (eyebrow)</label>
              <input
                className="dash-input"
                value={header.eyebrow}
                onChange={(e) => setHeaderDraft({ ...header, eyebrow: e.target.value })}
              />
            </div>
            <div className="dash-field">
              <label className="dash-field__label">หัวข้อหลัก</label>
              <input
                className="dash-input"
                value={header.heading}
                onChange={(e) => setHeaderDraft({ ...header, heading: e.target.value })}
              />
            </div>
            <div className="dash-field">
              <label className="dash-field__label">คำโปรย</label>
              <textarea
                className="dash-textarea"
                rows={3}
                value={header.intro}
                onChange={(e) => setHeaderDraft({ ...header, intro: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="dash-btn dash-btn--add admin-facilities__header-save"
              disabled={savingHeader}
              onClick={handleSaveHeader}
            >
              {savingHeader ? "กำลังบันทึก..." : "บันทึกส่วนหัว"}
            </button>
          </section>

          <section className="dash-card admin-facilities__list-card">
            <div className="admin-facilities__list-header">
              <h2>รายการสิ่งอำนวยความสะดวก</h2>
              <span className="dash-pill dash-pill--tint">{amenities.length} รายการ</span>
            </div>

            {loading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
            {!loading && error && <div className="dash-message dash-message--error">{error}</div>}
            {!loading && !error && amenities.length === 0 && (
              <p className="dash-empty">ยังไม่มีรายการ</p>
            )}

            {displayAmenities.map((item, index) => (
              <div
                key={item.id}
                className={`admin-facilities__row ${
                  dragIndex === index ? "admin-facilities__row--dragging" : ""
                } ${dragOverIndex === index ? "admin-facilities__row--drag-over" : ""}`}
                draggable={confirmDeleteId !== item.id}
                onDragStart={() => setDragIndex(index)}
                onDragEnter={() => {
                  if (dragIndex !== null && index !== dragIndex) setDragOverIndex(index);
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
              >
                <DragHandle />
                <span className="admin-facilities__no">{String(index + 1).padStart(2, "0")}</span>
                <div
                  className="admin-facilities__thumb"
                  aria-hidden="true"
                  style={item.imageUrl ? { backgroundImage: `url(${item.imageUrl})` } : undefined}
                />
                <div className="admin-facilities__info">
                  <p className="admin-facilities__name">{item.name}</p>
                  <p className="admin-facilities__subtitle">
                    {item.category ? `${item.category} · ` : ""}
                    {item.description}
                  </p>
                </div>
                <span
                  className={`dash-pill ${
                    item.isVisible ? "admin-facilities__status--on" : "admin-facilities__status--off"
                  }`}
                >
                  {item.isVisible ? "แสดงอยู่" : "ซ่อน"}
                </span>

                {confirmDeleteId === item.id ? (
                  <div className="admin-facilities__confirm">
                    <span>ลบถาวร?</span>
                    <button
                      type="button"
                      className="dash-btn"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      onClick={() => handleDelete(item)}
                    >
                      ยืนยัน
                    </button>
                  </div>
                ) : (
                  <>
                    <button type="button" className="dash-btn" onClick={() => setSelectedId(item.id)}>
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      onClick={() => setConfirmDeleteId(item.id)}
                    >
                      ลบ
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>
        </div>

        {selected && (
          <AmenityEditPanel
            key={selected.id}
            amenity={selected}
            categories={categories}
            loading={loading}
            onSave={handleSaveAmenity}
            onAddFact={handleAddFact}
            onEditFact={handleEditFact}
            onRemoveFact={handleRemoveFact}
            onReorderFacts={handleReorderFacts}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
