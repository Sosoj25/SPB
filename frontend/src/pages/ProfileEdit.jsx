// หน้าแก้ไขโปรไฟล์ — ข้อมูลส่วนตัว กีฬาที่เล่น และรูปโปรไฟล์
import { useRef, useState } from "react";
import { User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import FormField from "../components/FormField";
import { useAuth } from "../context/useAuth";
import { useAsyncData } from "../hooks/useAsyncData";
import { fetchSportNames } from "../lib/catalog";
import { supabase } from "../lib/supabase";
import { bgField } from "../assets/images";
import "./Profile.css";

const EMPTY_SPORTS = [];

export default function ProfileEdit() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const coverInputRef = useRef(null);

  const { data: sportOptions } = useAsyncData(fetchSportNames, "profile-edit-sports", EMPTY_SPORTS);

  const [form, setForm] = useState({
    full_name: profile?.full_name || "",
    username: profile?.username || "",
    phone: profile?.phone || "",
    bio: profile?.bio || "",
    area: profile?.area || "",
    home_venue: profile?.home_venue || "",
    available_time: profile?.available_time || "",
  });

  const [sports, setSports] = useState(profile?.sports || []);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || "");
  const [coverFile, setCoverFile] = useState(null);
  const [coverPreview, setCoverPreview] = useState(profile?.cover_url || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggleSport = (name) => {
    setSports((current) =>
      current.includes(name) ? current.filter((s) => s !== name) : [...current, name],
    );
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    const nextValue = name === "phone" ? value.replace(/\D/g, "").slice(0, 10) : value;
    setForm({
      ...form,
      [name]: nextValue,
    });
    setError("");
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const handleCoverChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (form.phone && form.phone.length !== 10) {
      setError("เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก");
      return;
    }

    try {
      setLoading(true);

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

      let coverUrl = profile?.cover_url || null;

      if (coverFile) {
        const ext = coverFile.name.split(".").pop();
        const path = `${user.id}/cover.${ext}`;

        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, coverFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage
          .from("avatars")
          .getPublicUrl(path);

        coverUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name.trim(),
          phone: form.phone.trim() || null,
          bio: form.bio.trim() || null,
          area: form.area.trim() || null,
          home_venue: form.home_venue.trim() || null,
          available_time: form.available_time.trim() || null,
          sports,
          avatar_url: avatarUrl,
          cover_url: coverUrl,
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
      setError(err.message || "เกิดข้อผิดพลาดในการบันทึกข้อมูล");
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
                <div className="profile-cover-upload">
                  <div
                    className="profile-cover-upload__preview"
                    style={coverPreview ? { backgroundImage: `url(${coverPreview})` } : undefined}
                  >
                    {!coverPreview && (
                      <span className="profile-cover-upload__placeholder">
                        ยังไม่ได้ตั้งค่าภาพปกโปรไฟล์
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="profile-btn profile-btn--outline"
                    onClick={() => coverInputRef.current?.click()}
                  >
                    เปลี่ยนภาพปกโปรไฟล์
                  </button>
                  <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="profile-avatar-upload__input"
                    onChange={handleCoverChange}
                  />
                </div>

                <div className="profile-avatar-upload">
                  <div className="profile__avatar profile__avatar--edit" aria-hidden="true">
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="" className="profile__avatar-img" />
                    ) : (
                      <User size={52} strokeWidth={1.5} />
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
                    readOnly
                    lockedHint="เปลี่ยนชื่อผู้ใช้ไม่ได้"
                  />
                  <FormField
                    label="เบอร์โทรศัพท์"
                    name="phone"
                    type="tel"
                    inputMode="numeric"
                    maxLength={10}
                    value={form.phone}
                    onChange={handleChange}
                  />
                  <FormField
                    label="อีเมล"
                    name="email"
                    value={user?.email || ""}
                    readOnly
                    lockedHint="เปลี่ยนอีเมลไม่ได้"
                  />
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

                <div className="profile-field">
                  <span className="profile-field__label">กีฬาที่เล่น</span>
                  <div className="profile-sport-picker">
                    {sportOptions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={`profile-sport-chip ${
                          sports.includes(name) ? "profile-sport-chip--active" : ""
                        }`}
                        onClick={() => toggleSport(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="profile-fields">
                  <FormField
                    label="พื้นที่"
                    name="area"
                    placeholder="เช่น บางนา, กรุงเทพฯ"
                    value={form.area}
                    onChange={handleChange}
                  />
                  <FormField
                    label="สนามประจำ"
                    name="home_venue"
                    placeholder="เช่น สนามกีฬามหาวิทยาลัย"
                    value={form.home_venue}
                    onChange={handleChange}
                  />
                  <FormField
                    label="เวลาที่สะดวก"
                    name="available_time"
                    placeholder="เช่น เย็นวันธรรมดา, เสาร์-อาทิตย์"
                    value={form.available_time}
                    onChange={handleChange}
                  />
                </div>

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
