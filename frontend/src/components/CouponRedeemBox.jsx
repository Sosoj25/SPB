// ตัดคูปองหน้างาน (แอดมิน)
//
// คูปองส่วนลดค่าสนามลูกค้าใช้เองได้ในหน้าชำระเงินแล้ว (0049) กล่องนี้จึงมีไว้
// สำหรับคูปองที่ระบบลดราคาให้อัตโนมัติไม่ได้ — สิทธิพิเศษ หรือของที่ลูกค้า
// เลือกมารับเองที่สนาม ซึ่งเจ้าหน้าที่ต้องเป็นคนยืนยันว่าส่งมอบแล้วจริง
//
// วางไว้ในหน้าเช็คอินเพราะเป็นหน้าที่เจ้าหน้าที่หน้าเคาน์เตอร์เปิดค้างไว้อยู่แล้ว
// ทุกวัน ไม่ต้องสลับหน้าไปมาตอนลูกค้ายื่นรหัสให้
import { useState } from "react";
import { Ticket } from "lucide-react";
import { markCouponUsed } from "../lib/rewards";
import { errorMessage } from "../lib/errors";
import "./CouponRedeemBox.css";

export default function CouponRedeemBox() {
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = code.trim();
    if (!trimmed) return;

    setBusy(true);
    setResult(null);

    try {
      const row = await markCouponUsed(trimmed, note);
      setResult({ tone: "success", text: `ตัดคูปอง ${row.redemption_code} เรียบร้อยแล้ว` });
      setCode("");
      setNote("");
    } catch (err) {
      console.error("markCouponUsed failed:", err);
      setResult({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="dash-card coupon-redeem">
      <h2 className="coupon-redeem__title">
        <Ticket size={18} aria-hidden="true" /> ตัดคูปองหน้างาน
      </h2>
      <p className="coupon-redeem__hint">
        สำหรับคูปองสิทธิพิเศษหรือของที่ลูกค้ามารับเองที่สนาม — คูปองส่วนลดค่าสนาม
        ลูกค้าใช้เองได้ตอนชำระเงิน ไม่ต้องตัดที่นี่
      </p>

      <form className="coupon-redeem__form" onSubmit={handleSubmit}>
        <label className="dash-field">
          <span className="dash-field__label">รหัสคูปอง</span>
          <input
            type="text"
            className="dash-input"
            placeholder="SPB-RW-88213"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>

        <label className="dash-field">
          <span className="dash-field__label">บันทึกเพิ่มเติม (ไม่บังคับ)</span>
          <input
            type="text"
            className="dash-input"
            placeholder="เช่น รับเสื้อไซซ์ L ที่เคาน์เตอร์"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <button
          type="submit"
          className="dash-btn dash-btn--add coupon-redeem__submit"
          disabled={busy || !code.trim()}
        >
          {busy ? "กำลังตรวจสอบ..." : "ตัดคูปอง"}
        </button>
      </form>

      {result && (
        <p className={`dash-message dash-message--${result.tone}`}>{result.text}</p>
      )}
    </section>
  );
}
