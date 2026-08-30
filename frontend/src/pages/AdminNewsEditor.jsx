import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Switch } from "../components/DashboardWidgets";
import ImageCropModal from "../components/ImageCropModal";
import { useAuth } from "../context/useAuth";
import { useNewsById } from "../hooks/useNews";
import { NEWS_CATEGORIES, createNews, updateNews, uploadNewsCoverImage } from "../lib/news";
import { assertImageFile } from "../lib/uploads";
import { errorMessage } from "../lib/errors";
import "./AdminNewsEditor.css";

const pad = (n) => String(n).padStart(2, "0");

function toDateInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTimeInput(iso) {
  const d = iso ? new Date(iso) : new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM = {
  title: "",
  subtitle: "",
  content: "",
  category: NEWS_CATEGORIES[0],
  tags: [],
  isFeatured: false,
  coverImage: null,
  publishDate: toDateInput(),
  publishTime: toTimeInput(),
};

export default function AdminNewsEditor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const newsId = searchParams.get("id") ? Number(searchParams.get("id")) : null;

  const { news, loading, error } = useNewsById(newsId);

  if (loading) {
    return (
      <DashboardLayout variant="admin" title="แก้ไขข่าว">
        <p className="dash-empty">กำลังโหลดข้อมูล...</p>
      </DashboardLayout>
    );
  }

  if (newsId && error) {
    return (
      <DashboardLayout variant="admin" title="แก้ไขข่าว">
        <div className="dash-message dash-message--error">{error || "ไม่พบข่าวนี้"}</div>
      </DashboardLayout>
    );
  }

  // key={newsId} ทำให้สลับไปแก้ข่าวอีกชิ้น (หรือจากแก้ไข -> เขียนใหม่) แล้ว
  // ฟอร์ม mount ใหม่พร้อมค่าเริ่มต้นจาก news ล่าสุดเสมอ แทนการ setState ใน
  // effect เมื่อ news เปลี่ยน (ตรงกับ react-hooks/set-state-in-effect)
  return (
    <NewsEditorForm
      key={newsId ?? "new"}
      newsId={newsId}
      news={news}
      profile={profile}
      navigate={navigate}
    />
  );
}

