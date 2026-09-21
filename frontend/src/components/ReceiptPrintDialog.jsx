// กล่องตั้งค่าและสั่งพิมพ์ใบเสร็จที่เคาน์เตอร์ — ตัวอย่างบนจอคือเอกสารใบ
// เดียวกับที่ส่งเข้าเครื่องพิมพ์จริง (สร้างโดย lib/receiptPrint.js)
//
// ค่าที่ตั้งไว้ถูกเก็บลง localStorage ของเครื่องนั้น เพราะเป็นค่าของ
// "เครื่องพิมพ์ที่เคาน์เตอร์นี้" ไม่ใช่ค่าที่ใช้ร่วมกันทั้งระบบ
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Printer, TriangleAlert, X } from "lucide-react";
import {
  CLAMPS,
  DEFAULT_PRINT_SETTINGS,
  FACT_ALIGNMENTS,
  HEAD_ALIGNMENTS,
  LAYOUTS,
  PAPER_PRESETS,
  applyPaperPreset,
  buildReceiptDocument,
  loadPrintSettings,
  mmToPx,
  normalizeSettings,
  printReceiptDocument,
  pxToMm,
  savePrintSettings,
} from "../lib/receiptPrint";
import "./ReceiptPrintDialog.css";

// กล่องพิมพ์ใบเสร็จหน้าเคาน์เตอร์ — ตั้งค่ารูปแบบ + ดูตัวอย่างก่อนพิมพ์ในที่เดียว
//
// ตัวอย่างที่เห็นคือ iframe ที่โหลดเอกสารชุดเดียวกับที่ส่งเข้าเครื่องพิมพ์
// (buildReceiptDocument) ย่อด้วย transform: scale เฉย ๆ — ไม่ได้วาดใหม่
// ด้วย CSS ของแอป จึงไม่มีปัญหา "ตัวอย่างสวยแต่พิมพ์ออกมาคนละอย่าง"

// ความสูงชั่วคราวตอนยังไม่ได้วัดใบในโหมดกระดาษต่อเนื่อง — ให้ iframe สูงพอ
// จะไม่ตัดเนื้อหาก่อนวัดจริง
const UNMEASURED_HEIGHT_MM = 260;

const NUMBER_FIELDS = [
  { key: "widthMm", label: "ความกว้าง (มม.)", step: 1, resizesPaper: true },
  { key: "heightMm", label: "ความสูง (มม.)", step: 1, resizesPaper: true },
  { key: "marginMm", label: "ขอบกระดาษ (มม.)", step: 1 },
];

const SPACING_FIELDS = [
  { key: "contentGapMm", label: "ช่องว่างระหว่างบล็อก (มม.)", step: 0.5 },
  { key: "rowGapMm", label: "ช่องว่างระหว่างบรรทัด (มม.)", step: 0.5 },
  { key: "factGapMm", label: "ช่องว่างป้าย–ค่า (มม.)", step: 0.5 },
  { key: "headGapMm", label: "ช่องว่างหัวใบเสร็จ (มม.)", step: 0.5 },
];

const TOGGLES = [
  { key: "showVenue", label: "แสดงชื่อสนาม/สถานที่" },
  { key: "showPhone", label: "แสดงเบอร์ติดต่อลูกค้า" },
  { key: "showPayment", label: "แสดงช่องทางและเวลาที่ชำระเงิน" },
  { key: "showFooter", label: "แสดงข้อความท้ายใบ + เวลาที่พิมพ์" },
];

