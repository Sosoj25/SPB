// จุดเริ่มของแอป — ครอบ AuthProvider ไว้นอกสุดเพราะทุกหน้าต้องรู้ว่าใครล็อกอินอยู่
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { AuthProvider } from "./context/AuthContext";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>
);