// ทางเดียวที่ทั้งแอปใช้อ่านผู้ใช้/โปรไฟล์ที่ล็อกอินอยู่
import { useContext } from "react";
import { AuthContext } from "./auth-context";

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth ต้องใช้ภายใน AuthProvider"
    );
  }

  return context;
}
