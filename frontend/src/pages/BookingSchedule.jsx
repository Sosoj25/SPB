import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import BookingSteps from "../components/BookingSteps";
import { Badge } from "../components/DashboardWidgets";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchDayAvailability, fetchFacility, fetchFacilitySlots } from "../lib/catalog";
import { fetchFacilityPricePreview } from "../lib/pricing";
import {
  BOOKING_WINDOW_DAYS,
  addDaysISO,
  createBooking,
  formatBaht,
  formatBookingDate,
  hoursBetween,
  toISODate,
  todayISO,
} from "../lib/bookings";
import { errorMessage } from "../lib/errors";
import "./Booking.css";

const EMPTY_SLOTS = [];
const EMPTY_DAYS = new Map();

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

// getDay() นับ 0 = อาทิตย์ แต่ปฏิทินไทยขึ้นต้นด้วยวันจันทร์
const mondayIndex = (jsDay) => (jsDay + 6) % 7;

const monthKey = (iso) => iso.slice(0, 7);

function monthCells(year, monthIndex) {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const lead = mondayIndex(new Date(year, monthIndex, 1).getDay());

  const cells = Array.from({ length: lead }, () => null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toISODate(new Date(year, monthIndex, day)));
  }

  // เติมท้ายให้ครบสัปดาห์ ไม่งั้นแถวสุดท้ายจะกว้างไม่เท่าแถวอื่นใน grid
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

