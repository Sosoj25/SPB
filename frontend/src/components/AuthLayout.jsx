import { bgField } from "../assets/images";
import AuthHeader from "./AuthHeader";
import "./AuthLayout.css";

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div className="auth-layout" style={{ backgroundImage: `url(${bgField})` }}>
      <AuthHeader />
      <main className="auth-layout__main">
        <div className="auth-card">
          <h1 className="auth-card__title">{title}</h1>
          {subtitle && <p className="auth-card__subtitle">{subtitle}</p>}
          {children}
          {footer && <p className="auth-card__footer">{footer}</p>}
        </div>
      </main>
    </div>
  );
}
