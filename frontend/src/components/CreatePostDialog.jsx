// กล่องเขียนโพสต์ชุมชน — หน้าต่างเดียวจบแบบ Facebook พิมพ์แล้วเห็นผลจริง
// ทันที (WYSIWYG) ไม่มีขั้นตอน "ดูตัวอย่าง" แยก
//
// editingPost = { id, content, categoryId, coverImage } เปิดโหมดแก้ไขโพสต์เดิม
// แทนโหมดสร้างใหม่ — ใช้ฟอร์มเดียวกันทั้งหมด ต่างกันแค่ค่าตั้งต้นกับปลายทาง
// (createPost เทียบกับ updateOwnPost) การแก้โพสต์จึงทำได้ทุกอย่างเท่าตอนสร้าง
// ทั้งเปลี่ยนหมวดหมู่และจัดการรูป
//
// editingPost มีแค่ coverImage (รูปแรก) มาให้ตอน mount — ต้องดึงรายการรูป
// ทั้งหมดของโพสต์เพิ่มเองจาก fetchPostImages เพื่อให้แก้ได้ครบทุกรูป ไม่ใช่แค่
// รูปแรก ระหว่างรอโหลดใช้ coverImage ไปพลาง ๆ กันโพสต์ที่มีรูปเดียวดูเหมือน
// ไม่มีรูปตอนเพิ่งเปิดโมดัล
import { useEffect, useRef, useState } from "react";
import { MAX_POST_IMAGES, createPost, fetchPostImages, updateOwnPost } from "../lib/community";
import { assertImageFile } from "../lib/uploads";
import { errorMessage } from "../lib/errors";
import "./CreatePostDialog.css";

