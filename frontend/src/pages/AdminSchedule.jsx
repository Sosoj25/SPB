import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Switch } from "../components/DashboardWidgets";
import { useAdminDaySlots, useAdminScheduleMonth } from "../hooks/useAdmin";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchFacilitiesBySport, fetchFacility, fetchSportCatalog } from "../lib/catalog";
import { hoursBetween, toISODate, toHhMm, todayISO } from "../lib/bookings";
import {
  addCustomSlot,
  deleteSlot,
  ensureFutureSlots,
  setDayActive,
  setSlotActive,
} from "../lib/schedule";
import { errorMessage } from "../lib/errors";
import "./AdminSchedule.css";

const WEEKDAYS = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
const STATUS_LABEL = { open: "เปิด", partial: "บางส่วน", closed: "ปิด" };
const EMPTY_LIST = [];

const monthLabelFormatter = new Intl.DateTimeFormat("th-TH", {
  month: "long",
  year: "numeric",
  calendar: "gregory",
});

const dayLabelFormatter = new Intl.DateTimeFormat("th-TH", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  calendar: "gregory",
});

function buildCalendarCells(year, month) {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // 0 = จันทร์
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  while (cells.length % 7 !== 0) cells.push(null);

  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

export default function AdminSchedule() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [sportId, setSportId] = useState(null);
  const [facilityId, setFacilityId] = useState(null);
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [reloadKey, setReloadKey] = useState(0);
  const [actionError, setActionError] = useState("");
  const [savingSlotId, setSavingSlotId] = useState(null);
  const [extending, setExtending] = useState(false);
  const [extendMessage, setExtendMessage] = useState("");
  const [newSlotStart, setNewSlotStart] = useState("");
  const [newSlotEnd, setNewSlotEnd] = useState("");
  const [addingSlot, setAddingSlot] = useState(false);
  const [addSlotError, setAddSlotError] = useState("");

  const { data: sports } = useAsyncData(fetchSportCatalog, "schedule-sports", EMPTY_LIST);

  // ยังไม่เลือกเอง (หรือของเดิมหายไปจากลิสต์ใหม่) -> ใช้ตัวแรกของลิสต์แทน
  // คำนวณระหว่าง render ตรง ๆ แทนการ setState ใน effect (เข้ากับ
  // react-hooks/set-state-in-effect ของ eslint-plugin-react-hooks ในโปรเจกต์นี้)
  const effectiveSportId = sportId ?? sports[0]?.id ?? null;

  const { data: facilities } = useAsyncData(
    () => fetchFacilitiesBySport(effectiveSportId),
    effectiveSportId != null ? `schedule-facilities:${effectiveSportId}` : null,
    EMPTY_LIST,
  );

  const effectiveFacilityId = facilities.some((f) => f.id === facilityId)
    ? facilityId
    : (facilities[0]?.id ?? null);

  const { data: facility } = useAsyncData(
    () => fetchFacility(effectiveFacilityId),
    effectiveFacilityId != null ? `schedule-facility:${effectiveFacilityId}` : null,
  );

  const { summary } = useAdminScheduleMonth(effectiveFacilityId, year, month, reloadKey);
  const { slots, loading: slotsLoading } = useAdminDaySlots(
    effectiveFacilityId,
    selectedDate,
    reloadKey,
  );

  function changeMonth(delta) {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function selectDay(day) {
    setSelectedDate(toISODate(new Date(year, month, day)));
  }

  async function toggleSlot(slot) {
    setActionError("");
    setSavingSlotId(slot.id);

    try {
      let note = null;
      if (slot.isActive) {
        note = window.prompt("เหตุผลที่ปิดช่วงเวลานี้ (ไม่บังคับ)", "") ?? "";
      }
      await setSlotActive(slot.id, !slot.isActive, note || null);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("setSlotActive failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingSlotId(null);
    }
  }

  async function removeSlot(slot) {
    if (!window.confirm(`ลบช่วงเวลา ${toHhMm(slot.startTime)} – ${toHhMm(slot.endTime)} ทิ้งเลยไหม?`)) {
      return;
    }

    setActionError("");
    setSavingSlotId(slot.id);

    try {
      await deleteSlot(slot.id);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("deleteSlot failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setSavingSlotId(null);
    }
  }

  async function bulkSetDay(isActive) {
    if (!effectiveFacilityId) return;
    setActionError("");

    try {
      await setDayActive(effectiveFacilityId, selectedDate, isActive);
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("setDayActive failed:", err);
      setActionError(errorMessage(err));
    }
  }

  async function addSlot(e) {
    e.preventDefault();
    if (!effectiveFacilityId || !newSlotStart || !newSlotEnd) return;

    setAddSlotError("");
    setAddingSlot(true);

    try {
      await addCustomSlot(effectiveFacilityId, selectedDate, newSlotStart, newSlotEnd);
      setNewSlotStart("");
      setNewSlotEnd("");
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("addCustomSlot failed:", err);
      setAddSlotError(errorMessage(err));
    } finally {
      setAddingSlot(false);
    }
  }

  // สนามทุกแห่งมีตารางล่วงหน้าแค่ ~70 วัน ต่ออายุอัตโนมัติทุกคืนด้วย cron
  // (ดู 0021_account_status_and_operations.sql) ปุ่มนี้ให้แอดมินกดเติมเอง
  // ได้ทันทีโดยไม่ต้องรอรอบคืนถัดไป
  async function extendSlots() {
    setActionError("");
    setExtendMessage("");
    setExtending(true);

    try {
      const inserted = await ensureFutureSlots(70);
      setExtendMessage(
        inserted > 0
          ? `เติมช่วงเวลาล่วงหน้าเพิ่ม ${inserted} ช่วงแล้ว`
          : "ช่วงเวลาล่วงหน้าครบ 70 วันอยู่แล้ว ไม่มีอะไรต้องเติม",
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      console.error("ensureFutureSlots failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setExtending(false);
    }
  }

  const rows = buildCalendarCells(year, month);
  const selectedFacility = facilities.find((f) => f.id === effectiveFacilityId);

  return (
    <DashboardLayout
      variant="admin"
      title="จัดการตารางเวลา"
      subtitle="เปิด-ปิดวันและช่วงเวลาที่ให้จอง และปิดสนามชั่วคราว"
    >
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}
      {extendMessage && <div className="dash-message dash-message--success">{extendMessage}</div>}

      <div className="admin-schedule__context">
        <div className="admin-schedule__context-field">
          <span className="admin-schedule__context-label">กีฬา</span>
          <select
            className="admin-schedule__context-select"
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
        <div className="admin-schedule__context-field">
          <span className="admin-schedule__context-label">สนาม</span>
          <select
            className="admin-schedule__context-select"
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
        <div className="admin-schedule__month-nav">
          <button type="button" className="dash-pill dash-pill--tint" onClick={() => changeMonth(-1)}>
            ‹
          </button>
          <span className="dash-pill dash-pill--tint">{monthLabelFormatter.format(new Date(year, month, 1))}</span>
          <button type="button" className="dash-pill dash-pill--tint" onClick={() => changeMonth(1)}>
            ›
          </button>
        </div>
        <button
          type="button"
          className="dash-pill dash-pill--tint"
          onClick={extendSlots}
          disabled={extending}
        >
          {extending ? "กำลังเติม..." : "เติมช่วงเวลาล่วงหน้า"}
        </button>
      </div>

      {!effectiveFacilityId ? (
        <p className="dash-empty">ยังไม่มีสนามที่เปิดให้จองสำหรับกีฬานี้</p>
      ) : (
        <div className="admin-schedule">
          <section className="dash-card admin-schedule__calendar">
            <div className="admin-schedule__calendar-header">
              <h2>เลือกวันเพื่อแก้ไขช่วงเวลา</h2>
            </div>

            <div className="admin-schedule__weekdays">
              {WEEKDAYS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            {rows.map((row, i) => (
              <div key={i} className="admin-schedule__week">
                {row.map((day, j) => {
                  if (day == null) {
                    return <span key={`empty-${j}`} className="admin-schedule__day admin-schedule__day--empty" />;
                  }

                  const iso = toISODate(new Date(year, month, day));
                  const status = summary.get(iso) ?? "closed";

                  return (
                    <button
                      key={day}
                      type="button"
                      className={`admin-schedule__day admin-schedule__day--${status} ${
                        iso === selectedDate ? "admin-schedule__day--selected" : ""
                      }`}
                      onClick={() => selectDay(day)}
                    >
                      <span className="admin-schedule__day-number">{day}</span>
                      <span className="admin-schedule__day-label">{STATUS_LABEL[status]}</span>
                    </button>
                  );
                })}
              </div>
            ))}

            <div className="admin-schedule__legend">
              <div className="admin-schedule__legend-item">
                <span className="admin-schedule__swatch admin-schedule__swatch--open" />
                เปิดจองทั้งวัน
              </div>
              <div className="admin-schedule__legend-item">
                <span className="admin-schedule__swatch admin-schedule__swatch--partial" />
                เปิดบางช่วง
              </div>
              <div className="admin-schedule__legend-item">
                <span className="admin-schedule__swatch admin-schedule__swatch--closed" />
                ปิดทั้งวัน / ยังไม่เปิดตาราง
              </div>
              <div className="admin-schedule__legend-item">
                <span className="admin-schedule__swatch admin-schedule__swatch--editing" />
                กำลังแก้ไข
              </div>
            </div>
          </section>

          <aside className="dash-card admin-schedule__editor">
            <div>
              <h2>{dayLabelFormatter.format(new Date(`${selectedDate}T00:00:00`))}</h2>
              <p className="admin-schedule__editor-sub">
                {selectedFacility ? `${selectedFacility.venueName} · ${selectedFacility.name}` : ""}
              </p>
            </div>

            <div className="admin-schedule__mode-row">
              <button type="button" className="dash-pill dash-pill--tint" onClick={() => bulkSetDay(true)}>
                เปิดทั้งวัน
              </button>
              <button
                type="button"
                className="dash-pill admin-schedule__mode-neutral"
                onClick={() => bulkSetDay(false)}
              >
                ปิดทั้งวัน
              </button>
            </div>

            <form className="admin-schedule__add-slot" onSubmit={addSlot}>
              <div className="admin-schedule__add-slot-fields">
                <label className="admin-schedule__add-slot-field">
                  <span>เริ่ม</span>
                  <input
                    type="time"
                    value={newSlotStart}
                    onChange={(e) => setNewSlotStart(e.target.value)}
                    required
                  />
                </label>
                <label className="admin-schedule__add-slot-field">
                  <span>ถึง</span>
                  <input
                    type="time"
                    value={newSlotEnd}
                    onChange={(e) => setNewSlotEnd(e.target.value)}
                    required
                  />
                </label>
                <button type="submit" className="dash-pill dash-pill--tint" disabled={addingSlot}>
                  {addingSlot ? "กำลังเพิ่ม..." : "+ เพิ่มช่วงเวลา"}
                </button>
              </div>
              {addSlotError && <p className="admin-schedule__add-slot-error">{addSlotError}</p>}
            </form>

            <p className="admin-schedule__slots-label">ช่วงเวลา</p>

            {slotsLoading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
            {!slotsLoading && slots.length === 0 && (
              <p className="dash-empty">วันนี้ยังไม่มีช่วงเวลาให้จอง</p>
            )}

            {slots.map((slot) => {
              const price = facility
                ? Math.round(facility.pricePerHour * hoursBetween(slot.startTime, slot.endTime))
                : null;

              return (
                <div
                  key={slot.id}
                  className={`admin-schedule__slot ${
                    slot.bookedBy ? "admin-schedule__slot--booked" : ""
                  } ${!slot.isActive ? "admin-schedule__slot--off" : ""}`}
                >
                  <div className="admin-schedule__slot-info">
                    <p className="admin-schedule__slot-range">
                      {toHhMm(slot.startTime)} – {toHhMm(slot.endTime)}
                    </p>
                    <p className="admin-schedule__slot-note">
                      {slot.bookedBy
                        ? `มีผู้จองแล้ว · ${slot.bookedBy}`
                        : slot.isActive
                          ? "เปิดให้จอง"
                          : slot.closureNote || "ปิดให้บริการ"}
                    </p>
                  </div>
                  <div className="admin-schedule__slot-price">
                    <span>฿</span>
                    <strong>{price ?? "—"}</strong>
                  </div>
                  <Switch
                    on={slot.isActive}
                    onChange={() => toggleSlot(slot)}
                    disabled={Boolean(slot.bookedBy) || savingSlotId === slot.id}
                    label={`เปิดจองช่วง ${toHhMm(slot.startTime)}`}
                  />
                  <button
                    type="button"
                    className="admin-schedule__slot-delete"
                    onClick={() => removeSlot(slot)}
                    disabled={Boolean(slot.bookedBy) || savingSlotId === slot.id}
                    title="ลบช่วงเวลานี้"
                    aria-label={`ลบช่วงเวลา ${toHhMm(slot.startTime)} ถึง ${toHhMm(slot.endTime)}`}
                  >
                    ลบ
                  </button>
                </div>
              );
            })}
          </aside>
        </div>
      )}
    </DashboardLayout>
  );
}
