// ช่องกรอกข้อมูลพร้อมป้ายกำกับ — readOnly ใช้กับค่าที่ระบบล็อกไว้ไม่ให้แก้
import "./FormField.css";

export default function FormField({
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  name,
  readOnly = false,
  lockedHint,
  inputMode,
  maxLength,
  pattern,
}) {
  return (
    <label className="form-field">
      <span className="form-field__label">
        {label}
        {readOnly && (
          <span className="form-field__lock">🔒 {lockedHint || "แก้ไขไม่ได้"}</span>
        )}
      </span>
      <input
        className={`form-field__input ${readOnly ? "form-field__input--readonly" : ""}`}
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        inputMode={inputMode}
        maxLength={maxLength}
        pattern={pattern}
      />
    </label>
  );
}
