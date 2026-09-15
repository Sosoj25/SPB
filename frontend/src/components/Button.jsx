// ปุ่มมาตรฐานของแอป — variant กำหนดสี/สไตล์ (ดู Button.css)
import "./Button.css";

export default function Button({ children, variant = "primary", onClick, type = "button", fullWidth = true, disabled = false }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`btn btn--${variant} ${fullWidth ? "btn--full" : ""}`}
    >
      {children}
    </button>
  );
}
