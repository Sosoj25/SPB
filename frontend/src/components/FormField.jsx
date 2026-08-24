import "./FormField.css";

export default function FormField({ label, type = "text", value, onChange, placeholder, name, readOnly = false }) {
  return (
    <label className="form-field">
      <span className="form-field__label">{label}</span>
      <input
        className="form-field__input"
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
      />
    </label>
  );
}
