// แยก context object ออกจาก AuthProvider เพราะกฎ react-refresh ห้ามไฟล์เดียว
// export ทั้ง component และค่าอื่น (ไม่งั้น hot reload จะรีเซ็ต state ทิ้ง)
import { createContext } from "react";

export const AuthContext = createContext(null);