export default function CreatePostDialog({
  userId,
  authorName,
  authorAvatar,
  categories,
  openFilePickerOnMount,
  editingPost,
  onClose,
  onCreated,
}) {
  const [content, setContent] = useState(editingPost?.content ?? "");
  // เหมือนเฟซบุ๊ก — ไม่บังคับให้ผู้ใช้เลือกหมวดหมู่เอง ตั้งค่าเริ่มต้นเป็น
  // หมวดแรกที่โพสต์ได้ให้ทันที เลือกเปลี่ยนเองได้แต่ไม่ใช่ขั้นตอนบังคับอีกต่อไป
  const [categoryId, setCategoryId] = useState(
    editingPost?.categoryId != null
      ? String(editingPost.categoryId)
      : categories[0]?.id != null
        ? String(categories[0].id)
        : "",
  );
  // รูปเดิมที่ยังเก็บไว้ (เรียงตามลำดับ) — กดเอาออกได้ทีละรูป
  const [existingImages, setExistingImages] = useState(
    editingPost?.coverImage ? [editingPost.coverImage] : [],
  );
  // รูปใหม่ที่เพิ่งเลือก: [{ file, url }] — url เป็น object URL สำหรับพรีวิว
  const [newImages, setNewImages] = useState([]);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);
  const newImagesRef = useRef(newImages);

  useEffect(() => {
    newImagesRef.current = newImages;
  }, [newImages]);

  useEffect(() => {
    if (openFilePickerOnMount) fileRef.current?.click();
  }, [openFilePickerOnMount]);

  // categories อาจยังโหลดไม่เสร็จตอนโมดัล mount (ยิงคู่ขนานจาก parent) — ถ้า
  // ยังไม่มีใครเลือกหมวดเอง (สร้างโพสต์ใหม่) ใช้หมวดแรกที่โพสต์ได้เป็นค่าจริง
  // ตอน render แทนการ setState ในเอฟเฟกต์ ไม่ต้องรอ re-render รอบสอง
  const effectiveCategoryId =
    categoryId || (categories[0]?.id != null ? String(categories[0].id) : "");

  useEffect(() => {
    if (!editingPost?.id) return undefined;

    let cancelled = false;
    fetchPostImages(editingPost.id).then((urls) => {
      if (!cancelled) setExistingImages(urls);
    });

    return () => {
      cancelled = true;
    };
  }, [editingPost?.id]);

  // คืน object URL ของรูปใหม่ทั้งหมดที่ยังไม่ถูกคืนตอนปิดโมดัล — ตัวที่ถูกลบ
  // ระหว่างทางถูกคืนไปแล้วทีละรูปใน removeNewImage ก่อนหน้านี้
  useEffect(() => {
    return () => {
      newImagesRef.current.forEach((img) => URL.revokeObjectURL(img.url));
    };
  }, []);

  const totalImageCount = existingImages.length + newImages.length;
  const previewImages = [
    ...existingImages.map((url) => ({ key: url, url, kind: "existing" })),
    ...newImages.map((img) => ({ key: img.url, url: img.url, kind: "new" })),
  ];

  function addFiles(files) {
    setError("");

    const room = MAX_POST_IMAGES - totalImageCount;
    if (room <= 0) return;

    const picked = [];
    for (const file of Array.from(files).slice(0, room)) {
      try {
        assertImageFile(file);
        picked.push({ file, url: URL.createObjectURL(file) });
      } catch (err) {
        setError(err.message);
        return;
      }
    }

    setNewImages((current) => [...current, ...picked]);
  }

  function removeExistingImage(url) {
    setExistingImages((current) => current.filter((u) => u !== url));
  }

  function removeNewImage(url) {
    setNewImages((current) => {
      const target = current.find((img) => img.url === url);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((img) => img.url !== url);
    });
  }

  async function handleSubmit() {
    if (posting) return;
    setError("");
    setPosting(true);

    try {
      const imageFiles = newImages.map((img) => img.file);

      if (editingPost) {
        await updateOwnPost(editingPost.id, {
          userId,
          content,
          categoryId: Number(effectiveCategoryId) || undefined,
          imageFiles,
          keepImageUrls: existingImages,
        });
      } else {
        await createPost({
          userId,
          categoryId: Number(effectiveCategoryId) || undefined,
          content,
          imageFiles,
        });
      }
      onCreated?.();
      onClose();
    } catch (err) {
      console.error("บันทึกโพสต์ไม่สำเร็จ:", err);
      setError(errorMessage(err));
      setPosting(false);
    }
  }

  return (
    <div
      className="cp-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !posting) onClose();
      }}
    >
      <div
        className="cp-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={editingPost ? "แก้ไขโพสต์" : "สร้างโพสต์"}
      >
        <header className="cp-dialog__head">
          <span className="cp-dialog__head-spacer" aria-hidden="true" />
          <h2 className="cp-dialog__title">{editingPost ? "แก้ไขโพสต์" : "สร้างโพสต์"}</h2>
          <button
            type="button"
            className="cp-dialog__close"
            aria-label="ปิด"
            disabled={posting}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <hr className="cp-dialog__divider" />

        <div className="cp-dialog__body">
          <div className="cp-dialog__author">
            {authorAvatar ? (
              <img src={authorAvatar} alt="" className="cm-avatar cm-avatar--sm" />
            ) : (
              <span className="cm-avatar cm-avatar--sm" aria-hidden="true" />
            )}
            <div className="cp-dialog__author-info">
              <p className="cm-name">{authorName}</p>
              {/* select เดิม appearance:none ไม่มีลูกศรบอกว่ากดเปลี่ยนได้ —
                  ผู้ใช้เลยไม่รู้ว่าเลือกหมวดหมู่เองได้ (ไม่ได้บังคับเลือกแล้ว
                  แค่ตั้งค่าเริ่มต้นให้) เพิ่มลูกศร ▾ ทับไว้เป็นตัวบอกใบ้ */}
              <span className="cp-dialog__category-wrap">
                <select
                  className="cp-dialog__category"
                  aria-label="หมวดหมู่โพสต์"
                  title="แตะเพื่อเลือกหมวดหมู่โพสต์"
                  value={effectiveCategoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                <span className="cp-dialog__category-caret" aria-hidden="true">
                  ▾
                </span>
              </span>
            </div>
          </div>

          <textarea
            className="cp-dialog__textarea"
            aria-label="เนื้อหาโพสต์"
            rows={previewImages.length > 0 ? 3 : 5}
            autoFocus
            placeholder={`${authorName} คุณกำลังคิดอะไรอยู่?`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />

          {previewImages.length > 0 && (
            <div
              className={
                previewImages.length > 1 ? "cp-dialog__image-grid" : "cp-dialog__image-single"
              }
            >
              {previewImages.map((item) => (
                <div key={item.key} className="cp-dialog__image">
                  <img src={item.url} alt="" />
                  <button
                    type="button"
                    className="cp-dialog__image-remove"
                    aria-label="นำรูปออก"
                    onClick={() =>
                      item.kind === "existing"
                        ? removeExistingImage(item.url)
                        : removeNewImage(item.url)
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="cp-dialog__attach">
            <span className="cp-dialog__attach-label">
              เพิ่มเข้าโพสต์ของคุณ
              {totalImageCount > 0 && ` (${totalImageCount}/${MAX_POST_IMAGES})`}
            </span>
            <button
              type="button"
              className="cp-dialog__attach-btn"
              aria-label="แนบรูปภาพ"
              disabled={totalImageCount >= MAX_POST_IMAGES}
              onClick={() => fileRef.current?.click()}
            >
              🖼️
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {error && <p className="cp-dialog__error">{error}</p>}

          <button
            type="button"
            className="cp-dialog__submit"
            disabled={posting || (!content.trim() && totalImageCount === 0) || !effectiveCategoryId}
            onClick={handleSubmit}
          >
            {posting ? "กำลังบันทึก..." : editingPost ? "บันทึก" : "โพสต์"}
          </button>
        </div>
      </div>
    </div>
  );
}
