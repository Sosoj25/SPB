// ใบเสร็จรับเงินที่แอดมินพิมพ์ให้ลูกค้าที่เคาน์เตอร์ (หน้า /admin/checkin)
//
// นี่เป็นทางเดียวในระบบที่ใบเสร็จออกมาเป็นกระดาษ — ฝั่งลูกค้า
// (BookingReceipt.jsx) สั่งพิมพ์เองไม่ได้ ทำได้แค่บันทึกเป็นไฟล์รูป
//
// ตัวใบถูกสร้างเป็น "เอกสาร HTML เต็มใบ" แล้วโยนใส่ iframe ซ่อน — ไม่ใช่
// @media print ทับหน้าเช็คอิน เพราะ:
//   1. ขนาดกระดาษต้องเปลี่ยนได้ตอนรันไทม์ (@page size มาจากค่าที่แอดมินตั้ง)
//      ซึ่งเขียนไว้ใน CSS ไฟล์นิ่ง ๆ ไม่ได้
//   2. เอกสารแยกใบไม่โดน CSS ของแอปทั้งก้อนกวน — สิ่งที่เห็นในตัวอย่างก่อนพิมพ์
//      คือเอกสารใบเดียวกับที่ส่งเข้าเครื่องพิมพ์จริง
// ใช้ iframe ไม่ใช่ window.open เพราะ popup blocker ปิดหน้าต่างพิมพ์ทิ้งเงียบ ๆ ได้
//
// ใบเสร็จไม่มี QR — QR สำหรับเช็คอิน/เช็คเอาต์อยู่บนใบเสร็จฉบับไฟล์ของลูกค้า
// (lib/receiptImage.js) ที่เปิดจากมือถือได้อยู่แล้ว ใบกระดาษที่เคาน์เตอร์เป็น
// หลักฐานการจ่ายเงินอย่างเดียว ที่หน้าเคาน์เตอร์เองก็ค้นด้วยชื่อ/เบอร์/รหัสจอง
// ได้ตรง ๆ ไม่ต้องยิงสแกนจากกระดาษที่ตัวเองเพิ่งพิมพ์
import {
  describePayment,
  formatBaht,
  formatBookingDate,
  hoursBetween,
  toHhMm,
} from "./bookings";
import { describeMethod } from "./payments";

const MM_PER_INCH = 25.4;
const CSS_DPI = 96;

export const mmToPx = (mm) => (mm * CSS_DPI) / MM_PER_INCH;
export const pxToMm = (px) => (px * MM_PER_INCH) / CSS_DPI;

// layout = โครงใบเสร็จ ไม่ใช่ขนาดกระดาษ — กระดาษใบเดียวกันเลือกได้หลายโครง
export const LAYOUTS = [
  {
    key: "full",
    label: "เต็มใบ",
    hint: "หัวใบเสร็จเต็ม + รายละเอียดครบ เหมาะกับ A4/A5/A6",
  },
  {
    key: "slip",
    label: "แถบยาว",
    hint: "คอลัมน์เดียวแคบ ๆ จัดกึ่งกลาง เหมาะกับเครื่องพิมพ์ใบเสร็จความร้อน",
  },
];

