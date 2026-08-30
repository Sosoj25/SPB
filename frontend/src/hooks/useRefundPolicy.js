import { useAsyncData } from "./useAsyncData";
import { fetchRefundPolicy } from "../lib/refundPolicy";

export function useRefundPolicy(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchRefundPolicy,
    `refund-policy:${reloadKey}`,
  );

  return { policy: data, loading, error };
}
