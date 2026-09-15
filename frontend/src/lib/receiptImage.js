// ใบเสร็จฉบับ "บันทึกเก็บไว้" ของฝั่งลูกค้า — วาดเป็นรูป PNG แล้วให้ดาวน์โหลด
//
// หน้าใบเสร็จสั่งพิมพ์เองไม่ได้แล้ว (ดู Booking.css: @media print ตัดเนื้อหา
// ทั้งหน้าทิ้ง) กระดาษจริงออกจากเครื่องพิมพ์ที่เคาน์เตอร์ตอนเช็คอินที่เดียว
// (lib/receiptPrint.js) ลูกค้าจึงต้องมีอะไรเก็บไว้แทน — ไฟล์รูปเหมาะกว่าไฟล์อื่น
// เพราะเซฟลงคลังภาพในมือถือได้ตรง ๆ ส่งต่อในแชตได้ และเปิดดูได้ทุกเครื่อง
// โดยไม่ต้องมีแอปอ่าน PDF
//
// วาดด้วย canvas 2D ล้วน ไม่พึ่งไลบรารีนอก — ทั้งโปรเจกต์มี dependency แค่
// supabase / react / router / qrcode เพิ่ม html2canvas หรือ jsPDF เข้ามาเพื่อ
// ใบเสร็จใบเดียวไม่คุ้มกับขนาดบันเดิลที่ลูกค้าทุกคนต้องโหลด

const WIDTH = 640;
const PADDING = 44;
const CONTENT_WIDTH = WIDTH - PADDING * 2;

// ความละเอียด 2 เท่าของขนาดที่วาด — เปิดดูเต็มจอบนมือถือความหนาแน่นสูงแล้ว
// ตัวหนังสือยังคม ไม่เบลอเป็นขั้นบันได
const SCALE = 2;

const INK = "#17131f";
const MUTED = "#5c5468";
const LINE = "#d9d2e6";
const SUCCESS = "#1f7a4d";
const WARNING = "#8a5a12";

const FAMILY = '"Sarabun", "Noto Sans Thai", "Leelawadee UI", Tahoma, system-ui, sans-serif';
const font = (size, weight = 400) => `${weight} ${size}px ${FAMILY}`;