// ค่าเริ่มต้นของแต่ละกระดาษเซ็ตทั้งขนาด/ขอบ/โครงใบ/ขนาดตัวอักษรมาให้พร้อมใช้
// เลือกกระดาษแล้วพิมพ์ได้เลยโดยไม่ต้องจูนต่อ แต่ยังแก้ทีละค่าได้ทีหลัง
export const PAPER_PRESETS = [
  {
    key: "a4",
    label: "A4",
    hint: "210 × 297 มม. — เครื่องพิมพ์เอกสารทั่วไป",
    widthMm: 210,
    heightMm: 297,
    marginMm: 18,
    layout: "full",
    fontScale: 1.25,
  },
  {
    key: "a5",
    label: "A5",
    hint: "148 × 210 มม. — ครึ่ง A4",
    widthMm: 148,
    heightMm: 210,
    marginMm: 12,
    layout: "full",
    fontScale: 1.05,
  },
  {
    key: "a6",
    label: "A6 (กระดาษเล็ก)",
    hint: "105 × 148 มม. — ขนาดโปสต์การ์ด",
    widthMm: 105,
    heightMm: 148,
    marginMm: 7,
    layout: "full",
    fontScale: 0.9,
  },
  {
    key: "receipt-80",
    label: "ใบเสร็จ 80 มม.",
    hint: "เครื่องพิมพ์ความร้อนกระดาษต่อเนื่อง",
    widthMm: 80,
    heightMm: 150,
    marginMm: 4,
    layout: "slip",
    fontScale: 0.85,
    autoHeight: true,
  },
  {
    key: "receipt-58",
    label: "ใบเสร็จ 58 มม.",
    hint: "เครื่องพิมพ์ความร้อนใบเล็ก",
    widthMm: 58,
    heightMm: 140,
    marginMm: 3,
    layout: "slip",
    fontScale: 0.75,
    autoHeight: true,
  },
  {
    key: "custom",
    label: "กำหนดเอง",
    hint: "ตั้งความกว้าง/ความสูงเองทั้งหมด",
  },
];

export const DEFAULT_PRINT_SETTINGS = {
  paper: "a6",
  widthMm: 105,
  heightMm: 148,
  marginMm: 7,
  layout: "full",
  fontScale: 0.9,
  // กระดาษม้วนไม่มี "หน้า" — วัดความสูงจริงของใบเสร็จจากตัวอย่างก่อนพิมพ์ แล้ว
  // ค่อยบอก @page ให้ตัดพอดีเนื้อหา ไม่งั้นเครื่องจะเดินกระดาษเปล่าต่อจน
  // ครบความสูงหน้าที่ตั้งไว้
  autoHeight: false,
  copies: 1,
  // ช่องว่างระหว่างบล็อกใหญ่ (หัวใบ/ชื่อ/ตารางข้อมูล/ยอดเงิน) กับระหว่างบรรทัด
  // ในตารางข้อมูล แยกกันคนละค่า — ใบเล็กมักต้องบีบบรรทัดให้ชิดโดยที่ยังอยากให้
  // บล็อกยอดเงินห่างจากตัวหนังสือเท่าเดิม
  contentGapMm: 3,
  rowGapMm: 1,
  // ระยะแนวนอนระหว่างป้ายกับค่าในแต่ละบรรทัด — คนละแกนกับ rowGapMm
  // (บน-ล่าง) ค่านี้จะเห็นผลจริงก็ต่อเมื่อ factAlign เป็น "close" เพราะโหมด
  // "spread" ดันค่าไปชิดขวาสุดของบรรทัดอยู่แล้ว
  factGapMm: 2,
  factAlign: "spread",
  // แถวหัวใบ (ชื่อสนาม ↔ ป้ายสถานะเช็คอิน) คุมแยกจากตารางข้อมูล เพราะเป็น
  // คนละแถวคนละบทบาท — ตั้งต้นให้ป้ายสถานะเกาะข้างชื่อสนามแล้วค่อยปรับระยะเอา
  // (ดันไปชิดขอบขวาสุดยังเลือกได้ด้วย headAlign: "spread")
  headGapMm: 3,
  headAlign: "close",
  showVenue: true,
  showPhone: true,
  showPayment: true,
  showFooter: true,
  // เปิดกล่องพิมพ์ให้เองทันทีที่เช็คอินสำเร็จ — เคาน์เตอร์ที่พิมพ์ใบเสร็จให้ทุกคน
  // จะได้ไม่ต้องกดปุ่มซ้ำทุกราย ค่าเริ่มต้นปิดไว้เพราะบางสนามพิมพ์แค่บางราย
  autoPrint: false,
};

export const FACT_ALIGNMENTS = [
  { key: "spread", label: "ค่าชิดขวาสุด" },
  { key: "close", label: "ค่าอยู่ติดป้าย" },
];

