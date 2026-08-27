import { useAsyncData } from "./useAsyncData";
import { fetchAdminAmenities, fetchFacilitiesPageSettings, fetchPublicAmenities } from "../lib/amenities";

export function usePublicAmenities() {
  const { data, loading, error } = useAsyncData(fetchPublicAmenities, "public-amenities", []);
  return { amenities: data, loading, error };
}

export function useAdminAmenities(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchAdminAmenities,
    `admin-amenities:${reloadKey}`,
    [],
  );

  return { amenities: data, loading, error };
}

export function useFacilitiesPageSettings(reloadKey = 0) {
  const { data, loading, error } = useAsyncData(
    fetchFacilitiesPageSettings,
    `facilities-page-settings:${reloadKey}`,
  );

  return { settings: data, loading, error };
}
