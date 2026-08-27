import { useState } from "react";
import DashboardLayout from "../components/DashboardLayout";
import { Switch } from "../components/DashboardWidgets";
import { usePaymentAccounts, usePaymentChannelSettings } from "../hooks/usePaymentSettings";
import {
  createPaymentAccount,
  deletePaymentAccount,
  setPrimaryPaymentAccount,
  updatePaymentAccount,
  updatePaymentChannelSetting,
} from "../lib/paymentSettings";
import { PAYMENT_METHODS } from "../lib/payments";
import { errorMessage } from "../lib/errors";
import "./AdminPaymentSettings.css";

const EMPTY_FORM = { bankName: "", accountNumber: "", accountName: "" };

function AccountForm({ initial, busy, onCancel, onSubmit, submitLabel }) {
  const [form, setForm] = useState(initial);

  return (
    <div className="payset__account-form">
      <input
        className="dash-input"
        placeholder="ธนาคาร เช่น ธนาคารกสิกรไทย"
        value={form.bankName}
        onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
        autoFocus
      />
      <input
        className="dash-input"
        placeholder="เลขบัญชี"
        value={form.accountNumber}
        onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))}
      />
      <input
        className="dash-input"
        placeholder="ชื่อบัญชี"
        value={form.accountName}
        onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))}
      />
      <div className="payset__account-form-actions">
        <button type="button" className="dash-btn" onClick={onCancel}>
          ยกเลิก
        </button>
        <button
          type="button"
          className="dash-btn dash-btn--add"
          disabled={
            busy || !form.bankName.trim() || !form.accountNumber.trim() || !form.accountName.trim()
          }
          onClick={() => onSubmit(form)}
        >
          {busy ? "กำลังบันทึก..." : submitLabel}
        </button>
      </div>
    </div>
  );
}

