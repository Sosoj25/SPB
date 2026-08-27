import { useRef, useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import ImageCropModal from "../components/ImageCropModal";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchFacilitiesBySport, fetchSportCatalog, sportImage } from "../lib/catalog";
import { useFacilityImages } from "../hooks/useFacilityImages";
import {
  MAX_IMAGES_PER_FACILITY,
  RECOMMENDED_HEIGHT,
  RECOMMENDED_WIDTH,
  deleteFacilityImage,
  reorderFacilityImages,
  replaceImageFile,
  setPrimaryImage,
  updateImageCaption,
  uploadFacilityImage,
} from "../lib/facilityImages";
import { formatBaht } from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./AdminFacilityImages.css";

const EMPTY_LIST = [];

function applyLocalOrder(items, orderIds) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered = orderIds.map((id) => byId.get(id)).filter(Boolean);
  const orderedIds = new Set(orderIds);
  const rest = items.filter((item) => !orderedIds.has(item.id));
  return [...ordered, ...rest];
}

function formatKb(bytes) {
  if (!bytes) return "";
  return `${Math.round(bytes / 1024)} KB`;
}

export default function AdminFacilityImages() {
  const fileInputRef = useRef(null);
  const uploaderRef = useRef(null);

  const [sportId, setSportId] = useState(null);
  const [facilityId, setFacilityId] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [dragOverDrop, setDragOverDrop] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [cropTarget, setCropTarget] = useState(null);
  const [captionDrafts, setCaptionDrafts] = useState({});
  const [editingCaptionId, setEditingCaptionId] = useState(null);
  const [savingCaptions, setSavingCaptions] = useState(false);
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [localOrder, setLocalOrder] = useState(null);

  const { data: sports } = useAsyncData(fetchSportCatalog, "photos-sports", EMPTY_LIST);
  const effectiveSportId = sportId ?? sports[0]?.id ?? null;

  const { data: facilities } = useAsyncData(
    () => fetchFacilitiesBySport(effectiveSportId),
    effectiveSportId != null ? `photos-facilities:${effectiveSportId}` : null,
    EMPTY_LIST,
  );

  const effectiveFacilityId = facilities.some((f) => f.id === facilityId)
    ? facilityId
    : (facilities[0]?.id ?? null);
  const selectedFacility = facilities.find((f) => f.id === effectiveFacilityId);

  const { images, loading: imagesLoading } = useFacilityImages(effectiveFacilityId, reloadKey);

  const [prevLoading, setPrevLoading] = useState(imagesLoading);
  if (imagesLoading !== prevLoading) {
    setPrevLoading(imagesLoading);
    if (!imagesLoading) setLocalOrder(null);
  }

  const displayImages = localOrder ? applyLocalOrder(images, localOrder) : images;
  const coverImage = images.find((img) => img.isPrimary) ?? images[0] ?? null;
  const lowResImages = images.filter(
    (img) => img.width && img.height && (img.width < RECOMMENDED_WIDTH || img.height < RECOMMENDED_HEIGHT),
  );

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleFiles(fileList) {
    if (!effectiveFacilityId) return;
    const files = Array.from(fileList ?? []);
    if (files.length === 0) return;

    setActionError("");
    setUploading(true);

    let count = images.length;
    const errors = [];

    for (const file of files) {
      try {
        await uploadFacilityImage(file, effectiveFacilityId, {
          existingCount: count,
          isFirst: count === 0,
        });
        count += 1;
      } catch (err) {
        console.error("uploadFacilityImage failed:", err);
        errors.push(errorMessage(err));
      }
    }

    setUploading(false);
    if (errors.length > 0) setActionError(errors.join(" · "));
    reload();
  }

  function handleDropzoneDrop(e) {
    e.preventDefault();
    setDragOverDrop(false);
    handleFiles(e.dataTransfer.files);
  }

  async function handleSetPrimary(image) {
    setActionError("");
    try {
      await setPrimaryImage(image.id);
      reload();
    } catch (err) {
      console.error("setPrimaryImage failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleDelete(image) {
    setActionError("");
    try {
      await deleteFacilityImage(image);
      setConfirmDeleteId(null);
      reload();
    } catch (err) {
      console.error("deleteFacilityImage failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function handleCropConfirm(blob) {
    setActionError("");
    try {
      await replaceImageFile(cropTarget, blob);
      setCropTarget(null);
      reload();
    } catch (err) {
      console.error("replaceImageFile failed:", err);
      setActionError(errorMessage(err));
    }
  }

  function handleDragEnd() {
    setDragIndex(null);
    setDragOverIndex(null);
  }

  async function handleGalleryDrop(index) {
    const from = dragIndex;
    handleDragEnd();
    if (from === null || from === index) return;

    const reordered = [...displayImages];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(index, 0, moved);

    setLocalOrder(reordered.map((i) => i.id));
    setActionError("");
    try {
      await reorderFacilityImages(reordered);
      reload();
    } catch (err) {
      console.error("reorderFacilityImages failed:", err);
      setActionError(errorMessage(err));
      setLocalOrder(null);
    }
  }

  const dirtyCaptionCount = Object.entries(captionDrafts).filter(
    ([id, value]) => images.find((i) => String(i.id) === id)?.caption !== value,
  ).length;

  async function handleSaveCaptions() {
    setSavingCaptions(true);
    setActionError("");
    try {
      const dirty = Object.entries(captionDrafts).filter(
        ([id, value]) => images.find((i) => String(i.id) === id)?.caption !== value,
      );
      await Promise.all(dirty.map(([id, value]) => updateImageCaption(Number(id), value)));
      setEditingCaptionId(null);
      reload();
    } catch (err) {
      console.error("updateImageCaption failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingCaptions(false);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="แก้ไขรูปสนาม"
      subtitle="อัปโหลด จัดลำดับ และเลือกรูปหน้าปกที่จะแสดงในหน้าเลือกสนาม"
      headerExtra={
        <div className="photos-page__actions">
          {effectiveSportId != null && (
            <a
              href={`/booking/field?sport=${effectiveSportId}`}
              target="_blank"
              rel="noreferrer"
              className="dash-btn"
            >
              ดูหน้าเว็บ
            </a>
          )}
          <button
            type="button"
            className="dash-btn dash-btn--add"
            disabled={savingCaptions || dirtyCaptionCount === 0}
            onClick={handleSaveCaptions}
          >
            {savingCaptions ? "กำลังบันทึก..." : "บันทึกรูปภาพ"}
          </button>
        </div>
      }
    >
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <div className="photos-page__context">
        <div className="photos-page__context-field">
          <span className="photos-page__context-label">กีฬา</span>
          <select
            className="dash-select"
            value={effectiveSportId ?? ""}
            onChange={(e) => {
              setSportId(Number(e.target.value));
              setFacilityId(null);
            }}
          >
            {sports.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="photos-page__context-field">
          <span className="photos-page__context-label">สนาม</span>
          <select
            className="dash-select"
            value={effectiveFacilityId ?? ""}
            onChange={(e) => setFacilityId(Number(e.target.value))}
          >
            {facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.venueName} · {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="dash-filters__spacer" />
        <span className="dash-pill dash-pill--tint">รูปทั้งหมด {images.length} รูป</span>
      </div>

      {!effectiveFacilityId ? (
        <p className="dash-empty">ยังไม่มีสนามที่เปิดให้จองสำหรับกีฬานี้</p>
      ) : (
        <div className="photos-page">
          <div className="photos-page__main">
            <section className="dash-card" ref={uploaderRef}>
              <h2>อัปโหลดรูปภาพ</h2>
              <div
                className={`dash-dropzone photos-page__dropzone ${dragOverDrop ? "photos-page__dropzone--over" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverDrop(true);
                }}
                onDragLeave={() => setDragOverDrop(false)}
                onDrop={handleDropzoneDrop}
              >
                <strong>ลากไฟล์มาวาง หรือคลิกเพื่อเลือกรูป</strong>
                <span>
                  JPG, PNG, WebP · แนะนำ {RECOMMENDED_WIDTH} × {RECOMMENDED_HEIGHT} px (อัตราส่วน 16:9) ·
                  ไม่เกิน 5 MB ต่อไฟล์
                </span>
                <button type="button" className="dash-btn" disabled={uploading}>
                  {uploading ? "กำลังอัปโหลด..." : "เลือกไฟล์"}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="photos-page__file-input"
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </section>

            <section className="dash-card">
              <div className="photos-page__section-header">
                <div>
                  <h2>คลังรูปของสนามนี้</h2>
                  <p className="photos-page__hint">ลากเพื่อจัดลำดับ · รูปแรกจะถูกใช้เป็นหน้าปก</p>
                </div>
              </div>

              {!imagesLoading && images.length === 0 && (
                <p className="dash-empty">ยังไม่มีรูปภาพ อัปโหลดรูปแรกด้านบน</p>
              )}

              <div className="photos-gallery">
                {displayImages.map((image, index) => (
                  <div
                    key={image.id}
                    className={`photos-gallery__item ${dragIndex === index ? "photos-gallery__item--dragging" : ""} ${
                      dragOverIndex === index ? "photos-gallery__item--drag-over" : ""
                    }`}
                    draggable
                    onDragStart={() => setDragIndex(index)}
                    onDragEnter={() => {
                      if (dragIndex !== null && index !== dragIndex) setDragOverIndex(index);
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleGalleryDrop(index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div
                      className={`photos-gallery__thumb ${image.isPrimary ? "photos-gallery__thumb--cover" : ""}`}
                      style={{ backgroundImage: `url(${image.imageUrl})` }}
                    >
                      <span className={`photos-gallery__badge ${image.isPrimary ? "photos-gallery__badge--cover" : ""}`}>
                        {image.isPrimary ? "หน้าปก" : index + 1}
                      </span>
                    </div>

                    {editingCaptionId === image.id ? (
                      <input
                        className="dash-input photos-gallery__caption-input"
                        autoFocus
                        value={captionDrafts[image.id] ?? image.caption}
                        onChange={(e) =>
                          setCaptionDrafts((d) => ({ ...d, [image.id]: e.target.value }))
                        }
                        onBlur={() => setEditingCaptionId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className="photos-gallery__caption"
                        onClick={() => setEditingCaptionId(image.id)}
                      >
                        {(captionDrafts[image.id] ?? image.caption) || "เพิ่มคำบรรยาย"}
                      </button>
                    )}

                    <p className="photos-gallery__meta">
                      {image.width && image.height ? `${image.width} × ${image.height} · ` : ""}
                      {formatKb(image.sizeBytes)}
                    </p>

                    <div className="photos-gallery__row-actions">
                      {!image.isPrimary && (
                        <button type="button" className="dash-btn" onClick={() => handleSetPrimary(image)}>
                          ตั้งเป็นหน้าปก
                        </button>
                      )}
                      <button type="button" className="dash-btn" onClick={() => setCropTarget(image)}>
                        ครอบตัด
                      </button>
                      {confirmDeleteId === image.id ? (
                        <>
                          <button type="button" className="dash-btn" onClick={() => setConfirmDeleteId(null)}>
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            className="dash-btn dash-btn--cancel"
                            onClick={() => handleDelete(image)}
                          >
                            ยืนยันลบ
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="dash-btn dash-btn--cancel"
                          onClick={() => setConfirmDeleteId(image.id)}
                        >
                          ลบ
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="photos-page__side">
            <section className="dash-card">
              <h2>ตัวอย่างการ์ดสนาม</h2>
              <p className="photos-page__hint">แบบที่ลูกค้าเห็นในหน้าเลือกสนาม</p>

              <div className="photos-preview-card">
                <div
                  className="photos-preview-card__image"
                  style={{
                    backgroundImage: `url(${coverImage?.imageUrl ?? sportImage(selectedFacility?.sportName)})`,
                  }}
                />
                <div className="photos-preview-card__body">
                  <p className="photos-preview-card__name">{selectedFacility?.name ?? "สนาม"}</p>
                  <p className="photos-preview-card__sub">
                    {selectedFacility?.sportName ?? ""}
                    {selectedFacility?.capacity ? ` · ${selectedFacility.capacity} คน` : ""}
                  </p>
                  <div className="photos-preview-card__row">
                    <span className="photos-preview-card__price">
                      {selectedFacility ? `${formatBaht(selectedFacility.pricePerHour)}/ชม.` : ""}
                    </span>
                    <span className="dash-pill dash-pill--active photos-preview-card__cta">เลือก</span>
                  </div>
                </div>
              </div>
            </section>

            <section className="dash-card">
              <h2>ครอบตัดรูป</h2>
              <p className="photos-page__hint">เลือกอัตราส่วนที่จะใช้แสดงผล แล้วกด "ครอบตัด" ที่รูปในคลังด้านซ้าย</p>
              <p className="photos-page__note">อัตราส่วน 16:9 คือค่าที่การ์ดสนามใช้แสดงผล</p>
            </section>

            <section className="dash-card">
              <h2>ข้อกำหนดรูปภาพ</h2>
              <div className="photos-requirements">
                <div className="photos-requirements__row">
                  <span>ขนาดแนะนำ</span>
                  <strong>
                    {RECOMMENDED_WIDTH} × {RECOMMENDED_HEIGHT} px
                  </strong>
                </div>
                <div className="photos-requirements__row">
                  <span>อัตราส่วน</span>
                  <strong>16:9</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>ขนาดไฟล์</span>
                  <strong>ไม่เกิน 5 MB</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>จำนวนรูป</span>
                  <strong>สูงสุด {MAX_IMAGES_PER_FACILITY} รูปต่อสนาม</strong>
                </div>
                <div className="photos-requirements__row">
                  <span>นามสกุล</span>
                  <strong>JPG, PNG, WebP</strong>
                </div>
              </div>
            </section>

            {lowResImages.length > 0 && (
              <section className="photos-warning">
                <p className="photos-warning__title">⚠ พบรูปความละเอียดต่ำ {lowResImages.length} รูป</p>
                <p className="photos-warning__text">
                  {lowResImages
                    .map((img) => `"${img.caption || "ไม่มีชื่อ"}" (${img.width} × ${img.height} px)`)
                    .join(", ")}{" "}
                  ต่ำกว่าที่แนะนำ อาจแตกเมื่อแสดงบนหน้าจอใหญ่
                </p>
                <button
                  type="button"
                  className="dash-btn photos-warning__btn"
                  onClick={() => {
                    fileInputRef.current?.click();
                    uploaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }}
                >
                  อัปโหลดใหม่
                </button>
              </section>
            )}
          </div>
        </div>
      )}

      {cropTarget && (
        <ImageCropModal
          imageUrl={cropTarget.imageUrl}
          onCancel={() => setCropTarget(null)}
          onConfirm={handleCropConfirm}
        />
      )}
    </DashboardLayout>
  );
}