export default function BookingSchedule() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const facilityId = Number(params.get("facility"));
  const hasFacility = Number.isFinite(facilityId) && facilityId > 0;

  const today = todayISO();
  const lastBookable = addDaysISO(today, BOOKING_WINDOW_DAYS);

  // วันที่, ช่วงเวลาที่เลือก และ error ของการกดยืนยัน อยู่ก้อนเดียวกันโดยตั้งใจ:
  // ทั้งสามอย่างมีความหมายเฉพาะกับวันนั้นวันเดียว เก็บรวมกันแล้วเซ็ตพร้อมกัน
  // จึงไม่มีจังหวะที่ค่าทั้งสามไม่ตรงกัน และไม่ต้องมี effect คอยล้างค่าตามหลัง
  //
  // slotIds เก็บได้หลายช่วง (จองต่อกันในครั้งเดียวได้) แต่ต้องต่อเนื่องกันสนิท
  // — ฝั่งนี้แค่คุมว่ากดยังไงให้ยังต่อกันอยู่เสมอ ตัวตัดสินจริงคือ
  // create_booking() ที่เช็คซ้ำอีกชั้นฝั่ง server
  const [pick, setPick] = useState(() => {
    const wanted = params.get("date");
    return {
      date: wanted && wanted >= today && wanted <= lastBookable ? wanted : today,
      slotIds: [],
      error: "",
    };
  });
  const { date: selectedDate, slotIds: selectedSlotIds, error: submitError } = pick;

  const [month, setMonth] = useState(() => monthKey(pick.date));
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const { data: facility, loading: facilityLoading, error: facilityError } = useAsyncData(
    () => fetchFacility(facilityId),
    hasFacility ? `facility:${facilityId}` : null
  );

  const [year, monthIndex] = month.split("-").map(Number);
  const cells = useMemo(() => monthCells(year, monthIndex - 1), [year, monthIndex]);

  // ถามความว่างเฉพาะช่วงที่จองได้จริง ไม่ต้องถามวันที่ผ่านมาแล้ว
  const rangeFrom = cells.find((iso) => iso && iso >= today) ?? null;
  const rangeTo = [...cells].reverse().find((iso) => iso && iso <= lastBookable) ?? null;

  const { data: days } = useAsyncData(
    () => fetchDayAvailability(facilityId, rangeFrom, rangeTo),
    hasFacility && rangeFrom && rangeTo
      ? `days:${facilityId}:${rangeFrom}:${rangeTo}:${reloadKey}`
      : null,
    EMPTY_DAYS
  );

  const { data: slots, loading: slotsLoading, error: slotsError } = useAsyncData(
    () => fetchFacilitySlots(facilityId, selectedDate),
    hasFacility ? `slots:${facilityId}:${selectedDate}:${reloadKey}` : null,
    EMPTY_SLOTS
  );

  // slots มาจาก facility_slots() ที่เรียงตาม start_time อยู่แล้ว (0011) —
  // filter ตามลำดับเดิมจึงได้ selectedSlots ที่เรียงเวลาถูกต้องเสมอ ไม่ต้อง
  // สนใจว่า slotIds ถูกเพิ่มเข้ามาตามลำดับไหน
  const selectedSlots = slots.filter((slot) => selectedSlotIds.includes(slot.id));
  const firstSlot = selectedSlots[0] ?? null;
  const lastSlot = selectedSlots[selectedSlots.length - 1] ?? null;
  const hours = firstSlot ? hoursBetween(firstSlot.start, lastSlot.end) : 0;

  // ตัวเลขจริงที่จะถูกเรียกเก็บ มาจากฟังก์ชันเดียวกับที่ create_booking ใช้
  // (compute_facility_price, 0024) กันราคาประเมินที่โชว์ตอนเลือกเวลากับ
  // ราคาที่เก็บจริงตอนยืนยันไม่ตรงกัน (ราคาตามช่วงเวลา/ส่วนลด) — ส่งช่วงเวลา
  // รวมทั้งหมด (ต้น slot แรก ถึง จบ slot สุดท้าย) เหมือนที่ RPC จะคิดจริง
  const { data: pricePreview } = useAsyncData(
    () => fetchFacilityPricePreview(facilityId, selectedDate, firstSlot.start, lastSlot.end),
    hasFacility && firstSlot
      ? `price-preview:${facilityId}:${selectedDate}:${firstSlot.start}:${lastSlot.end}`
      : null,
  );

  const total = pricePreview ? pricePreview.totalAmount : hours * (facility?.pricePerHour ?? 0);

  if (!hasFacility) return <Navigate to="/booking/sport" replace />;

  const canGoPrev = month > monthKey(today);
  const canGoNext = month < monthKey(lastBookable);

  const shiftMonth = (delta) => {
    const shifted = new Date(year, monthIndex - 1 + delta, 1);
    setMonth(monthKey(toISODate(shifted)));
  };

  async function handleSubmit() {
    setSubmitting(true);
    setPick((prev) => ({ ...prev, error: "" }));

    try {
      const booking = await createBooking({ slotIds: selectedSlotIds });

      navigate(`/booking/payment?booking=${booking.id}`);
    } catch (err) {
      console.error("create_booking failed:", err);
      setPick((prev) => ({ ...prev, slotIds: [], error: errorMessage(err) }));
      setSubmitting(false);
      // ถ้าพลาดเพราะมีคนจองตัดหน้า ตารางบนจอตอนนี้เก่าแล้ว — ดึงใหม่
      setReloadKey((key) => key + 1);
    }
  }

  // กดเลือก/ยกเลิกช่วงเวลา — ต้องคุมให้ผลลัพธ์เป็นช่วงที่ต่อกันสนิทเสมอ:
  //  - ช่วงว่าง: เริ่มเลือกใหม่
  //  - กดช่วงที่ติดกับขอบใดขอบหนึ่งของช่วงที่เลือกอยู่: ต่อออกไปทางนั้น
  //  - กดช่วงที่ไม่ติดกับช่วงที่เลือกอยู่เลย: เริ่มเลือกใหม่จากช่วงนั้นแทน
  //    (ดีกว่าปฏิเสธเฉย ๆ เพราะผู้ใช้เห็นผลลัพธ์ทันทีว่าเลือกอะไรอยู่)
  //  - กดช่วงที่เลือกอยู่แล้วซึ่งอยู่ปลายสุด (ต้นหรือท้าย): ตัดออกจากปลายนั้น
  //  - กดช่วงที่เลือกอยู่แล้วตรงกลาง: เคลียร์ทั้งหมด (ตัดตรงกลางแล้วจะเหลือ
  //    เป็นสองก้อนไม่ต่อกัน ซึ่งจองพร้อมกันไม่ได้อยู่แล้ว)
  function toggleSlot(slot) {
    if (slot.isBooked) return;

    setPick((prev) => {
      const current = slots.filter((s) => prev.slotIds.includes(s.id));

      if (current.length === 0) {
        return { ...prev, slotIds: [slot.id], error: "" };
      }

      const first = current[0];
      const last = current[current.length - 1];
      const alreadySelected = current.some((s) => s.id === slot.id);

      if (alreadySelected) {
        if (slot.id === first.id || slot.id === last.id) {
          return {
            ...prev,
            slotIds: current.filter((s) => s.id !== slot.id).map((s) => s.id),
            error: "",
          };
        }
        return { ...prev, slotIds: [], error: "" };
      }

      if (slot.end === first.start) {
        return { ...prev, slotIds: [slot.id, ...prev.slotIds], error: "" };
      }
      if (slot.start === last.end) {
        return { ...prev, slotIds: [...prev.slotIds, slot.id], error: "" };
      }

      return { ...prev, slotIds: [slot.id], error: "" };
    });
  }

  return (
    <div className="booking">
      <AppHeader />

      <main className="booking__main">
        <section className="booking__intro booking__intro--plain">
          <BookingSteps
            current={3}
            links={[
              "/booking/sport",
              facility
                ? `/booking/field?sport=${facility.sportId}&date=${selectedDate}`
                : null,
            ]}
          />
          <h1 className="booking__title">เลือกวันและเวลาที่ต้องการจอง</h1>
          {facility && (
            <p className="booking__lead">
              {facility.sportName} · {facility.name} · {facility.venueName} (เปิด{" "}
              {facility.openingTime} – {facility.closingTime} น.)
            </p>
          )}
        </section>

        {facilityLoading && <p className="booking-state">กำลังโหลดข้อมูลสนาม...</p>}

        {!facilityLoading && (facilityError || !facility) && (
          <p className="booking-state booking-state--error">
            {facilityError || "ไม่พบสนามนี้ หรือสนามปิดให้บริการอยู่"}
          </p>
        )}

        {facility && (
          <div className="booking-schedule">
            <section className="booking-panel">
              <div className="booking-calendar__nav">
                <button
                  type="button"
                  className="booking-calendar__arrow"
                  aria-label="เดือนก่อนหน้า"
                  disabled={!canGoPrev}
                  onClick={() => shiftMonth(-1)}
                >
                  ‹
                </button>
                <h2 className="booking-calendar__month">
                  {MONTHS[monthIndex - 1]} {year}
                </h2>
                <button
                  type="button"
                  className="booking-calendar__arrow"
                  aria-label="เดือนถัดไป"
                  disabled={!canGoNext}
                  onClick={() => shiftMonth(1)}
                >
                  ›
                </button>
              </div>

              <div className="booking-calendar__grid">
                {WEEKDAYS.map((label) => (
                  <span key={label} className="booking-calendar__dow">
                    {label}
                  </span>
                ))}

                {cells.map((iso, i) => {
                  if (!iso) {
                    return (
                      <span
                        key={`blank-${i}`}
                        className="booking-day booking-day--empty"
                      />
                    );
                  }

                  const outOfWindow = iso < today || iso > lastBookable;
                  const availability = days.get(iso);
                  // ยังไม่รู้ = ยังโหลดไม่เสร็จ ปล่อยให้กดได้ไปก่อน
                  // ดีกว่าขึ้นว่า "เต็ม" ทั้งเดือนตอนหน้าเพิ่งเปิด
                  //
                  // total = 0 คือแอดมินยังไม่ได้เปิดช่วงเวลาของวันนั้น คนละเรื่อง
                  // กับ "เต็ม" (เปิดแล้วแต่มีคนจองหมด) ต้องแยกให้ผู้ใช้รู้ว่า
                  // ควรรอแอดมินเปิด หรือควรเปลี่ยนไปวันอื่น
                  const notOpened = availability?.total === 0;
                  const isFull = availability?.free === 0 && !notOpened;
                  const disabled = outOfWindow || notOpened || isFull;

                  return (
                    <button
                      key={iso}
                      type="button"
                      disabled={disabled}
                      onClick={() => setPick({ date: iso, slotIds: [], error: "" })}
                      aria-pressed={iso === selectedDate}
                      className={`booking-day ${disabled ? "booking-day--full" : ""} ${
                        iso === selectedDate ? "booking-day--selected" : ""
                      }`}
                    >
                      <span className="booking-day__num">{Number(iso.slice(8))}</span>
                      <span className="booking-day__state">
                        {outOfWindow
                          ? "—"
                          : notOpened
                            ? "ปิด"
                            : isFull
                              ? "เต็ม"
                              : "ว่าง"}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="booking-legend">
                <span className="booking-legend__item">
                  <span
                    className="booking-legend__swatch"
                    style={{ background: "var(--color-tint-light)" }}
                  />
                  ว่าง
                </span>
                <span className="booking-legend__item">
                  <span
                    className="booking-legend__swatch"
                    style={{ background: "var(--color-disabled-bg)" }}
                  />
                  เต็ม / ยังไม่เปิดจอง
                </span>
                <span className="booking-legend__item">
                  <span
                    className="booking-legend__swatch"
                    style={{ background: "var(--color-primary)" }}
                  />
                  วันที่เลือก
                </span>
              </div>
            </section>

            <div className="booking-schedule__side">
              <section className="booking-panel">
                <h2 className="booking-panel__title">ช่วงเวลาที่ว่าง</h2>
                <p className="booking-panel__sub">
                  {formatBookingDate(selectedDate)} · เลือกได้หลายช่วงในครั้งเดียว
                  แต่ต้องเป็นเวลาที่ต่อเนื่องกัน
                </p>

                {slotsLoading && <p className="booking-state">กำลังโหลดช่วงเวลา...</p>}

                {!slotsLoading && slotsError && (
                  <p className="booking-state booking-state--error">{slotsError}</p>
                )}

                {!slotsLoading && !slotsError && slots.length === 0 && (
                  <p className="booking-state">
                    วันนี้ยังไม่เปิดให้จอง ลองเลือกวันอื่นในปฏิทินดูครับ
                  </p>
                )}

                {slots.map((slot) => {
                  const isSelected = selectedSlotIds.includes(slot.id);

                  return (
                    <button
                      key={slot.id}
                      type="button"
                      disabled={slot.isBooked}
                      onClick={() => toggleSlot(slot)}
                      aria-pressed={isSelected}
                      className={`booking-slot ${
                        slot.isBooked ? "booking-slot--full" : ""
                      } ${isSelected ? "booking-slot--selected" : ""}`}
                    >
                      <span className="booking-slot__time">
                        {slot.start} – {slot.end}
                      </span>
                      <span className="booking-slot__state">
                        {slot.isBooked ? "ไม่ว่าง" : "ว่าง"}
                      </span>
                    </button>
                  );
                })}
              </section>

              <section className="booking-panel">
                <h2 className="booking-panel__title">สรุปการจอง</h2>

                <div className="booking-row">
                  <span className="booking-row__label">กีฬา</span>
                  <span className="booking-row__value">{facility.sportName}</span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">สนาม</span>
                  <span className="booking-row__value">
                    {facility.name} · {facility.venueName}
                  </span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">วันที่</span>
                  <span className="booking-row__value">
                    {formatBookingDate(selectedDate)}
                  </span>
                </div>
                <div className="booking-row">
                  <span className="booking-row__label">เวลา</span>
                  <span className="booking-row__value">
                    {firstSlot
                      ? `${firstSlot.start} – ${lastSlot.end} น. (${hours} ชม.)`
                      : "ยังไม่ได้เลือก"}
                  </span>
                </div>

                {pricePreview?.discountLines.map((line, i) => (
                  <div className="booking-row" key={i}>
                    <span className="booking-row__label">{line.label}</span>
                    <span className="booking-row__value">-{formatBaht(line.amount)}</span>
                  </div>
                ))}

                {pricePreview?.isPeak && (
                  <Badge tone="warning">ราคาพีค</Badge>
                )}

                <hr className="booking-divider" />

                <div className="booking-row booking-row--total">
                  <span className="booking-row__label">รวมทั้งหมด</span>
                  <span className="booking-row__value">{formatBaht(total)}</span>
                </div>

                {submitError && (
                  <p className="booking-state booking-state--error">{submitError}</p>
                )}

                <button
                  type="button"
                  className="booking-btn booking-btn--block"
                  disabled={!firstSlot || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? "กำลังสร้างรายการจอง..." : "ถัดไป: ยืนยันการจอง"}
                </button>

                <Link
                  to={`/booking/field?sport=${facility.sportId}&date=${selectedDate}`}
                  className="booking-btn booking-btn--block booking-btn--ghost"
                >
                  ‹ กลับไปเลือกสนาม
                </Link>

                <p className="booking-note">
                  ระบบจะกันเวลาไว้ให้ทันทีหลังกดยืนยัน แล้วค่อยไปหน้าชำระเงิน
                </p>
              </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
