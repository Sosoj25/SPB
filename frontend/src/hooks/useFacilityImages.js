// แกลเลอรีรูปของสนามหนึ่งสนาม (หน้าจัดการสนามของแอดมิน)
import { useAsyncData } from "./useAsyncData";
import { fetchFacilityImages } from "../lib/facilityImages";

const EMPTY_LIST = [];

export function useFacilityImages(facilityId, reloadKey = 0) {
  const key = facilityId != null ? `facility-images:${facilityId}:${reloadKey}` : null;

  const { data, loading, error } = useAsyncData(() => fetchFacilityImages(facilityId), key, EMPTY_LIST);

  return { images: data, loading, error };
}
