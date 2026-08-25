import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import FormField from "../components/FormField";
import { useAuth } from "../context/useAuth";
import { supabase } from "../lib/supabase";
import { bgField } from "../assets/images";
import "./Profile.css";

export default function ProfileEdit() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

  const [form, setForm] = useState({
    full_name: profile?.full_name || "",
    username: profile?.username || "",
    phone: profile?.phone || "",
    bio: profile?.bio || "",
  });

  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
    setError("");
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.username.trim()) {
      setError("กรุณากรอกชื่อผู้ใช้");
      return;
    }

    const trimmedUsername = form.username.trim();
    const usernameChanged =
      trimmedUsername.toLowerCase() !== (profile?.username || "").toLowerCase();

    try {
      setLoading(true);

      // เช็คชื่อซ้ำก่อน เหมือน Register.jsx ไม่งั้นถ้าชนจะเจอ
      // "duplicate key value violates unique constraint" ดิบๆ จาก Postgres
      if (usernameChanged) {
        const { data: usernameAvailable, error: usernameError } =
          await supabase.rpc("is_username_available", {
            p_username: trimmedUsername,
          });

        if (usernameError) {
          console.error("Username availability check error:", usernameError);
        } else if (usernameAvailable === false) {
          setError("ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว กรุณาเลือกชื่ออื่น");
          setLoading(false);
          return;
        }
      }

      let avatarUrl = profile?.avatar_url || null;

      if (avatarFile) {
        const ext = avatarFile.name.split(".").pop();
        const path = `${user.id}/avatar.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(path);

        // กัน CDN/บราวเซอร์ cache รูปเดิมไว้เพราะ path เดิมถูก upsert ทับ
        avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim(),
          username: trimmedUsername,
          phone: form.phone.trim() || null,
          bio: form.bio.trim() || null,
          avatar_url: avatarUrl,
        })
        .eq("id", user.id);

      if (updateError) throw updateError;

      await refreshProfile();

      navigate("/profile", {
        replace: true,
        state: { message: "บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว" },
      });
    } catch (err) {
      console.error("Update profile error:", err);

      // เผื่อสองคนตั้งชื่อชนกันพอดีในช่วงเสี้ยววินาทีระหว่างเช็คกับบันทึกจริง
      const message =
        err.code === "23505"
          ? "ชื่อผู้ใช้นี้ถูกใช้ไปแล้ว กรุณาเลือกชื่ออื่น"
          : err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล";

      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="profile" style={{ backgroundImage: `url(${bgField})` }}>
      <AppHeader />

      <main className="profile__main">
        <div className="profile__layout profile__layout--single">
          <div className="profile__content">
            <section className="profile-card">
              <div className="profile-card__header">
                <h2 className="profile-card__title">แก้ไขโปรไฟล์</h2>
              </div>

              {error && (
                <div className="profile-message profile-message--error">{error}</div>
              )}

              <form onSubmit={handleSubmit} className="profile-edit-form">
                <div className="profile-avatar-upload">
                  <div className="profile__avatar profile__avatar--edit" aria-hidden="true">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="profile__avatar-img" />
                    ) : (
                      "👤"
                    )}
                  </div>
                  <button
                    type="button"
                    className="profile-btn profile-btn--outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    เปลี่ยนรูปโปรไฟล์
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="profile-avatar-upload__input"
                    onChange={handleAvatarChange}
                  />
                </div>

                <div className="profile-fields">
                  <FormField
                    label="ชื่อ-นามสกุล"
                    name="full_name"
                    value={form.full_name}
                    onChange={handleChange}
                  />
                  <FormField
                    label="ชื่อผู้ใช้"
                    name="username"
                    value={form.username}
                    onChange={handleChange}
                  />
                  <FormField
                    label="เบอร์โทรศัพท์"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                  />
                  <FormField label="อีเมล" name="email" value={user?.email || ""} readOnly />
                </div>

                <label className="profile-field">
                  <span className="profile-field__label">เกี่ยวกับฉัน</span>
                  <textarea
                    name="bio"
                    className="profile-field__input profile-field__textarea"
                    value={form.bio}
                    onChange={handleChange}
                    rows={4}
                  />
                </label>

                <div className="profile-card__actions">
                  <button
                    type="button"
                    className="profile-btn profile-btn--outline"
                    onClick={() => navigate("/profile")}
                  >
                    ยกเลิก
                  </button>
                  <button type="submit" className="profile-btn profile-btn--primary" disabled={loading}>
                    {loading ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
