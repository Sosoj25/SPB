// เสียงเตือนตอนมีข้อความใหม่หรือมีการแจ้งเตือนเข้ามา — ผู้ใช้ส่วนใหญ่เปิดแท็บ
// ทิ้งไว้แล้วไปทำอย่างอื่น ป้ายตัวเลขบนกระดิ่ง/ปุ่มแชทจึงไม่มีใครเห็นจนกว่าจะ
// กลับมาที่จอ เสียงเป็นช่องทางเดียวที่ทำงานตอนไม่ได้จ้องจออยู่
//
// สังเคราะห์เสียงเองด้วย Web Audio แบบเดียวกับ playFeedbackTone ใน feedback.js
// แทนที่จะโหลดไฟล์ mp3 — เสียงสองสามโน้ตสั้น ๆ ไม่คุ้มที่จะเพิ่มไฟล์เสียงเข้า
// ก้อนโปรเจกต์แล้วต้องรอโหลดก่อนถึงจะดังครั้งแรกได้
//
// ต่างจาก feedback.js ตรงที่ตัวนี้ดังเองโดยที่ผู้ใช้ไม่ได้กดอะไร จึงต้องมี
// สวิตช์ปิด (เก็บใน localStorage) และต้องจัดการ AudioContext ให้ดีกว่านั้น
// ด้วย — ดูเหตุผลของ context ตัวเดียวและ primeAlertSound() ข้างล่าง

const STORAGE_KEY = "sportsbooking:alert-sound";

// โน้ตของเสียงแต่ละแบบ (ความถี่เป็น Hz, เวลาเริ่มเป็นวินาทีนับจากตอนเล่น) —
// ข้อความเป็นคู่เสียงสูงขึ้นแบบ "ติ๊ง-ติ๊ง" ของแอปแชท ส่วนแจ้งเตือนทั่วไปใช้
// คู่เสียงต่ำลงที่ทุ้มกว่า ให้แยกออกด้วยหูว่ามีอะไรเข้ามาโดยไม่ต้องมองจอ
const TONES = {
  message: [
    { freq: 880, at: 0 },
    { freq: 1318.51, at: 0.09 },
  ],
  notification: [
    { freq: 659.25, at: 0 },
    { freq: 493.88, at: 0.12 },
  ],
};

const NOTE_DURATION = 0.18;
const PEAK_GAIN = 0.12;

// ข้อความรัว ๆ ในห้องกลุ่มมาถึงทีละหลายแถวติดกัน ถ้าดังทุกแถวจะกลายเป็นเสียง
// รัวจนน่ารำคาญและกลบความหมายของตัวเองทิ้ง — ดังครั้งเดียวต่อช่วงนี้พอ
const THROTTLE_MS = 1500;

let context = null;
let lastPlayedAt = 0;

export function isAlertSoundOn() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    // โหมดส่วนตัว/บล็อกคุกกี้ — ถือว่าเปิดไว้ตามค่าเริ่มต้น
    return true;
  }
}

export function setAlertSoundOn(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // เก็บค่าไม่ได้ก็ยังให้เปิด/ปิดได้ในรอบนี้ แค่ไม่ถูกจำข้ามการโหลดหน้า
  }
}

function audioContext() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;

  // ใช้ context ตัวเดียวตลอดอายุหน้า ไม่สร้างใหม่ทุกครั้งแบบ playFeedbackTone
  // — เบราว์เซอร์จำกัดจำนวน AudioContext ต่อแท็บไว้ (Chrome ~6 ตัว) ซึ่งเสียง
  // ที่ดังเองทุกครั้งที่มีข้อความเข้าชนเพดานนั้นได้จริงถ้าเผลอปล่อยให้รั่ว
  if (!context) context = new AudioCtx();
  return context;
}

// เบราว์เซอร์สร้าง AudioContext มาในสถานะ suspended จนกว่าผู้ใช้จะแตะหน้าเว็บ
// สักครั้ง (นโยบายกัน autoplay) — ถ้ารอไปปลดตอนข้อความเข้าจริงจะสายไป เสียง
// แรกจะเงียบหายทั้งที่ resume() สำเร็จทีหลัง จึงปลดล็อกตั้งแต่การแตะครั้งแรก
// ที่ผู้ใช้ทำกับหน้าเว็บ แล้วถอด listener ทิ้ง (once) เพราะครั้งเดียวก็พอ
export function primeAlertSound() {
  const unlock = () => {
    const ctx = audioContext();
    if (ctx?.state === "suspended") ctx.resume().catch(() => {});
  };

  const options = { once: true, passive: true };
  document.addEventListener("pointerdown", unlock, options);
  document.addEventListener("keydown", unlock, options);

  return () => {
    document.removeEventListener("pointerdown", unlock, options);
    document.removeEventListener("keydown", unlock, options);
  };
}

// force ข้ามตัวกันเสียงรัวไว้ให้ปุ่มเปิด/ปิดเสียงเล่นตัวอย่างให้ฟังได้ทันทีตอน
// กดเปิด — เป็นเสียงที่ผู้ใช้สั่งเอง ไม่ใช่เสียงที่โผล่มาเองจึงไม่ต้องคุมความถี่
// (และจังหวะกดนั้นยังเป็น gesture ที่ปลดล็อก AudioContext ให้ในตัว)
export function playAlertSound(kind = "notification", { force = false } = {}) {
  if (!isAlertSoundOn()) return;

  const now = Date.now();
  if (!force && now - lastPlayedAt < THROTTLE_MS) return;

  try {
    const ctx = audioContext();
    if (!ctx) return;

    // แท็บที่ถูกซ่อนไว้นาน ๆ เบราว์เซอร์อาจพัก context เอง — ปลุกก่อนเล่น
    // (ไม่ await เพราะโน้ตถูกจองเวลาไว้ล่วงหน้าอยู่แล้ว ดู startAt ข้างล่าง)
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const notes = TONES[kind] ?? TONES.notification;

    notes.forEach((note) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = note.freq;

      // ไต่ขึ้นเร็ว ๆ แล้วค่อย ๆ จางลงแทนที่จะเปิด/ปิด gain ตรง ๆ — คลื่นที่ถูก
      // ตัดกลางคันดังเป็นเสียง "แคร็ก" ที่หูได้ยินชัดกว่าตัวโน้ตเสียอีก
      const startAt = ctx.currentTime + note.at;
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + NOTE_DURATION);

      osc.start(startAt);
      osc.stop(startAt + NOTE_DURATION);
    });

    lastPlayedAt = now;
  } catch {
    // เบราว์เซอร์/โหมดที่ไม่รองรับ Web Audio — ไม่ใช่ฟีเจอร์หลัก ปล่อยเงียบไปได้
  }
}
