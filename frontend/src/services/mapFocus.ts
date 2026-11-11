/**
 * Xaritani berilgan nuqtaga "teleport" qilish va diqqatni tortish (miltillovchi qizil halqa).
 * Xarita hali ochilmagan bo'lsa, so'rov saqlanib qoladi va xarita ochilganda bajariladi.
 */
export interface MapFocusRequest {
  lat: number;
  lon: number;
  label?: string;
  /** true: qizil "diqqat" halqasi va yozuv (102 chaqiruvi) */
  alert?: boolean;
  t: number;
}

const listeners = new Set<(r: MapFocusRequest) => void>();
let pending: MapFocusRequest | null = null;

export const mapFocus = {
  request(lat: number, lon: number, opts: { label?: string; alert?: boolean } = {}) {
    if (!isFinite(lat) || !isFinite(lon)) return;
    const r: MapFocusRequest = { lat, lon, ...opts, t: Date.now() };
    if (listeners.size) listeners.forEach((l) => l(r));
    else pending = r;
  },
  /** Xarita ochilganda: kutib turgan so'rov (30 s dan eski bo'lmasa) */
  subscribe(cb: (r: MapFocusRequest) => void) {
    listeners.add(cb);
    if (pending && Date.now() - pending.t < 30_000) cb(pending);
    pending = null;
    return () => {
      listeners.delete(cb);
    };
  }
};