// ภาษาไทยไม่มีช่องว่างคั่นคำ ตัดตามช่องว่างอย่างเดียวจึงได้ก้อนยาวก้อนเดียว
// ที่ล้นออกนอกกรอบ — ก้อนไหนยาวเกินก็ยอมตัดกลางทีละตัวอักษรแทน
function wrapText(ctx, value, maxWidth) {
  const chunks = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";

  const pushCurrent = () => {
    if (current) lines.push(current);
    current = "";
  };

  for (const chunk of chunks) {
    const candidate = current ? `${current} ${chunk}` : chunk;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    pushCurrent();

    if (ctx.measureText(chunk).width <= maxWidth) {
      current = chunk;
      continue;
    }

    for (const char of chunk) {
      const grown = current + char;
      if (current && ctx.measureText(grown).width > maxWidth) {
        lines.push(current);
        current = char;
      } else {
        current = grown;
      }
    }
  }

  pushCurrent();
  return lines.length > 0 ? lines : [""];
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// วาดกับวัดใช้โค้ดชุดเดียวกัน ต่างแค่ธง draw — ความสูงของรูปจึงมาจากการ
// "ลองวาดดูก่อน" ไม่ใช่การเดาแล้วเหลือขอบว่างท้ายใบหรือตัดเนื้อหาทิ้ง
//
// ทุกฟังก์ชันวาดรับพิกัด y มาตรง ๆ (เป็นเส้นฐานของข้อความ) ไม่ใช่ไปขยับ
// ตัวแปรร่วมกันเอง — ป้าย/ค่าในแถวเดียวกันต้องวาดที่เส้นฐานเดียวกันทั้งที่
// จำนวนบรรทัดไม่เท่ากันได้
function paint(ctx, doc, qrImage, draw) {
  const write = (
    value,
    baseline,
    { x = PADDING, size = 15, weight = 400, color = INK, align = "left" } = {},
  ) => {
    if (!draw) return;
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(value, x, baseline);
  };

  const rule = (top, dashed = false) => {
    if (!draw) return;
    ctx.save();
    ctx.strokeStyle = LINE;
    ctx.lineWidth = 1;
    if (dashed) ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(PADDING, top + 0.5);
    ctx.lineTo(WIDTH - PADDING, top + 0.5);
    ctx.stroke();
    ctx.restore();
  };

  let y = PADDING;

  // ---------- หัวใบเสร็จ ----------
  if (doc.venueName) {
    y += 14;
    write(doc.venueName, y, { size: 13, weight: 600, color: MUTED });
    y += 26;
  }

  y += 27;
  write(doc.title, y, { size: 27, weight: 600 });
  y += 26;
  write(`เลขที่ ${doc.code}`, y, { size: 15, color: MUTED });
  y += 18;

  if (doc.statusLabel) {
    const chipHeight = 30;
    if (draw) {
      ctx.font = font(14, 600);
      const chipWidth = ctx.measureText(doc.statusLabel).width + 30;
      const success = doc.statusTone === "success";
      ctx.fillStyle = success ? "#e7f6ee" : "#fdf3e2";
      roundRect(ctx, PADDING, y, chipWidth, chipHeight, chipHeight / 2);
      ctx.fill();
      ctx.fillStyle = success ? SUCCESS : WARNING;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(doc.statusLabel, PADDING + 15, y + 20);
    }
    y += chipHeight + 22;
  }

  rule(y);
  y += 26;

  // ---------- รายละเอียดการจอง ----------
  // ป้ายกินความกว้างไม่เกิน 40% ค่ายาว ๆ (ที่อยู่สนาม) จะได้มีที่ตัดบรรทัด
  // ของตัวเองโดยไม่เบียดทับป้าย
  const ROW_LINE = 21;
  for (const [label, value] of doc.rows) {
    ctx.font = font(14.5);
    const labelLines = wrapText(ctx, label, CONTENT_WIDTH * 0.4);
    ctx.font = font(14.5, 600);
    const valueLines = wrapText(ctx, value, CONTENT_WIDTH * 0.56);
    const baseline = y + 15;

    labelLines.forEach((line, i) =>
      write(line, baseline + i * ROW_LINE, { size: 14.5, color: MUTED }),
    );
    valueLines.forEach((line, i) =>
      write(line, baseline + i * ROW_LINE, {
        x: WIDTH - PADDING,
        size: 14.5,
        weight: 600,
        align: "right",
      }),
    );

    y = baseline + (Math.max(labelLines.length, valueLines.length) - 1) * ROW_LINE + 10;
  }

  // ---------- ตัวเงิน ----------
  if (doc.sums.length > 0) {
    y += 10;
    rule(y, true);
    y += 8;
  }

  for (const sum of doc.sums) {
    const isTotal = sum.kind === "total";
    const isHint = sum.kind === "hint";
    const size = isTotal ? 17 : isHint ? 12.5 : 14.5;
    const lineHeight = size + 8;

    // ยอดสุทธิมีเส้นคั่นของตัวเอง — บรรทัดที่ลูกค้ากวาดตาหาก่อนเสมอ ต้องแยก
    // ออกจากบรรทัดที่มาประกอบกันเป็นยอดนั้น
    if (isTotal) {
      y += 10;
      rule(y);
      y += 14;
    }

    ctx.font = font(size, isTotal ? 700 : 400);
    const labelLines = wrapText(ctx, sum.label, CONTENT_WIDTH * 0.62);
    const baseline = y + size;

    labelLines.forEach((line, i) =>
      write(line, baseline + i * lineHeight, {
        size,
        weight: isTotal ? 700 : 400,
        color: isTotal ? INK : MUTED,
      }),
    );

    write(sum.value, baseline, {
      x: WIDTH - PADDING,
      size: isTotal ? 20 : size,
      weight: isTotal ? 700 : 600,
      color: sum.kind === "discount" ? SUCCESS : isHint ? MUTED : INK,
      align: "right",
    });

    y = baseline + (labelLines.length - 1) * lineHeight + 12;
  }

  // ---------- QR เช็คอิน ----------
  if (qrImage) {
    const QR_SIZE = 180;
    y += 14;
    rule(y, true);
    y += 26;

    if (draw) ctx.drawImage(qrImage, (WIDTH - QR_SIZE) / 2, y, QR_SIZE, QR_SIZE);
    y += QR_SIZE + 26;

    write(doc.code, y, { x: WIDTH / 2, size: 19, weight: 600, align: "center" });
    y += 8;

    if (doc.qrCaption) {
      ctx.font = font(13);
      const lines = wrapText(ctx, doc.qrCaption, CONTENT_WIDTH * 0.9);
      lines.forEach((line, i) =>
        write(line, y + 13 + i * 19, { x: WIDTH / 2, size: 13, color: MUTED, align: "center" }),
      );
      y += 13 + (lines.length - 1) * 19;
    }
  }

  // ---------- ท้ายใบ ----------
  y += 18;
  rule(y);
  y += 8;

  for (const note of doc.notes ?? []) {
    ctx.font = font(12.5);
    const lines = wrapText(ctx, note, CONTENT_WIDTH);
    lines.forEach((line, i) =>
      write(line, y + 13 + i * 18, { x: WIDTH / 2, size: 12.5, color: MUTED, align: "center" }),
    );
    y += 13 + (lines.length - 1) * 18 + 8;
  }

  return y + PADDING - 8;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("โหลดรูป QR ไม่สำเร็จ"));
    image.src = src;
  });
}

