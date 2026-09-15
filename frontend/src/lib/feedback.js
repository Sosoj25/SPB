// เสียงตอบรับสั้น ๆ ตอนสแกน/ยืนยันสำเร็จหรือไม่สำเร็จ — ใช้ร่วมกันทั้งหน้า
// เช็คอิน (AdminCheckin) และหน้าสแกนรับของรางวัล (AdminRewardScan) เพราะ
// เจ้าหน้าที่หน้าเคาน์เตอร์มักไม่ได้จ้องจอตลอด ต้องพึ่งเสียงบอกผลแทน
export function playFeedbackTone(ok) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = ok ? 880 : 220;
    gain.gain.value = 0.2;

    const duration = ok ? 0.12 : 0.28;
    osc.start();
    osc.stop(ctx.currentTime + duration);
    osc.onended = () => ctx.close();
  } catch {
    // เบราว์เซอร์/โหมดที่ไม่รองรับ Web Audio — ไม่ใช่ฟีเจอร์หลัก ปล่อยเงียบไปได้
  }
}