function NewsEditorForm({ newsId, news, profile, navigate }) {
  const [form, setForm] = useState(() =>
    news
      ? {
          title: news.title,
          subtitle: news.subtitle,
          content: news.content,
          category: news.category,
          tags: news.tags,
          isFeatured: news.isFeatured,
          coverImage: news.coverImage,
          publishDate: toDateInput(news.publishedAt),
          publishTime: toTimeInput(news.publishedAt),
        }
      : EMPTY_FORM,
  );
  const [status, setStatus] = useState(news?.status ?? "draft");
  // เก็บ object URL ไว้คู่กับไฟล์ แทนการเรียก URL.createObjectURL() ตอน render
  // ซึ่งสร้าง URL ใหม่ทุกรอบและไม่มีใครคืนให้เบราว์เซอร์เลยสักอัน
  const [cover, setCover] = useState({ file: null, url: null });
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);

  // คืน object URL เมื่อเปลี่ยนรูปหรือออกจากหน้า
  useEffect(() => {
    if (!cover.url) return undefined;
    return () => URL.revokeObjectURL(cover.url);
  }, [cover.url]);

  // เช็คขนาด/ชนิดไฟล์ตั้งแต่ตอนเลือก ไม่ปล่อยให้รออัปโหลดจนจบแล้วค่อยเด้ง
  // error ดิบจาก storage (bucket news จำกัด 5 MB + เฉพาะไฟล์ภาพ ดู 0021)
  function pickCover(file) {
    setSaveError("");

    try {
      assertImageFile(file);
    } catch (err) {
      setSaveError(err.message);
      return;
    }

    setCover(file ? { file, url: URL.createObjectURL(file) } : { file: null, url: null });
  }

  function handleCropConfirm(blob) {
    const file = new File([blob], "cover.jpg", { type: "image/jpeg" });
    setCover({ file, url: URL.createObjectURL(blob) });
    setCropOpen(false);
  }

  function updateField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function removeTag(tag) {
    setForm((prev) => ({ ...prev, tags: prev.tags.filter((t) => t !== tag) }));
  }

  function addTag() {
    const tag = window.prompt("เพิ่มแท็ก");
    if (tag && tag.trim()) {
      setForm((prev) => ({ ...prev, tags: [...prev.tags, tag.trim()] }));
    }
  }

  async function handleSave(nextStatus) {
    if (!form.title.trim()) {
      setSaveError("กรุณากรอกหัวข้อข่าว");
      return;
    }

    setSaving(nextStatus);
    setSaveError("");

    try {
      const publishedAt =
        nextStatus === "published"
          ? new Date(`${form.publishDate}T${form.publishTime}:00`).toISOString()
          : news?.publishedAt ?? null;

      const payload = {
        title: form.title,
        subtitle: form.subtitle,
        content: form.content,
        category: form.category,
        tags: form.tags,
        isFeatured: form.isFeatured,
        status: nextStatus,
        publishedAt,
      };

      let saved;
      if (newsId) {
        saved = await updateNews(newsId, payload);
      } else {
        saved = await createNews({ ...payload, authorId: profile?.id });
      }

      if (cover.file) {
        const url = await uploadNewsCoverImage(cover.file, saved.id);
        await updateNews(saved.id, { coverImage: url });
      }

      navigate(`/admin/news/editor?id=${saved.id}`, { replace: true });
      setStatus(nextStatus);
      setCover({ file: null, url: null });
    } catch (err) {
      console.error("save news failed:", err);
      setSaveError(errorMessage(err));
    } finally {
      setSaving("");
    }
  }

  const coverPreview = cover.url ?? form.coverImage;
  const currentStatusBadge =
    status === "published"
      ? { label: "เผยแพร่แล้ว", tone: "success" }
      : status === "draft"
        ? { label: "ฉบับร่าง", tone: "muted" }
        : { label: "เก็บถาวร", tone: "muted" };

  return (
    <DashboardLayout
      variant="admin"
      title={
        <>
          <Link to="/admin/news" className="admin-editor__back">
            ‹ กลับไปจัดการข่าวสาร
          </Link>
          <span className="admin-editor__heading">{newsId ? "แก้ไขข่าว" : "เขียนข่าวใหม่"}</span>
        </>
      }
      subtitle={
        news?.authorName ? `แก้ไขล่าสุดโดย ${news.authorName}` : "ยังไม่ได้บันทึกเป็นข่าวจริง"
      }
      headerExtra={
        <div className="admin-editor__actions">
          <button
            type="button"
            className="dash-btn"
            disabled={saving !== ""}
            onClick={() => handleSave("draft")}
          >
            {saving === "draft" ? "กำลังบันทึก..." : "บันทึกร่าง"}
          </button>
          <a href="/news" target="_blank" rel="noreferrer" className="dash-btn">
            ดูตัวอย่าง
          </a>
          <button
            type="button"
            className="dash-btn dash-btn--add"
            disabled={saving !== ""}
            onClick={() => handleSave("published")}
          >
            {saving === "published" ? "กำลังเผยแพร่..." : "เผยแพร่"}
          </button>
        </div>
      }
    >
      {saveError && <div className="dash-message dash-message--error">{saveError}</div>}

      <div className="admin-editor">
        <div className="admin-editor__main">
          <section className="dash-card admin-editor__section">
            <h2>เนื้อหาข่าว</h2>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-title">
                หัวข้อข่าว
              </label>
              <input
                id="news-title"
                className="dash-input"
                value={form.title}
                onChange={(e) => updateField("title", e.target.value)}
              />
              <p className="dash-field__hint">
                ความยาวที่แนะนำ 40–70 ตัวอักษร (ปัจจุบัน {form.title.length})
              </p>
            </div>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-subtitle">
                หัวข้อรอง / คำโปรย
              </label>
              <input
                id="news-subtitle"
                className="dash-input"
                value={form.subtitle}
                onChange={(e) => updateField("subtitle", e.target.value)}
              />
            </div>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-body">
                รายละเอียด
              </label>
              <textarea
                id="news-body"
                className="dash-textarea"
                rows={9}
                value={form.content}
                onChange={(e) => updateField("content", e.target.value)}
              />
            </div>
          </section>

          <section className="dash-card admin-editor__section">
            <h2>ภาพประกอบ</h2>
            <label className="dash-dropzone" htmlFor="news-cover">
              <strong>{coverPreview ? "คลิกเพื่อเปลี่ยนรูป" : "คลิกเพื่ออัปโหลดภาพหน้าปก"}</strong>
              <span>JPG, PNG ขนาดแนะนำ 1600 × 900 px · ไม่เกิน 5 MB</span>
            </label>
            <input
              id="news-cover"
              type="file"
              accept="image/*"
              className="admin-editor__file-input"
              onChange={(e) => pickCover(e.target.files?.[0] ?? null)}
            />
            {coverPreview && (
              <>
                <div
                  className="admin-editor__thumb admin-editor__thumb--selected admin-editor__thumb--preview"
                  style={{ backgroundImage: `url(${coverPreview})` }}
                />
                <button
                  type="button"
                  className="dash-btn"
                  onClick={() => setCropOpen(true)}
                >
                  ครอบตัด
                </button>
              </>
            )}
          </section>
        </div>

        <aside className="admin-editor__side">
          <section className="dash-card admin-editor__section">
            <h2>การเผยแพร่</h2>
            <div className="admin-editor__row">
              <p>สถานะปัจจุบัน</p>
              <Badge tone={currentStatusBadge.tone}>{currentStatusBadge.label}</Badge>
            </div>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-category">
                หมวดหมู่
              </label>
              <select
                id="news-category"
                className="dash-input"
                value={form.category}
                onChange={(e) => updateField("category", e.target.value)}
              >
                {NEWS_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-date">
                วันที่เผยแพร่
              </label>
              <input
                id="news-date"
                type="date"
                className="dash-input"
                value={form.publishDate}
                onChange={(e) => updateField("publishDate", e.target.value)}
              />
            </div>

            <div className="dash-field">
              <label className="dash-field__label" htmlFor="news-time">
                เวลา
              </label>
              <input
                id="news-time"
                type="time"
                className="dash-input"
                value={form.publishTime}
                onChange={(e) => updateField("publishTime", e.target.value)}
              />
            </div>
            <p className="dash-field__hint">
              ตั้งวันที่/เวลาล่วงหน้าแล้วกด "เผยแพร่" จะกลายเป็นข่าวตั้งเวลาอัตโนมัติ
            </p>

            <div className="admin-editor__toggle-row">
              <p>ปักหมุดเป็นข่าวเด่น</p>
              <Switch
                on={form.isFeatured}
                onChange={(v) => updateField("isFeatured", v)}
                label="ปักหมุดเป็นข่าวเด่น"
              />
            </div>
          </section>

          <section className="dash-card admin-editor__section">
            <h2>แท็กและการค้นหา</h2>
            <div className="admin-editor__tags">
              {form.tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="dash-pill dash-pill--tint"
                  onClick={() => removeTag(tag)}
                  title="คลิกเพื่อลบ"
                >
                  {tag} ✕
                </button>
              ))}
              <button type="button" className="admin-editor__tag-add" onClick={addTag}>
                ＋ เพิ่มแท็ก
              </button>
            </div>
          </section>

          <section className="dash-card admin-editor__section">
            <h2>ตัวอย่างบนหน้าเว็บ</h2>
            <div className="admin-editor__preview">
              <div
                className="admin-editor__preview-photo"
                style={coverPreview ? { backgroundImage: `url(${coverPreview})` } : undefined}
              />
              <p className="admin-editor__preview-eyebrow">
                {form.category} · {form.publishDate}
              </p>
              <p className="admin-editor__preview-title">{form.title || "หัวข้อข่าว"}</p>
              <p className="admin-editor__preview-desc">{form.subtitle}</p>
            </div>
          </section>
        </aside>
      </div>

      {cropOpen && coverPreview && (
        <ImageCropModal
          imageUrl={coverPreview}
          onCancel={() => setCropOpen(false)}
          onConfirm={handleCropConfirm}
        />
      )}
    </DashboardLayout>
  );
}
