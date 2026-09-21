// หน้ารับลูกค้า Walk-in ที่เคาน์เตอร์ — จองแทนลูกค้าและรับเงินจบในครั้งเดียว
import { useState } from "react";
import { Check } from "lucide-react";
import DashboardLayout from "../components/DashboardLayout";
import { Badge, Pill, SearchBox } from "../components/DashboardWidgets";
import {
  useAvailableFacilityCount,
  useWalkInCustomerSearch,
  useWalkInFacilities,
  useWalkInPricePreview,
  useWalkInSlots,
  useWalkInSports,
} from "../hooks/useWalkIn";
import { formatBaht, formatBookingDate, hoursBetween, todayISO } from "../lib/bookings";
import { createWalkInBooking } from "../lib/walkIn";
import { errorMessage } from "../lib/errors";
import "./AdminWalkIn.css";

// ที่เคาน์เตอร์รับได้แค่เงินสด/บัตร/พร้อมเพย์ตรง ๆ ไม่ผ่านเกตเวย์ออนไลน์
// (ต่างจาก PAYMENT_METHODS ใน lib/payments.js ที่เป็นช่องทางที่ลูกค้าจ่ายเอง
// ผ่านแอป) แอดมินรับเงินจริงแล้วกดยืนยันทีเดียว ระบบเลยบันทึกเป็นจ่ายแล้วทันที
const PAYMENT_METHODS = [
  { key: "cash", label: "เงินสด" },
  { key: "card", label: "บัตรเครดิต" },
  { key: "qr", label: "พร้อมเพย์" },
];