export default function AdminPaymentSettings() {
  const [reloadKey, setReloadKey] = useState(0);
  const { accounts, loading: accountsLoading, error: accountsError } = usePaymentAccounts(reloadKey);
  const { channels, loading: channelsLoading } = usePaymentChannelSettings(reloadKey);

  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [channelBusy, setChannelBusy] = useState(null);

  function reload() {
    setReloadKey((k) => k + 1);
  }

  async function handleAdd(form) {
    setBusyId("new");
    setActionError("");
    try {
      await createPaymentAccount(form);
      setAdding(false);
      reload();
    } catch (err) {
      console.error("createPaymentAccount failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleEdit(account, form) {
    setBusyId(account.id);
    setActionError("");
    try {
      await updatePaymentAccount(account.id, form);
      setEditingId(null);
      reload();
    } catch (err) {
      console.error("updatePaymentAccount failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleSetPrimary(account) {
    setBusyId(account.id);
    setActionError("");
    try {
      await setPrimaryPaymentAccount(account.id);
      reload();
    } catch (err) {
      console.error("setPrimaryPaymentAccount failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(account) {
    setBusyId(account.id);
    setActionError("");
    try {
      await deletePaymentAccount(account.id);
      setConfirmDeleteId(null);
      reload();
    } catch (err) {
      console.error("deletePaymentAccount failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  async function handleToggleChannel(method, enabled) {
    setChannelBusy(method);
    setActionError("");
    try {
      await updatePaymentChannelSetting(method, enabled);
      reload();
    } catch (err) {
      console.error("updatePaymentChannelSetting failed:", err);
      setActionError(errorMessage(err));
    } finally {
      setChannelBusy(null);
    }
  }

  return (
    <DashboardLayout
      variant="admin"
      title="ตั้งค่าการรับชำระเงิน"
      subtitle="จัดการบัญชีรับเงินและช่องทางที่ให้ลูกค้าเลือกในหน้าชำระเงิน"
    >
      {actionError && <div className="dash-message dash-message--error">{actionError}</div>}

      <section className="dash-card payset__card">
        <div className="payset__card-header">
          <h2>บัญชีรับเงิน</h2>
          {!adding && (
            <button type="button" className="dash-btn dash-btn--add" onClick={() => setAdding(true)}>
              ＋ เพิ่มบัญชี
            </button>
          )}
        </div>
        <p className="payset__hint">
          ใช้กับช่องทาง &ldquo;โอนผ่านบัญชีธนาคาร&rdquo; — บัญชีหลักคือบัญชีที่แสดงให้ลูกค้าโอนเข้า
        </p>

        {accountsLoading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}
        {!accountsLoading && accountsError && (
          <div className="dash-message dash-message--error">{accountsError}</div>
        )}
        {!accountsLoading && !accountsError && accounts.length === 0 && !adding && (
          <p className="dash-empty">ยังไม่มีบัญชีรับเงิน</p>
        )}

        {!accountsLoading &&
          accounts.map((account) =>
            editingId === account.id ? (
              <AccountForm
                key={account.id}
                initial={{
                  bankName: account.bankName,
                  accountNumber: account.accountNumber,
                  accountName: account.accountName,
                }}
                busy={busyId === account.id}
                submitLabel="บันทึก"
                onCancel={() => setEditingId(null)}
                onSubmit={(form) => handleEdit(account, form)}
              />
            ) : (
              <div className="payset__row" key={account.id}>
                <div className="payset__row-info">
                  <p className="payset__row-title">
                    {account.bankName} · {account.accountNumber}
                    {account.isPrimary && <span className="payset__badge">บัญชีหลัก</span>}
                  </p>
                  <p className="payset__row-sub">ชื่อบัญชี {account.accountName}</p>
                </div>

                {confirmDeleteId === account.id ? (
                  <div className="payset__confirm">
                    <span>ลบบัญชีนี้?</span>
                    <button type="button" className="dash-btn" onClick={() => setConfirmDeleteId(null)}>
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      disabled={busyId === account.id}
                      onClick={() => handleDelete(account)}
                    >
                      ยืนยัน
                    </button>
                  </div>
                ) : (
                  <div className="dash-actions">
                    {!account.isPrimary && (
                      <button
                        type="button"
                        className="dash-btn"
                        disabled={busyId === account.id}
                        onClick={() => handleSetPrimary(account)}
                      >
                        ตั้งเป็นบัญชีหลัก
                      </button>
                    )}
                    <button type="button" className="dash-btn" onClick={() => setEditingId(account.id)}>
                      แก้ไข
                    </button>
                    <button
                      type="button"
                      className="dash-btn dash-btn--cancel"
                      onClick={() => setConfirmDeleteId(account.id)}
                    >
                      ลบ
                    </button>
                  </div>
                )}
              </div>
            ),
          )}

        {adding && (
          <AccountForm
            initial={EMPTY_FORM}
            busy={busyId === "new"}
            submitLabel="เพิ่ม"
            onCancel={() => setAdding(false)}
            onSubmit={handleAdd}
          />
        )}
      </section>

      <section className="dash-card payset__card">
        <h2>ช่องทางรับชำระเงิน</h2>
        <p className="payset__hint">เปิด-ปิดช่องทางที่ให้ลูกค้าเลือกในหน้าชำระเงิน</p>

        {channelsLoading && <p className="dash-empty">กำลังโหลดข้อมูล...</p>}

        {!channelsLoading &&
          PAYMENT_METHODS.map((item) => (
            <div className="payset__channel-row" key={item.key}>
              <div className="payset__row-info">
                <p className="payset__row-title">{item.title}</p>
                <p className="payset__row-sub">{item.desc}</p>
              </div>
              <Switch
                on={channels[item.key] ?? false}
                disabled={channelBusy === item.key}
                onChange={(v) => handleToggleChannel(item.key, v)}
                label={`เปิด/ปิด ${item.title}`}
              />
            </div>
          ))}
      </section>
    </DashboardLayout>
  );
}
