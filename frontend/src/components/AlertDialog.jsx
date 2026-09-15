// กล่องแจ้งเตือน/ยืนยันกลางจอ แทน window.alert() กับ window.confirm()
//
// ของเบราว์เซอร์หน้าตาหลุดจากธีมทั้งแอป บล็อกจาวาสคริปต์ทั้งหน้าไว้จนกว่าจะกด
// (จึงโชว์สถานะ "กำลังบันทึก..." ระหว่างรอเซิร์ฟเวอร์ไม่ได้) และเบราว์เซอร์
// มือถือบางตัวซ่อนทิ้งเงียบ ๆ — กล่องนี้ยืมกรอบ prompt-dialog__* มาใช้ต่อ
// เหมือน AdjustPointsDialog เพื่อให้หน้าตาตรงกับกล่องอื่นในระบบ
//
// facts = แถวข้อมูลสรุป (ป้าย/ค่า) ที่ผู้ใช้ต้องอ่านก่อนตัดสินใจ เช่น แต้มที่
// จะถูกตัดกับแต้มคงเหลือ — สิ่งที่ confirm() ใส่ได้แค่ในข้อความยาว ๆ บรรทัดเดียว
import { useEffect } from "react";
import "./TextPromptDialog.css";
import "./AlertDialog.css";

export default function AlertDialog({
  tone = "confirm",
  icon,
  title,
  description,
  facts = [],
  error = "",
  busy = false,
  confirmLabel = "ตกลง",
  cancelLabel,
  onConfirm,
  onClose,
}) {
  // ระหว่างรอเซิร์ฟเวอร์ปิดกล่องไม่ได้ — คำขอที่ยิงไปแล้วเรียกกลับไม่ได้
  // ปล่อยให้ปิดตอนนั้นผู้ใช้จะไม่เห็นว่าตกลงสำเร็จหรือล้มเหลว
  useEffect(() => {
    if (busy) return undefined;

    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  // คืนโฟกัสให้ปุ่มที่เปิดกล่อง — ไม่งั้นโฟกัสตกไปที่ body หลังกล่องหายไป
  useEffect(() => {
    const opener = document.activeElement;
    return () => opener?.focus?.();
  }, []);

  return (
    <div
      className="prompt-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (!busy && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`prompt-dialog alert-dialog alert-dialog--${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
      >
        {icon && (
          <p className="alert-dialog__icon" aria-hidden="true">
            {icon}
          </p>
        )}

        <h2 className="prompt-dialog__title alert-dialog__title">{title}</h2>

        {description && <p className="alert-dialog__desc">{description}</p>}

        {facts.length > 0 && (
          <dl className="alert-dialog__facts">
            {facts.map((fact) => (
              <div key={fact.label} className="alert-dialog__fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {error && <p className="alert-dialog__error">{error}</p>}

        <div className="prompt-dialog__actions alert-dialog__actions">
          {cancelLabel && (
            <button
              type="button"
              className="prompt-dialog__cancel"
              disabled={busy}
              onClick={onClose}
            >
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="prompt-dialog__submit"
            disabled={busy}
            autoFocus
            onClick={onConfirm ?? onClose}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
