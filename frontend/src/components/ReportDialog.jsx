// กล่องรายงานเนื้อหา ใช้ร่วมกันทั้งโพสต์และความคิดเห็น
//
// เป็นที่เดียวในระบบที่เขียนแถวเข้า community_reports — ต้นทางของคิวตรวจสอบ
// ฝั่งแอดมิน (/admin/community)
//
// เลือกได้หลายข้อแต่ไม่เกิน MAX_REPORT_REASONS (0052) — ของจริงโพสต์เดียวผิด
// หลายข้อพร้อมกันได้ (สแปม + หลอกลวง มาด้วยกันเกือบทุกครั้ง) แต่ถ้าปล่อยให้
// ติ๊กได้ทั้งหมดทุกข้อ ใบรายงานจะไม่บอกอะไรกับแอดมินเลยว่าปัญหาหลักคือเรื่องไหน
import { useState } from "react";
import { MAX_REPORT_REASONS, REPORT_REASON_GROUPS, reportContent } from "../lib/community";
import { errorMessage } from "../lib/errors";
import "./ReportDialog.css";

export default function ReportDialog({ postId, commentId, onClose, onDone }) {
  const [reasons, setReasons] = useState([]);
  const [description, setDescription] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const full = reasons.length >= MAX_REPORT_REASONS;

  function toggleReason(value) {
    setError("");
    setReasons((current) => {
      if (current.includes(value)) return current.filter((item) => item !== value);
      // เงียบ ๆ ไม่เพิ่มเมื่อครบโควตาแล้ว — ช่องที่ยังไม่ได้ติ๊กถูก disable ไว้
      // อยู่แล้ว ตรงนี้เป็นด่านสำรองสำหรับการกดผ่านคีย์บอร์ด
      if (current.length >= MAX_REPORT_REASONS) return current;
      return [...current, value];
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (sending) return;

    setError("");
    setSending(true);

    try {
      await reportContent({ postId, commentId, reasons, description });
      onDone?.();
      onClose();
    } catch (err) {
      console.error("ส่งรายงานไม่สำเร็จ:", err);
      setError(errorMessage(err));
      setSending(false);
    }
  }

  return (
    <div
      className="report-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="report-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="รายงานเนื้อหา"
        onSubmit={handleSubmit}
      >
        <h2 className="report-dialog__title">รายงานเนื้อหานี้</h2>
        <p className="report-dialog__hint">
          ผู้ดูแลระบบจะตรวจสอบและดำเนินการต่อ รายงานของคุณจะไม่ถูกเปิดเผยกับเจ้าของเนื้อหา
        </p>

        <p className="report-dialog__quota" aria-live="polite">
          เลือกได้สูงสุด {MAX_REPORT_REASONS} ข้อ · เลือกแล้ว {reasons.length} ข้อ
        </p>

        {REPORT_REASON_GROUPS.map((group) => (
          <fieldset key={group.key} className="report-dialog__group">
            <legend className="report-dialog__group-title">{group.label}</legend>
            <p className="report-dialog__group-desc">{group.description}</p>

            <div className="report-dialog__reasons">
              {group.reasons.map((item) => {
                const checked = reasons.includes(item.value);

                return (
                  <label
                    key={item.value}
                    className={`report-dialog__reason ${
                      checked ? "report-dialog__reason--on" : ""
                    } ${!checked && full ? "report-dialog__reason--off" : ""}`}
                  >
                    <input
                      type="checkbox"
                      name="reasons"
                      value={item.value}
                      checked={checked}
                      disabled={!checked && full}
                      onChange={() => toggleReason(item.value)}
                    />
                    <span className="report-dialog__reason-text">
                      <span className="report-dialog__reason-label">{item.label}</span>
                      <span className="report-dialog__reason-hint">{item.hint}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}

        <textarea
          aria-label="รายละเอียดเพิ่มเติม"
          className="report-dialog__note"
          rows={3}
          placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />

        {error && <p className="report-dialog__error">{error}</p>}

        <div className="report-dialog__actions">
          <button type="button" className="report-dialog__cancel" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="submit"
            className="report-dialog__submit"
            disabled={sending || reasons.length === 0}
          >
            {sending ? "กำลังส่ง..." : "ส่งรายงาน"}
          </button>
        </div>
      </form>
    </div>
  );
}
