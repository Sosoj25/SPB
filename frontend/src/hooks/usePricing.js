import { useAsyncData } from "./useAsyncData";
import { fetchFacilityPricingConfig, fetchPriceHistory } from "../lib/pricing";

const EMPTY_CONFIG = { basePrice: null, rules: [], discounts: [] };
const EMPTY_LIST = [];

export function useFacilityPricingConfig(facilityId, reloadKey = 0) {
  const key = facilityId != null ? `facility-pricing:${facilityId}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(
    () => fetchFacilityPricingConfig(facilityId),
    key,
    EMPTY_CONFIG,
  );

  return { config: data, loading, error };
}

export function useFacilityPriceHistory(facilityId, reloadKey = 0) {
  const key = facilityId != null ? `facility-price-history:${facilityId}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(() => fetchPriceHistory(facilityId), key, EMPTY_LIST);

  return { history: data, loading, error };
}