export default function AdminWalkIn() {
  const today = todayISO();

  const { sports, loading: sportsLoading } = useWalkInSports();
  const [sportId, setSportId] = useState(null);
  const [facilityId, setFacilityId] = useState(null);
  const [slotIds, setSlotIds] = useState([]);
  const [slotReloadKey, setSlotReloadKey] = useState(0);

  const [customerQuery, setCustomerQuery] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [successBooking, setSuccessBooking] = useState(null);

  // เลือกกีฬาแรกให้เองจนกว่าแอดมินจะกดเลือกเอง — เคาน์เตอร์ไม่มีเวลาให้มา
  // กดเลือกกีฬาทุกครั้งถ้าระบบมีกีฬาให้บริการอยู่แล้ว คำนวณตรงนี้แทนการใช้
  // useEffect + setState เพื่อไม่ให้ต้อง render ซ้ำอีกรอบโดยไม่จำเป็น
  const effectiveSportId = sportId ?? sports[0]?.id ?? null;

  const { facilities, loading: facilitiesLoading } = useWalkInFacilities(effectiveSportId, today);

  const facility = facilities.find((f) => f.id === facilityId) ?? null;

  const { slots, loading: slotsLoading } = useWalkInSlots(facilityId, today, slotReloadKey);

  // ความยาวต่อช่วงไม่เท่ากันทุกสนาม (บางสนามแบ่งเป็นช่วงละ 1 ชม. บางสนามละ
  // 2 ชม.) จึงเลือกด้วยการคลิกช่วงที่ต่อเนื่องกันโดยตรงแทนตัวเลือก "กี่ชม."
  // ตายตัว — ใช้ตรรกะเดียวกับ toggleSlot ใน BookingSchedule.jsx (หน้าจองของ
  // ลูกค้า) ทุกประการ เพื่อผลลัพธ์ที่รับประกันว่าต่อเนื่องกันเสมอ
  const selectedSlots = slots.filter((s) => slotIds.includes(s.id));
  const firstSlot = selectedSlots[0] ?? null;
  const lastSlot = selectedSlots[selectedSlots.length - 1] ?? null;
  const hours = firstSlot ? hoursBetween(firstSlot.start, lastSlot.end) : 0;

  const { price } = useWalkInPricePreview(facilityId, today, firstSlot?.start, lastSlot?.end);
  const total = price ? price.totalAmount : hours * (facility?.pricePerHour ?? 0);

  const { count: availableCount } = useAvailableFacilityCount(today);

  // ยังไม่เลือกลูกค้าเดิม ค่อยยิงค้นหาจากคำที่พิมพ์ — เลือกแล้วเลิกค้นต่อ
  const { customers: customerMatches } = useWalkInCustomerSearch(
    selectedCustomer ? "" : customerQuery,
  );

  const hasManualCustomer = Boolean(customerName.trim() && customerPhone.length === 10);
  const customerReady = Boolean(selectedCustomer) || hasManualCustomer;
  const canConfirm = Boolean(facility) && selectedSlots.length > 0 && customerReady && !submitting;

  function resetForm() {
    setFacilityId(null);
    setSlotIds([]);
    setCustomerQuery("");
    setSelectedCustomer(null);
    setCustomerName("");
    setCustomerPhone("");
    setNote("");
    setPaymentMethod("cash");
    setSuccessBooking(null);
    setSubmitError("");
    setSlotReloadKey((k) => k + 1);
  }

  function selectFacility(f) {
    setFacilityId(f.id);
    setSlotIds([]);
  }

  // เหมือน toggleSlot ใน BookingSchedule.jsx เป๊ะ: กดช่วงว่างเริ่มเลือกใหม่,
  // กดช่วงที่ติดขอบช่วงที่เลือกอยู่ต่อออกไปทางนั้น, กดช่วงที่ไม่ติดกันเลย
  // เริ่มเลือกใหม่จากช่วงนั้นแทน, กดปลายช่วงที่เลือกอยู่ตัดออกจากปลายนั้น,
  // กดช่วงกลางที่เลือกอยู่เคลียร์ทั้งหมด
  function toggleSlot(slot) {
    if (slot.isBooked) return;

    setSlotIds((prev) => {
      const current = slots.filter((s) => prev.includes(s.id));

      if (current.length === 0) return [slot.id];

      const first = current[0];
      const last = current[current.length - 1];
      const alreadySelected = current.some((s) => s.id === slot.id);

      if (alreadySelected) {
        if (slot.id === first.id || slot.id === last.id) {
          return current.filter((s) => s.id !== slot.id).map((s) => s.id);
        }
        return [];
      }

      if (slot.end === first.start) return [slot.id, ...prev];
      if (slot.start === last.end) return [...prev, slot.id];

      return [slot.id];
    });
  }

  function pickCustomer(customer) {
    setSelectedCustomer(customer);
    setCustomerName("");
    setCustomerPhone("");
  }

  function clearCustomer() {
    setSelectedCustomer(null);
    setCustomerQuery("");
  }

  async function handleConfirm() {
    if (!canConfirm) return;

    setSubmitting(true);
    setSubmitError("");

    try {
      const booking = await createWalkInBooking({
        facilityId,
        slotIds: selectedSlots.map((s) => s.id),
        customerUserId: selectedCustomer?.id ?? null,
        customerName: selectedCustomer ? null : customerName.trim(),
        customerPhone: selectedCustomer ? null : customerPhone.trim(),
        note: note.trim() || null,
        paymentMethod,
      });

      setSuccessBooking(booking);
    } catch (err) {
      console.error("admin_create_walk_in_booking failed:", err);
      setSubmitError(errorMessage(err));
      // พลาดเพราะมีคนจองตัดหน้าได้ (exclusion_violation) — ตารางบนจอตอนนี้เก่าแล้ว
      setSlotReloadKey((k) => k + 1);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="รับลูกค้า Walk-in"
      subtitle="สร้างการจองให้ลูกค้าที่มาถึงหน้าเคาน์เตอร์โดยไม่ได้จองล่วงหน้า"
      headerExtra={<Badge tone="success">● สนามว่างตอนนี้ {availableCount} สนาม</Badge>}
    >
      <div className="walkin">
        <div className="walkin__main">
          <section className="dash-card walkin__step">
            <div className="walkin__step-head">
              <span className="walkin__step-num">1</span>
              <h2>เลือกกีฬาและสนาม</h2>
            </div>

            {sportsLoading && <p className="dash-empty">กำลังโหลดรายการกีฬา...</p>}

            <div className="walkin__sports">
              {sports.map((sport) => (
                <Pill
                  key={sport.id}
                  active={sport.id === effectiveSportId}
                  onClick={() => setSportId(sport.id)}
                >
                  {sport.name}
                </Pill>
              ))}
            </div>

            {facilitiesLoading && <p className="dash-empty">กำลังโหลดรายการสนาม...</p>}
            {!facilitiesLoading && effectiveSportId != null && facilities.length === 0 && (
              <p className="dash-empty">กีฬานี้ยังไม่มีสนามเปิดให้บริการ</p>
            )}

            <div className="walkin__facilities">
              {facilities.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  disabled={f.isFull}
                  onClick={() => selectFacility(f)}
                  className={`walkin__facility ${
                    f.id === facilityId ? "walkin__facility--active" : ""
                  } ${f.isFull ? "walkin__facility--full" : ""}`}
                >
                  <p className="walkin__facility-name">{f.name}</p>
                  <p className="walkin__facility-desc">
                    {f.description || `ความจุ ${f.capacity ?? "-"} คน`}
                  </p>
                  <p className="walkin__facility-price">
                    {f.isFull ? "ไม่ว่าง" : `${formatBaht(f.pricePerHour)}/ชม.`}
                  </p>
                </button>
              ))}
            </div>
          </section>

          <section className="dash-card walkin__step">
            <div className="walkin__step-head">
              <span className="walkin__step-num">2</span>
              <h2>เลือกช่วงเวลา — วันนี้ {formatBookingDate(today)}</h2>
            </div>

            {!facility && <p className="dash-empty">เลือกสนามก่อนจึงจะเลือกช่วงเวลาได้</p>}

            {facility && (
              <>
                {slotsLoading && <p className="dash-empty">กำลังโหลดช่วงเวลา...</p>}
                {!slotsLoading && slots.length === 0 && (
                  <p className="dash-empty">วันนี้ยังไม่เปิดช่วงเวลาให้จองสำหรับสนามนี้</p>
                )}

                {slots.length > 0 && (
                  <>
                    <p className="walkin__slots-hint">
                      เลือกได้หลายช่วงในครั้งเดียว แต่ต้องเป็นเวลาที่ต่อเนื่องกัน
                    </p>
                    <div className="walkin__slots">
                      {slots.map((slot) => {
                        const isChosen = selectedSlots.some((s) => s.id === slot.id);
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            disabled={slot.isBooked}
                            onClick={() => toggleSlot(slot)}
                            className={`walkin__slot ${isChosen ? "walkin__slot--active" : ""} ${
                              slot.isBooked ? "walkin__slot--full" : ""
                            }`}
                          >
                            {slot.start}–{slot.end}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </section>

          <section className="dash-card walkin__step">
            <div className="walkin__step-head">
              <span className="walkin__step-num">3</span>
              <h2>ข้อมูลลูกค้า</h2>
            </div>

            {!selectedCustomer && (
              <div className="walkin__customer-search">
                <SearchBox
                  placeholder="ค้นหาสมาชิกเดิมด้วยเบอร์โทร"
                  value={customerQuery}
                  onChange={setCustomerQuery}
                />
                {customerMatches.length > 0 && (
                  <div className="walkin__customer-results">
                    {customerMatches.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickCustomer(c)}
                        className="walkin__customer-result"
                      >
                        <span>{c.full_name || c.username}</span>
                        <span>{c.phone || "ไม่มีเบอร์ในระบบ"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedCustomer && (
              <div className="walkin__customer-chip">
                <div>
                  <p className="walkin__customer-chip-name">
                    {selectedCustomer.full_name || selectedCustomer.username}
                  </p>
                  <p className="walkin__customer-chip-phone">{selectedCustomer.phone}</p>
                </div>
                <Pill tone="ghost" onClick={clearCustomer}>
                  เปลี่ยน
                </Pill>
              </div>
            )}

            {!selectedCustomer && (
              <>
                <div className="walkin__divider">
                  <span />
                  <p>หรือกรอกข้อมูลลูกค้าใหม่</p>
                  <span />
                </div>

                <div className="walkin__fields">
                  <label className="dash-field">
                    <span className="dash-field__label">ชื่อ-นามสกุล</span>
                    <input
                      type="text"
                      className="dash-input"
                      placeholder="กรอกชื่อลูกค้า"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                    />
                  </label>
                  <label className="dash-field">
                    <span className="dash-field__label">เบอร์โทรศัพท์</span>
                    <input
                      type="tel"
                      inputMode="numeric"
                      className="dash-input"
                      placeholder="0XX-XXX-XXXX"
                      maxLength={10}
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    />
                  </label>
                </div>
              </>
            )}

            <label className="dash-field">
              <span className="dash-field__label">หมายเหตุ (ถ้ามี)</span>
              <textarea
                className="dash-textarea"
                placeholder="เช่น ต้องการยืมอุปกรณ์เพิ่ม"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </section>
        </div>

        <aside className="walkin__side">
          <section className="dash-card walkin__summary">
            {successBooking ? (
              <>
                <h2>
                  <Check size={20} aria-hidden="true" /> สร้างรายการสำเร็จ
                </h2>
                <p className="walkin__summary-code">รหัสการจอง {successBooking.booking_code}</p>
                <p className="walkin__summary-hint">
                  ระบบออกใบเสร็จและเพิ่มรายการนี้เข้าตารางเวลาสนามแล้ว
                </p>
                <button type="button" className="walkin__confirm-btn" onClick={resetForm}>
                  รับลูกค้าคนถัดไป
                </button>
              </>
            ) : (
              <>
                <h2>สรุปรายการ</h2>

                <div className="walkin__summary-row">
                  <span>กีฬา / สนาม</span>
                  <strong>{facility ? `${facility.sportName} · ${facility.name}` : "ยังไม่ได้เลือก"}</strong>
                </div>
                <div className="walkin__summary-row">
                  <span>เวลา</span>
                  <strong>
                    {firstSlot
                      ? `${firstSlot.start} – ${lastSlot.end} น. (${hours} ชม.)`
                      : "ยังไม่ได้เลือก"}
                  </strong>
                </div>
                <div className="walkin__summary-row">
                  <span>ลูกค้า</span>
                  <strong>
                    {selectedCustomer
                      ? selectedCustomer.full_name || selectedCustomer.username
                      : customerName.trim() || "ยังไม่ระบุ"}
                  </strong>
                </div>

                <hr className="walkin__summary-divider" />

                <div className="walkin__summary-row walkin__summary-row--total">
                  <span>ยอดรวม</span>
                  <strong>{formatBaht(total)}</strong>
                </div>

                <h3 className="walkin__summary-subhead">วิธีชำระเงิน</h3>
                <div className="walkin__payment-methods">
                  {PAYMENT_METHODS.map((m) => (
                    <Pill
                      key={m.key}
                      active={paymentMethod === m.key}
                      onClick={() => setPaymentMethod(m.key)}
                    >
                      {m.label}
                    </Pill>
                  ))}
                </div>

                {submitError && <p className="dash-message dash-message--error">{submitError}</p>}

                <button
                  type="button"
                  className="walkin__confirm-btn"
                  disabled={!canConfirm}
                  onClick={handleConfirm}
                >
                  {submitting ? (
                    "กำลังบันทึก..."
                  ) : (
                    <>
                      <Check size={15} aria-hidden="true" /> ยืนยันการจองและรับชำระเงิน
                    </>
                  )}
                </button>

                <p className="walkin__summary-hint">
                  ระบบจะออกใบเสร็จและเพิ่มรายการนี้เข้าตารางเวลาสนามทันที
                </p>
              </>
            )}
          </section>
        </aside>
      </div>
    </DashboardLayout>
  );
}
