// กล่องกรอกข้อความสั้น ๆ แทน window.prompt()
//
// prompt() ใช้ได้แต่หน้าตาหลุดจากทั้งระบบ ปิดด้วย Esc แล้วแยกไม่ออกจากการกรอก
// ค่าว่าง และบางเบราว์เซอร์บล็อกทิ้งเงียบ ๆ
import { useState } from "react";
import "./TextPromptDialog.css";

export default function TextPromptDialog({
  title,
  label,
  initialValue = "",
  confirmLabel = "บันทึก",
  onSubmit,
  onClose,
}) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(event) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;

    onSubmit(trimmed);
  }

  return (
    <div
      className="prompt-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={handleSubmit}
      >
        <h2 className="prompt-dialog__title">{title}</h2>

        <label className="prompt-dialog__label">
          {label}
          <input
            className="prompt-dialog__input"
            type="text"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
          />
        </label>

        <div className="prompt-dialog__actions">
          <button type="button" className="prompt-dialog__cancel" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="submit" className="prompt-dialog__submit" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
