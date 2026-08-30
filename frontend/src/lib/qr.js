import QRCode from "qrcode";

// สีเดียวกับ --color-heading/#fff ของธีมแอป — ใช้ตรง ๆ แทนอ่านจาก CSS
// variable เพราะ QRCode.toDataURL รันตอน render ก่อนที่จะมี DOM ให้ getComputedStyle
export async function generateQrDataUrl(text, options = {}) {
  return QRCode.toDataURL(text, {
    margin: 1,
    width: 260,
    color: { dark: "#4d337d", light: "#ffffff" },
    ...options,
  });
}
