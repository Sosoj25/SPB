// บัญชีรับเงินและสวิตช์เปิด/ปิดช่องทางชำระเงินที่แอดมินตั้งไว้
import { useAsyncData } from "./useAsyncData";
import { fetchPaymentAccounts, fetchPaymentChannelSettings } from "../lib/paymentSettings";

const EMPTY_ACCOUNTS = [];
const EMPTY_CHANNELS = {};

export function usePaymentAccounts(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchPaymentAccounts,
    `payment-accounts:${reloadKey}`,
    EMPTY_ACCOUNTS,
  );

  return { accounts: data, loading, error };
}

export function usePaymentChannelSettings(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchPaymentChannelSettings,
    `payment-channel-settings:${reloadKey}`,
    EMPTY_CHANNELS,
  );

  return { channels: data, loading, error };
}
