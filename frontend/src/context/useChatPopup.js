// ให้ปุ่มแชทที่อยู่คนละที่ในต้นไม้ component สั่งเปิดห้องใน ChatDock ได้
import { useContext } from "react";
import { ChatPopupContext } from "./chat-popup-context";

export function useChatPopup() {
  const context = useContext(ChatPopupContext);

  if (!context) {
    throw new Error("useChatPopup ต้องใช้ภายใน ChatPopupProvider");
  }

  return context;
}