export async function renderReceiptPng(doc) {
  // ฟอนต์ไทยของแอปโหลดจาก Google Fonts — ถ้าวาดก่อนไฟล์ฟอนต์มาถึง canvas จะ
  // ใช้ฟอนต์สำรองของเครื่อง ซึ่งความกว้างตัวอักษรคนละค่ากับที่วัดไว้ ใบเสร็จ
  // จะออกมาบรรทัดเบียดกันหรือมีที่ว่างเหลือแปลก ๆ
  try {
    await document.fonts?.ready;
  } catch {
    // ฟอนต์โหลดไม่ได้ก็ยังต้องได้ไฟล์ ใช้ฟอนต์สำรองไปตามสภาพ
  }

  const qrImage = doc.qrDataUrl ? await loadImage(doc.qrDataUrl) : null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  // รอบแรกวัดความสูงอย่างเดียว (ต้องมี ctx ที่ตั้งฟอนต์ไว้แล้วถึงจะวัดข้อความ
  // ได้) รอบสองค่อยวาดจริงบนผืนผ้าใบที่สูงพอดี — การเปลี่ยนขนาด canvas ล้าง
  // ทรานส์ฟอร์มทิ้ง จึงต้อง scale ใหม่ทุกครั้ง
  canvas.width = WIDTH * SCALE;
  canvas.height = SCALE;
  ctx.scale(SCALE, SCALE);
  const height = Math.ceil(paint(ctx, doc, qrImage, false));

  canvas.width = WIDTH * SCALE;
  canvas.height = height * SCALE;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);
  paint(ctx, doc, qrImage, true);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("สร้างไฟล์ใบเสร็จไม่สำเร็จ"))),
      "image/png",
    );
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  // ต้องอยู่ใน DOM จริงตอนคลิก — Safari ไม่ยิงดาวน์โหลดให้กับ <a> ลอย ๆ
  document.body.appendChild(link);
  link.click();
  link.remove();

  // ปล่อย URL ทิ้งทันทีเร็วเกินไป เบราว์เซอร์บางตัวยังอ่านไฟล์ไม่เสร็จ
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