export const HEAD_ALIGNMENTS = [
  { key: "spread", label: "ป้ายสถานะชิดขวา" },
  { key: "close", label: "ป้ายสถานะติดชื่อ" },
];

export const CLAMPS = {
  widthMm: [40, 320],
  heightMm: [40, 420],
  marginMm: [0, 30],
  fontScale: [0.6, 1.6],
  copies: [1, 3],
  contentGapMm: [0, 15],
  rowGapMm: [0, 10],
  factGapMm: [0, 20],
  headGapMm: [0, 20],
};

const clamp = (value, [min, max]) => Math.min(max, Math.max(min, value));

// ช่องกรอกที่ถูกลบจนว่างหรือพิมพ์ค้างกลางคัน ("-", "1.") ต้องไม่ทำให้ตัวอย่าง
// พังไปด้วย — ค่าที่ไม่ใช่ตัวเลขตกกลับไปใช้ค่าเดิมเสมอ
function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function applyPaperPreset(settings, paperKey) {
  const preset = PAPER_PRESETS.find((p) => p.key === paperKey);
  if (!preset || paperKey === "custom") return { ...settings, paper: paperKey };

  return {
    ...settings,
    paper: preset.key,
    widthMm: preset.widthMm,
    heightMm: preset.heightMm,
    marginMm: preset.marginMm,
    layout: preset.layout,
    fontScale: preset.fontScale,
    autoHeight: preset.autoHeight ?? false,
  };
}

// ตั้งค่าเก็บใน localStorage ไม่ใช่ฐานข้อมูล — เป็นค่าของ "เครื่องพิมพ์ตัวนี้
// ที่เคาน์เตอร์นี้" ไม่ใช่นโยบายของสนาม แต่ละเคาน์เตอร์ใช้กระดาษคนละแบบได้
const STORAGE_KEY = "spb.receiptPrint.v1";

export function normalizeSettings(raw) {
  const merged = { ...DEFAULT_PRINT_SETTINGS, ...(raw ?? {}) };
  const fallback = DEFAULT_PRINT_SETTINGS;

  return {
    ...merged,
    widthMm: clamp(num(merged.widthMm, fallback.widthMm), CLAMPS.widthMm),
    heightMm: clamp(num(merged.heightMm, fallback.heightMm), CLAMPS.heightMm),
    marginMm: clamp(num(merged.marginMm, fallback.marginMm), CLAMPS.marginMm),
    paper: PAPER_PRESETS.some((p) => p.key === merged.paper) ? merged.paper : "custom",
    layout: LAYOUTS.some((l) => l.key === merged.layout) ? merged.layout : "full",
    factAlign: FACT_ALIGNMENTS.some((a) => a.key === merged.factAlign)
      ? merged.factAlign
      : "spread",
    headAlign: HEAD_ALIGNMENTS.some((a) => a.key === merged.headAlign)
      ? merged.headAlign
      : "spread",
    fontScale: clamp(num(merged.fontScale, fallback.fontScale), CLAMPS.fontScale),
    copies: Math.round(clamp(num(merged.copies, fallback.copies), CLAMPS.copies)),
    contentGapMm: clamp(num(merged.contentGapMm, fallback.contentGapMm), CLAMPS.contentGapMm),
    rowGapMm: clamp(num(merged.rowGapMm, fallback.rowGapMm), CLAMPS.rowGapMm),
    factGapMm: clamp(num(merged.factGapMm, fallback.factGapMm), CLAMPS.factGapMm),
    headGapMm: clamp(num(merged.headGapMm, fallback.headGapMm), CLAMPS.headGapMm),
    autoHeight: Boolean(merged.autoHeight),
    showVenue: Boolean(merged.showVenue),
    showPhone: Boolean(merged.showPhone),
    showPayment: Boolean(merged.showPayment),
    showFooter: Boolean(merged.showFooter),
    autoPrint: Boolean(merged.autoPrint),
  };
}

export function loadPrintSettings() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    // โหมดส่วนตัว/เบราว์เซอร์ที่บล็อก storage — ใช้ค่าเริ่มต้นไปก่อน ไม่ต้องพัง
    return { ...DEFAULT_PRINT_SETTINGS };
  }
}