export default function ReceiptPrintDialog({ entry, isSample = false, onClose }) {
  const [settings, setSettings] = useState(loadPrintSettings);
  // ผลการวัดเอกสารตัวอย่าง (ความสูงจริง, ส่วนที่ล้น) ผูกไว้กับ html ที่วัด —
  // เอกสารเปลี่ยนเมื่อไหร่ค่าเก่าก็หมดอายุเองโดยไม่ต้องมี effect คอยล้าง
  const [measured, setMeasured] = useState(null);
  const [savedAt, setSavedAt] = useState(0);
  const [printing, setPrinting] = useState(false);

  const stageRef = useRef(null);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  // ค่าที่ผ่านการ clamp แล้ว — ช่องกรอกยังถือค่าดิบไว้ให้พิมพ์ได้อิสระ
  // แต่ตัวอย่าง/งานพิมพ์ต้องใช้ค่าที่อยู่ในกรอบที่รองรับจริงเสมอ
  const safe = useMemo(() => normalizeSettings(settings), [settings]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!savedAt) return undefined;
    const timer = setTimeout(() => setSavedAt(0), 2500);
    return () => clearTimeout(timer);
  }, [savedAt]);

  // ย่อใบเสร็จให้พอดีช่องตัวอย่าง — ต้องรู้ขนาดจริงของช่องก่อน จึงวัดเอาแทนการ
  // ฮาร์ดโค้ด เพราะกล่องยืดตามความกว้างจอ (ความสูงตรึงไว้ใน CSS จึงไม่วนกลับ
  // มาเปลี่ยนขนาดตัวเองตามเนื้อหาที่ย่อ)
  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return undefined;

    const observer = new ResizeObserver(([record]) => {
      setStage({ width: record.contentRect.width, height: record.contentRect.height });
    });

    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ตัวอย่างโชว์ใบเดียวเสมอ ต่อให้ตั้งพิมพ์หลายใบ — ทุกใบหน้าตาเหมือนกัน
  const previewHtml = useMemo(
    () => buildReceiptDocument({ entry, settings: safe, copies: 1 }),
    [entry, safe],
  );

  const fresh = measured?.html === previewHtml ? measured : null;
  const measuredMm = fresh?.mm ?? null;

  function handleFrameLoad(event) {
    // load ของ about:blank ตอน iframe เพิ่งเกิดก็เข้ามาที่นี่ได้ — ยังไม่มีใบ
    // ให้วัด ปล่อยผ่านไปรอ load ของเอกสารจริง
    const doc = event.currentTarget.contentDocument;
    if (!doc?.querySelector(".card")) return;

    function measure() {
      const card = doc.querySelector(".card");
      if (!card) return;

      setMeasured({
        html: previewHtml,
        // +1 มม. กันปัดเศษ ไม่งั้นบางทีล้นไปหน้าที่สองแบบว่าง ๆ
        mm: Math.ceil(pxToMm(doc.body.scrollHeight)) + 1,
        // ใบถูก overflow:hidden ทับไว้ ของที่ล้นจะหายไปเงียบ ๆ ตอนพิมพ์ —
        // scroll size ยังบอกขนาดจริงของเนื้อหาอยู่ เอามาเตือนก่อนเสียกระดาษ
        overflowMm: Math.max(0, Math.round(pxToMm(card.scrollHeight - card.clientHeight))),
        overflowXMm: Math.max(0, Math.round(pxToMm(card.scrollWidth - card.clientWidth))),
      });
    }

    // วัดก่อนฟอนต์มาถึง = ได้ความสูงของฟอนต์สำรอง ซึ่งเป็นคนละขนาดกับที่พิมพ์
    // จริง (สำคัญกับโหมดตัดกระดาษพอดีเนื้อหาและคำเตือนเนื้อหาล้น)
    measure();
    Promise.resolve(doc.fonts?.ready).then(measure, () => {});
  }

  const previewHeightMm = safe.autoHeight
    ? (measuredMm ?? UNMEASURED_HEIGHT_MM)
    : safe.heightMm;

  const scale =
    stage.width && stage.height
      ? Math.min(
          1,
          stage.width / mmToPx(safe.widthMm),
          stage.height / mmToPx(previewHeightMm),
        )
      : 1;

  function update(patch, { resizesPaper = false } = {}) {
    setSettings((prev) => ({
      ...prev,
      ...patch,
      // ชื่อ preset บอกแค่ "ขนาดกระดาษ" — เปลี่ยนกว้าง/สูงเมื่อไหร่ก็ไม่ใช่
      // กระดาษมาตรฐานใบนั้นอีกต่อไป ส่วนโครงใบ/ฟอนต์ปรับได้โดยไม่เสียชื่อ
      ...(resizesPaper ? { paper: "custom" } : {}),
    }));
  }

  // ช่องตัวเลขทุกช่องหน้าตาเดียวกันหมด ต่างแค่ key/ช่วงค่า — ประกอบจากตาราง
  // ฟิลด์แทนการเขียน JSX ซ้ำหลายชุด
  function numberField(field) {
    const [min, max] = CLAMPS[field.key];

    return (
      <label key={field.key} className="receipt-print-dialog__field">
        <span>{field.label}</span>
        <input
          type="number"
          value={settings[field.key]}
          min={min}
          max={max}
          step={field.step}
          disabled={field.key === "heightMm" && safe.autoHeight}
          onChange={(e) =>
            update(
              { [field.key]: e.target.value === "" ? "" : Number(e.target.value) },
              { resizesPaper: field.resizesPaper },
            )
          }
          // ระหว่างพิมพ์ปล่อยให้ค่าดิบเป็นอะไรก็ได้ (ลบทิ้งจนว่าง/เกินเพดาน)
          // พอออกจากช่องค่อยดึงกลับเข้ากรอบ ช่องกรอกจะได้ตรงกับตัวอย่างเสมอ
          onBlur={() => setSettings(safe)}
        />
      </label>
    );
  }

  function handleSave() {
    savePrintSettings(safe);
    setSettings(safe);
    setSavedAt(Date.now());
  }

  async function handlePrint() {
    if (printing) return;

    // จำค่าที่เพิ่งใช้พิมพ์ไว้เป็นค่าตั้งต้นครั้งหน้าเลย — เคาน์เตอร์ตั้งครั้งเดียว
    // แล้วพิมพ์ซ้ำได้ทั้งวันโดยไม่ต้องกดบันทึกแยก
    savePrintSettings(safe);

    // กระดาษต่อเนื่อง: ใช้ความสูงที่วัดได้จริงจากตัวอย่าง เพื่อไม่ให้เครื่อง
    // เดินกระดาษเปล่าต่อท้ายทุกใบ
    const printSettings = safe.autoHeight
      ? { ...safe, heightMm: measuredMm ?? safe.heightMm }
      : safe;

    setPrinting(true);
    try {
      await printReceiptDocument(buildReceiptDocument({ entry, settings: printSettings }));
    } finally {
      setPrinting(false);
    }
  }

  // โหมดตัดกระดาษพอดีเนื้อหาไม่มีเพดานความสูงให้ล้น จึงเตือนเฉพาะแนวนอน
  const overflowNotes = [
    !safe.autoHeight && fresh?.overflowMm > 0
      ? `เนื้อหาสูงเกินใบประมาณ ${fresh.overflowMm} มม.`
      : null,
    fresh?.overflowXMm > 0 ? `เนื้อหากว้างเกินใบประมาณ ${fresh.overflowXMm} มม.` : null,
  ].filter(Boolean);

  const paperPreset = PAPER_PRESETS.find((p) => p.key === safe.paper);
  const layoutHint = LAYOUTS.find((l) => l.key === safe.layout)?.hint;

  return (
    <div
      className="receipt-print-dialog__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="receipt-print-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isSample ? "ตั้งค่ารูปแบบการพิมพ์ใบเสร็จ" : "พิมพ์ใบเสร็จ"}
      >
        <header className="receipt-print-dialog__head">
          <div>
            <h2>{isSample ? "ตั้งค่ารูปแบบการพิมพ์ใบเสร็จ" : "พิมพ์ใบเสร็จ"}</h2>
            <p>
              {isSample
                ? "ปรับขนาดกระดาษและรูปแบบใบเสร็จด้วยข้อมูลตัวอย่าง ค่าที่บันทึกจะถูกใช้กับทุกใบที่พิมพ์จากเครื่องนี้"
                : `${entry.customerName} · ${entry.bookingCode}`}
            </p>
          </div>
          <button
            type="button"
            className="receipt-print-dialog__close"
            onClick={onClose}
            aria-label="ปิด"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className="receipt-print-dialog__body">
          <section className="receipt-print-dialog__preview">
            <div className="receipt-print-dialog__preview-head">
              <h3>ตัวอย่างก่อนพิมพ์</h3>
              <span>
                {safe.widthMm} × {safe.autoHeight ? (measuredMm ?? "—") : safe.heightMm} มม.
                {scale < 1 ? ` · ย่อ ${Math.round(scale * 100)}%` : ""}
              </span>
            </div>

            <div className="receipt-print-dialog__stage" ref={stageRef}>
              <div
                className="receipt-print-dialog__paper"
                style={{
                  width: `${mmToPx(safe.widthMm) * scale}px`,
                  height: `${mmToPx(previewHeightMm) * scale}px`,
                }}
              >
                <iframe
                  title="ตัวอย่างใบเสร็จ"
                  srcDoc={previewHtml}
                  onLoad={handleFrameLoad}
                  style={{
                    width: `${mmToPx(safe.widthMm)}px`,
                    height: `${mmToPx(previewHeightMm)}px`,
                    transform: `scale(${scale})`,
                  }}
                />
              </div>
            </div>

            {overflowNotes.length > 0 && (
              <p className="receipt-print-dialog__warn">
                <TriangleAlert size={15} aria-hidden="true" /> {overflowNotes.join(" และ ")}{" "}
                ส่วนที่ล้นจะถูกตัดทิ้งตอนพิมพ์ —
                ขยายกระดาษ ลดขนาดตัวอักษร ลดช่องว่าง หรือปิดข้อมูลบางส่วน
              </p>
            )}

            <p className="receipt-print-dialog__preview-note">
              ใบเสร็จที่พิมพ์เป็นหลักฐานการชำระเงินอย่างเดียว ไม่มี QR —
              ลูกค้าใช้ QR บนใบเสร็จในแอปของตัวเองเช็คอิน/เช็คเอาต์ตามปกติ
            </p>
          </section>

          <section className="receipt-print-dialog__settings">
            <label className="receipt-print-dialog__field">
              <span>ขนาดกระดาษ</span>
              <select
                value={safe.paper}
                onChange={(e) =>
                  setSettings((prev) => normalizeSettings(applyPaperPreset(prev, e.target.value)))
                }
              >
                {PAPER_PRESETS.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>
            {paperPreset?.hint && (
              <p className="receipt-print-dialog__hint">{paperPreset.hint}</p>
            )}

            <div className="receipt-print-dialog__field">
              <span>รูปแบบใบเสร็จ</span>
              <div className="receipt-print-dialog__choices">
                {LAYOUTS.map((layout) => (
                  <button
                    key={layout.key}
                    type="button"
                    className={`receipt-print-dialog__choice ${
                      safe.layout === layout.key ? "receipt-print-dialog__choice--active" : ""
                    }`}
                    onClick={() => update({ layout: layout.key })}
                  >
                    {layout.label}
                  </button>
                ))}
              </div>
            </div>
            {layoutHint && <p className="receipt-print-dialog__hint">{layoutHint}</p>}

            <div className="receipt-print-dialog__grid">{NUMBER_FIELDS.map(numberField)}</div>

            <label className="receipt-print-dialog__field">
              <span>ขนาดตัวอักษร · {Math.round(safe.fontScale * 100)}%</span>
              <input
                type="range"
                min={CLAMPS.fontScale[0]}
                max={CLAMPS.fontScale[1]}
                step={0.05}
                value={safe.fontScale}
                onChange={(e) => update({ fontScale: Number(e.target.value) })}
              />
            </label>

            <div className="receipt-print-dialog__grid">{SPACING_FIELDS.map(numberField)}</div>
            <p className="receipt-print-dialog__hint">
              "ระหว่างบล็อก" คือช่องไฟระหว่างหัวใบ / ชื่อ / ตารางข้อมูล / ยอดเงิน,
              "ระหว่างบรรทัด" คือช่องไฟบน-ล่างของแต่ละบรรทัด, "ป้าย–ค่า"
              คือระยะแนวนอนระหว่างหัวข้อกับค่า เช่น วันที่ ↔ 02 ก.ย. ส่วน "หัวใบเสร็จ"
              คือระยะระหว่างชื่อสนามกับป้ายสถานะเช็คอิน
            </p>

            <div className="receipt-print-dialog__field">
              <span>การวางค่าในแต่ละบรรทัด</span>
              <div className="receipt-print-dialog__choices">
                {FACT_ALIGNMENTS.map((align) => (
                  <button
                    key={align.key}
                    type="button"
                    className={`receipt-print-dialog__choice ${
                      safe.factAlign === align.key ? "receipt-print-dialog__choice--active" : ""
                    }`}
                    onClick={() => update({ factAlign: align.key })}
                  >
                    {align.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="receipt-print-dialog__hint">
              {safe.factAlign === "close"
                ? "ค่าอยู่ติดป้ายตามระยะ ป้าย–ค่า ที่ตั้งไว้"
                : "ค่าถูกดันไปชิดขอบขวาของใบเสมอ — ระยะ ป้าย–ค่า จะยังไม่มีผลจนกว่าจะเลือก \"ค่าอยู่ติดป้าย\""}
            </p>

            <div className="receipt-print-dialog__field">
              <span>การวางหัวใบเสร็จ (ชื่อสนาม ↔ ป้ายสถานะ)</span>
              <div className="receipt-print-dialog__choices">
                {HEAD_ALIGNMENTS.map((align) => (
                  <button
                    key={align.key}
                    type="button"
                    className={`receipt-print-dialog__choice ${
                      safe.headAlign === align.key ? "receipt-print-dialog__choice--active" : ""
                    }`}
                    disabled={safe.layout === "slip"}
                    onClick={() => update({ headAlign: align.key })}
                  >
                    {align.label}
                  </button>
                ))}
              </div>
            </div>
            {safe.layout === "slip" && (
              <p className="receipt-print-dialog__hint">
                รูปแบบแถบยาวไม่มีแถวหัวใบ — ชื่อสนามอยู่กลางบรรทัดบนสุด
                ส่วนสถานะเช็คอินอยู่ในตารางข้อมูล
              </p>
            )}

            <label className="receipt-print-dialog__field">
              <span>จำนวนใบต่อการพิมพ์หนึ่งครั้ง</span>
              <select
                value={safe.copies}
                onChange={(e) => update({ copies: Number(e.target.value) })}
              >
                <option value={1}>1 ใบ (ให้ลูกค้า)</option>
                <option value={2}>2 ใบ (ลูกค้า + เคาน์เตอร์)</option>
                <option value={3}>3 ใบ</option>
              </select>
            </label>

            <label className="receipt-print-dialog__check">
              <input
                type="checkbox"
                checked={safe.autoHeight}
                onChange={(e) => update({ autoHeight: e.target.checked })}
              />
              <span>
                ตัดกระดาษพอดีเนื้อหา (กระดาษม้วน/เครื่องพิมพ์ใบเสร็จ)
                {safe.autoHeight && measuredMm ? ` — วัดได้ ${measuredMm} มม.` : ""}
              </span>
            </label>

            {TOGGLES.map((toggle) => (
              <label key={toggle.key} className="receipt-print-dialog__check">
                <input
                  type="checkbox"
                  checked={safe[toggle.key]}
                  onChange={(e) => update({ [toggle.key]: e.target.checked })}
                />
                <span>{toggle.label}</span>
              </label>
            ))}

            <label className="receipt-print-dialog__check">
              <input
                type="checkbox"
                checked={safe.autoPrint}
                onChange={(e) => update({ autoPrint: e.target.checked })}
              />
              <span>เปิดกล่องพิมพ์อัตโนมัติทันทีที่เช็คอินสำเร็จ</span>
            </label>

            <button
              type="button"
              className="receipt-print-dialog__reset"
              onClick={() => setSettings({ ...DEFAULT_PRINT_SETTINGS })}
            >
              คืนค่าเริ่มต้น
            </button>
          </section>
        </div>

        <footer className="receipt-print-dialog__foot">
          {savedAt > 0 && (
            <span className="receipt-print-dialog__saved">บันทึกค่าการพิมพ์แล้ว</span>
          )}
          <button type="button" className="receipt-print-dialog__ghost" onClick={handleSave}>
            บันทึกค่าเริ่มต้น
          </button>
          <button
            type="button"
            className="receipt-print-dialog__print"
            onClick={handlePrint}
            disabled={printing}
            autoFocus
          >
            {printing ? (
              "กำลังส่งไปเครื่องพิมพ์..."
            ) : (
              <>
                <Printer size={15} aria-hidden="true" /> {isSample ? "พิมพ์ทดสอบ" : "พิมพ์ใบเสร็จ"}
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
}
