// เหมือน TextPromptDialog แต่ต้องกรอกสองช่อง (จำนวนแต้ม + เหตุผล) จึงแยก
// เป็นคอมโพเนนต์ของตัวเอง — ยืมคลาส prompt-dialog__* มาใช้กับกรอบ/ปุ่มเพื่อ
// หน้าตาตรงกัน ปิดแล้วส่ง onSubmit ทันที ส่วนสถานะ busy/error ให้ผู้เรียกจัดการ
// เอง (ตาม pattern cancelTarget ใน AdminRewardRequests)
import { useState } from "react";
import { formatPoints } from "../lib/rewards";
import "./TextPromptDialog.css";
import "./AdjustPointsDialog.css";

export default function AdjustPointsDialog({ customer, onSubmit, onClose }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const parsedAmount = Number(amount);
  const validAmount = amount.trim() !== "" && Number.isInteger(parsedAmount) && parsedAmount !== 0;
  const validReason = reason.trim() !== "";

  function handleSubmit(event) {
    event.preventDefault();
    if (!validAmount || !validReason) return;

    onSubmit(parsedAmount, reason.trim());
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
        aria-label={`ปรับแต้มของ ${customer.full_name || customer.username}`}
        onSubmit={handleSubmit}
      >
        <h2 className="prompt-dialog__title">
          ปรับแต้มของ {customer.full_name || customer.username}
        </h2>
        <p className="adjust-points-dialog__balance">
          ยอดปัจจุบัน {formatPoints(customer.points)} แต้ม
        </p>

        <div className="adjust-points-dialog__fields">
          <label className="prompt-dialog__label">
            จำนวนแต้ม (ใส่เครื่องหมาย - เพื่อหักแต้ม)
            <input
              className="prompt-dialog__input"
              type="number"
              step="1"
              placeholder="เช่น 50 หรือ -50"
              value={amount}
              autoFocus
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>

          <label className="prompt-dialog__label">
            เหตุผล (ลูกค้าจะเห็นในการแจ้งเตือน)
            <input
              className="prompt-dialog__input"
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
        </div>

        <div className="prompt-dialog__actions">
          <button type="button" className="prompt-dialog__cancel" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="submit"
            className="prompt-dialog__submit"
            disabled={!validAmount || !validReason}
          >
            ยืนยันปรับแต้ม
          </button>
        </div>
      </form>
    </div>
  );
}