export function savePrintSettings(settings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
    return true;
  } catch {
    return false;
  }
}

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const printedAtFormatter = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

const clockFormatter = new Intl.DateTimeFormat("th-TH", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

// วันที่บนใบเสร็จอ่านจากนาฬิกาไทยเสมอ ไม่ใช่โซนเวลาของเครื่องแอดมิน —
// admin_today_checkins กรองด้วย (now() at time zone 'Asia/Bangkok')::date
// ถ้าเครื่องเคาน์เตอร์ตั้งโซนเวลาผิด ใบเสร็จจะพิมพ์วันที่ไม่ตรงกับที่ระบบยึด
const bangkokDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const bangkokTodayISO = () => bangkokDateFormatter.format(new Date());

// รายการที่หน้าเช็คอินส่งมาเป็นการจองของ "วันนี้" เสมอ (RPC กรองมาแล้ว)
// — bookingDate จึงตกเป็นวันนี้ได้ถ้าผู้เรียกไม่ได้ส่งมา
export function receiptFields(entry, { printedAt = new Date() } = {}) {
  const dateISO = entry.bookingDate ?? bangkokTodayISO();

  // ยอดบนใบเสร็จอ่านจากค่าที่บันทึกไว้ตอนจองล้วน ๆ ไม่คิดใหม่จากราคาต่อชั่วโมง
  // — ราคาที่คิดจริงมาจาก pricing engine (0024) ซึ่งคิดตามช่วงเวลา คูณเอาเอง
  // ตรงนี้จะได้ยอดที่ไม่ตรงกับที่ลูกค้าจ่ายไป
  const subtotal = Number(entry.originalAmount ?? entry.totalAmount ?? 0);
  const discount = Number(entry.discountAmount ?? 0);
  const deposit = Number(entry.depositAmount ?? 0);
  const hours = hoursBetween(entry.startTime, entry.endTime);
  const hoursLabel = Number.isFinite(hours)
    ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ชม.`
    : "";

  return {
    venueName: entry.venueName || "SPORTSBOOKING",
    customerName: entry.customerName || "ลูกค้า",
    customerPhone: entry.customerPhone || "—",
    bookingCode: entry.bookingCode,
    sportName: entry.sportName || "กีฬา",
    facilityName: entry.facilityName || "สนาม",
    dateLabel: formatBookingDate(dateISO),
    timeLabel: `${toHhMm(entry.startTime)} – ${toHhMm(entry.endTime)} น.`,
    // พิมพ์ซ้ำหลังเช็คเอาต์ได้ (เช่นพิมพ์ครั้งแรกไม่ติด) — สถานะบนใบต้องตรงกับ
    // ความจริงตอนพิมพ์ ไม่ใช่ค้างว่า "เช็คอินแล้ว" ตลอด
    checkedInLabel: entry.checkedOutAt
      ? `เช็คเอาต์แล้ว ${clockFormatter.format(new Date(entry.checkedOutAt))} น.`
      : entry.checkedInAt
        ? `เช็คอินแล้ว ${clockFormatter.format(new Date(entry.checkedInAt))} น.`
        : "ยังไม่เช็คอิน",
    // ถ้อยคำระดับ "การจอง" (ชำระเงินแล้ว / รอตรวจสอบ…) ไม่ใช่ถ้อยคำของแถว
    // payments — payment_status ของ booking ที่เป็น 'paid' คือเงินเข้าจริงแล้ว
    // (PlernPay ยืนยันเอง) ส่วน describePaymentStatus() ใน lib/payments.js อ่าน
    // 'paid' เป็น "รอตรวจสอบ" เพราะเป็นมุมของแถวชำระเงินที่แอดมินต้องกดอนุมัติ
    // ใบเสร็จที่บอกว่า "รอตรวจสอบ" ทั้งที่เงินเข้าแล้วคือใบที่ผิด
    paymentLabel: describePayment({ payment_status: entry.paymentStatus }),
    printedAtLabel: printedAtFormatter.format(printedAt),
    // บรรทัดค่าสนามเขียนให้อ่านเหมือนใบเสร็จในแอปเป๊ะ ๆ (BookingReceipt.jsx)
    // ลูกค้าที่เทียบสองใบจะได้ไม่สงสัยว่าคนละยอดกัน
    lineLabel:
      entry.pricePerHour > 0
        ? `ค่าสนาม ${hoursLabel} × ${formatBaht(entry.pricePerHour)}`
        : `ค่าสนาม ${hoursLabel}`.trim(),
    subtotalLabel: formatBaht(subtotal),
    // ส่วนลด/มัดจำเป็นบรรทัดที่ "มีก็ต่อเมื่อมีจริง" — ค่าว่างแปลว่าไม่ต้องพิมพ์
    discountLabel: discount > 0 ? `-${formatBaht(discount)}` : "",
    totalLabel: formatBaht(entry.totalAmount ?? 0),
    depositLabel: deposit > 0 ? formatBaht(deposit) : "",
    methodLabel: entry.paymentMethod ? describeMethod(entry.paymentMethod) : "—",
    paidAtLabel: entry.paidAt ? printedAtFormatter.format(new Date(entry.paidAt)) : "—",
  };
}

function factRows(fields, settings) {
  const rows = [
    ["กีฬา / สนาม", `${fields.sportName} · ${fields.facilityName}`],
    ["วันที่", fields.dateLabel],
    ["เวลา", fields.timeLabel],
  ];

  if (settings.showPhone) rows.push(["เบอร์ติดต่อ", fields.customerPhone]);
  if (settings.showPayment) {
    // ใบเสร็จต้องบอกด้วยว่าเงินเข้ามาทางไหนและเมื่อไหร่ ไม่ใช่แค่ "ชำระแล้ว"
    // — เป็นข้อมูลที่ลูกค้าเอาไปกระทบยอดกับสลิป/รายการเดินบัญชีของตัวเอง
    rows.push(["การชำระเงิน", `${fields.paymentLabel} · ${fields.methodLabel}`]);
    rows.push(["ชำระเมื่อ", fields.paidAtLabel]);
  }
  rows.push(["สถานะ", fields.checkedInLabel]);

  return rows;
}

const renderFacts = (rows) =>
  rows
    .map(
      ([label, value]) =>
        `<div class="fact"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`,
    )
    .join("");

// บล็อกตัวเงิน แยกจากตารางข้อมูลด้านบน — ยอดสุทธิต้องเด่นกว่าทุกบรรทัดบนใบ
// เพราะเป็นบรรทัดเดียวที่คนกวาดตาหาก่อนเสมอ
function renderSums(fields) {
  const line = (label, value, modifier = "") =>
    `<div class="sum${modifier}"><span>${escapeHtml(label)}</span><span>${escapeHtml(
      value,
    )}</span></div>`;

  return `<div class="sums">
    ${line(fields.lineLabel, fields.subtotalLabel)}
    ${fields.discountLabel ? line("ส่วนลดจากคูปอง", fields.discountLabel) : ""}
    ${line("ยอดชำระทั้งหมด", fields.totalLabel, " sum--total")}
    ${fields.depositLabel ? line("ยอดมัดจำ (ไม่คืนเงิน)", fields.depositLabel, " sum--hint") : ""}
  </div>`;
}

function renderReceipt(fields, settings) {
  const venue = settings.showVenue ? `<p class="venue">${escapeHtml(fields.venueName)}</p>` : "";
  const code = `<p class="code">เลขที่ ${escapeHtml(fields.bookingCode)}</p>`;
  const details = `<h1 class="name">${escapeHtml(fields.customerName)}</h1>
    <dl class="facts">${renderFacts(factRows(fields, settings))}</dl>
    ${renderSums(fields)}`;
  const footer = settings.showFooter
    ? `<footer class="foot"><span>เก็บใบนี้ไว้เป็นหลักฐานการชำระเงิน · ขอบคุณที่ใช้บริการ</span><span>พิมพ์เมื่อ ${escapeHtml(
        fields.printedAtLabel,
      )}</span></footer>`
    : "";

  if (settings.layout === "slip") {
    return `<article class="card card--slip">
      ${venue}
      <h2 class="title">ใบเสร็จรับเงิน</h2>
      ${code}
      <hr class="rule" />
      ${details}
      ${footer}
    </article>`;
  }

  return `<article class="card card--full">
    <div class="head">
      <div>${venue}<h2 class="title">ใบเสร็จรับเงิน · RECEIPT</h2></div>
      <span class="chip">${escapeHtml(fields.checkedInLabel)}</span>
    </div>
    ${code}
    ${details}
    ${footer}
  </article>`;
}

function cardStyles(settings) {
  const {
    widthMm,
    heightMm,
    marginMm,
    fontScale,
    autoHeight,
    contentGapMm,
    rowGapMm,
    factGapMm,
    factAlign,
    headGapMm,
    headAlign,
  } = settings;

  // แถวหัวใบใช้กติกาเดียวกับตารางข้อมูล: spread = ดันสองฝั่งไปสุดขอบ,
  // close = เกาะกันไว้ทางซ้ายโดยเว้นแค่ headGapMm
  //
  // nowrap สำคัญกว่าที่คิด: flex-wrap: wrap ตัดสินว่าจะขึ้นบรรทัดใหม่จากความ
  // กว้าง "เต็มที่" (max-content) ของแต่ละชิ้นก่อนจะหดใคร ชื่อสนามยาว ๆ บน
  // ใบเล็กจึงดันป้ายสถานะตกบรรทัดทั้งที่จริง ๆ หดชื่อลงมาแล้วยังพอ —
  // บังคับให้อยู่บรรทัดเดียวแล้วปล่อยให้ชื่อตัดบรรทัดในบล็อกตัวเองแทน
  const headRow = `
      display: flex;
      flex-wrap: nowrap;
      align-items: flex-start;
      justify-content: ${headAlign === "close" ? "flex-start" : "space-between"};
      gap: ${headGapMm}mm;`;

  return `
    :root { --scale: ${fontScale}; --ink: #17131f; --muted: #5c5468; --line: #cfc6dd; }
    @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${widthMm}mm;
      font-family: "Sarabun", "Noto Sans Thai", "Leelawadee UI", Tahoma, system-ui, sans-serif;
      color: var(--ink);
      background: #fff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .card {
      width: ${widthMm}mm;
      ${autoHeight ? "" : `height: ${heightMm}mm; overflow: hidden;`}
      padding: ${marginMm}mm;
      background: #fff;
      display: flex;
      flex-direction: column;
      gap: ${contentGapMm}mm;
      break-after: page;
      page-break-after: always;
    }
    .card:last-child { break-after: auto; page-break-after: auto; }
    /* คำยาว ๆ ที่ไม่มีช่องว่างให้ตัด (ชื่อสนามภาษาอังกฤษ, อีเมล, รหัสยาว)
       ต้องยอมหักกลางคำ ไม่งั้นมันดันความกว้างจนล้นออกนอกกรอบใบเสร็จ */
    .venue,
    .title,
    .name,
    .code,
    .fact dd,
    .sum span,
    .foot { overflow-wrap: anywhere; }
    .venue {
      font-size: calc(8pt * var(--scale));
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .title { font-size: calc(9pt * var(--scale)); font-weight: 600; color: var(--muted); }
    .name { font-size: calc(15pt * var(--scale)); line-height: 1.25; }
    .code {
      font-family: "Courier New", monospace;
      font-size: calc(9pt * var(--scale));
      font-weight: 700;
      letter-spacing: 0.06em;
    }
    /* ชื่อสนามยอมหดและตัดบรรทัดในตัวเองได้ (min-width: 0 ปลดล็อกความกว้าง
       ขั้นต่ำอัตโนมัติของ flex item) ป้ายสถานะไม่หดและไม่ตัดคำ — สำคัญกับ
       ใบเล็กที่คอลัมน์ข้อมูลแคบ
       เจาะจงเป็น div/.venue ไม่ใช่ :first-child เพราะถ้าปิดการแสดงชื่อสนาม
       ป้ายสถานะจะกลายเป็นลูกคนแรกแล้วโดนยืดเต็มบรรทัดแทน */
    .head > div,
    .head > .venue { flex: 1 1 auto; min-width: 0; }
    .head > .chip { flex: 0 0 auto; }
    .chip {
      border: 1pt solid var(--ink);
      border-radius: 99px;
      padding: 0.6mm 2mm;
      font-size: calc(7.5pt * var(--scale));
      font-weight: 600;
      /* ป้ายสถานะไม่ตัดบรรทัด (ดูแย่ในกรอบวงรี) — ถ้าใบแคบจนไม่พอจริง ๆ ให้ตัด
         ด้วย … อยู่ในกรอบ ดีกว่ายื่นออกไปโดนขอบกระดาษตัดกลางคำ สถานะเดียวกันนี้
         ยังมีอยู่ในตารางข้อมูลด้านล่างอยู่แล้ว */
      white-space: nowrap;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .facts { display: flex; flex-direction: column; gap: ${rowGapMm}mm; }
    .fact {
      display: flex;
      align-items: baseline;
      gap: ${factGapMm}mm;
      font-size: calc(8.5pt * var(--scale));
      border-bottom: 0.3pt dotted var(--line);
      padding-bottom: 0.8mm;
    }
    .fact dt { color: var(--muted); white-space: nowrap; }
    /* spread = ค่ายืดไปชิดขอบขวาของใบ (ป้ายกับค่าห่างกันสุด), close = ค่าหดมา
       อยู่ติดป้ายโดยเว้นแค่ factGapMm */
    .fact dd {
      flex: ${factAlign === "close" ? "0 1 auto" : "1"};
      text-align: ${factAlign === "close" ? "left" : "right"};
      font-weight: 600;
      word-break: break-word;
    }
    /* บล็อกตัวเงิน — เส้นคั่นหนากว่าตารางข้อมูลด้านบนเพื่อบอกว่า "ต่อจากนี้คือ
       เรื่องเงิน" และยอดสุทธิตัวโตกว่าทุกบรรทัดบนใบ */
    .sums {
      display: flex;
      flex-direction: column;
      gap: ${rowGapMm}mm;
      border-top: 0.8pt solid var(--ink);
      padding-top: 1.5mm;
      font-size: calc(8.5pt * var(--scale));
    }
    .sum { display: flex; justify-content: space-between; gap: ${factGapMm}mm; }
    /* ตัวเลขห้ามตัดบรรทัด — ยอดที่ขึ้นบรรทัดใหม่กลางตัวเลขอ่านผิดเป็นคนละ
       ยอดได้ทันที ให้ป้ายฝั่งซ้ายเป็นฝ่ายหดแทน */
    .sum span:last-child { flex: 0 0 auto; font-weight: 600; white-space: nowrap; }
    .sum--total {
      font-size: calc(11pt * var(--scale));
      font-weight: 700;
      border-top: 0.3pt dotted var(--line);
      padding-top: 1mm;
    }
    .sum--hint { font-size: calc(7pt * var(--scale)); color: var(--muted); }
    .sum--hint span:last-child { font-weight: 600; }
    .foot {
      display: flex;
      flex-direction: column;
      gap: 0.5mm;
      font-size: calc(7pt * var(--scale));
      color: var(--muted);
      border-top: 0.5pt solid var(--line);
      padding-top: 1.2mm;
      /* ดันท้ายใบไปติดขอบล่างของกระดาษที่ตั้งความสูงตายตัวไว้ — ที่ว่างที่
         เหลือจะได้ไปกองอยู่เหนือท้ายใบ ไม่ใช่แทรกกลางเนื้อหา */
      margin-top: auto;
    }

    .card--full .head { ${headRow} }

    .card--slip { text-align: center; }
    .card--slip .title { font-size: calc(11pt * var(--scale)); color: var(--ink); }
    .card--slip .facts,
    .card--slip .sums { text-align: left; }
    .card--slip .foot { align-items: center; text-align: center; }
    .rule { border: none; border-top: 0.5pt dashed var(--ink); }
  `;
}

// เอกสารในใบเสร็จเป็นคนละ document กับหน้าแอป @font-face ของหน้าแอปจึงใช้ไม่ได้
// ต้องประกาศเองซ้ำ — ใช้ URL ชุดเดียวกับใน index.html เป๊ะ ๆ เพื่อให้ชนแคชที่
// เบราว์เซอร์โหลดไว้ตั้งแต่เปิดแอปแล้ว (ไม่ยิงเน็ตใหม่ตอนกดพิมพ์)
// ถ้าโหลดไม่ได้ก็ตกไปฟอนต์ไทยของเครื่อง ยังพิมพ์ได้ตามปกติ
const FONT_LINKS = `<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link
  href="https://fonts.googleapis.com/css2?family=Noto+Serif+Thai:wght@400;600&family=Sarabun:wght@400;600&display=swap"
  rel="stylesheet"
/>`;

// เอกสารเต็มใบที่ทั้งตัวอย่างก่อนพิมพ์และเครื่องพิมพ์ใช้ร่วมกัน — สิ่งที่เห็น
// ในกล่องตัวอย่างคือไฟล์เดียวกับที่ส่งเข้าเครื่องพิมพ์ ไม่มีทางเพี้ยนคนละทาง
export function buildReceiptDocument({ entry, settings, printedAt, copies }) {
  const fields = receiptFields(entry, { printedAt });
  const count = copies ?? settings.copies ?? 1;
  const cards = Array.from({ length: count }, () => renderReceipt(fields, settings)).join("");

  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ใบเสร็จรับเงิน ${escapeHtml(fields.bookingCode)}</title>
${FONT_LINKS}
<style>${cardStyles(settings)}</style>
</head>
<body>${cards}</body>
</html>`;
}

// เผื่อ onload ไม่ยิง (ฟอนต์โหลดค้าง) — ยังต้องพิมพ์ได้อยู่ดี
const PRINT_FALLBACK_MS = 4000;

export function printReceiptDocument(html) {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;pointer-events:none;";

    let printed = false;
    let cleanupTimer = null;

    function cleanup() {
      if (cleanupTimer) clearTimeout(cleanupTimer);
      frame.remove();
      resolve();
    }

    function triggerPrint() {
      if (printed) return;
      printed = true;

      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return;
      }

      // Chrome ยกเลิกงานพิมพ์ถ้า iframe ถูกถอดออกตอนกล่องพิมพ์ยังเปิดอยู่ —
      // รอ afterprint ก่อนค่อยเก็บกวาด และมี timer ยาว ๆ กันกรณีเบราว์เซอร์
      // ไม่ยิง afterprint เลย
      win.addEventListener("afterprint", cleanup, { once: true });
      cleanupTimer = setTimeout(cleanup, 60000);

      win.focus();
      win.print();
    }

    // iframe ยิง load ของ about:blank ตอนถูกแทรกเข้า DOM ด้วย — สั่งพิมพ์ตอนนั้น
    // จะได้กระดาษเปล่า รอจนเห็นใบเสร็จจริงในเอกสารก่อนค่อยพิมพ์
    frame.addEventListener("load", () => {
      const doc = frame.contentDocument;
      if (!doc?.querySelector(".card")) return;

      // load ไม่ได้รอไฟล์ฟอนต์ (แค่รอ stylesheet) — ถ้าพิมพ์เลย ใบแรกจะออกมา
      // ด้วยฟอนต์สำรองแล้วใบถัด ๆ ไปค่อยถูก fonts.ready ปิดช่องนี้
      // (พลาดก็ยังพิมพ์ ไม่ปล่อยให้ค้าง)
      Promise.resolve(doc.fonts?.ready).then(triggerPrint, triggerPrint);
    });
    setTimeout(triggerPrint, PRINT_FALLBACK_MS);

    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
