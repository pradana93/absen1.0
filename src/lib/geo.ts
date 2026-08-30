/**
 * Modul GPS — Geolocation API browser + perhitungan radius.
 * Catatan: pengecekan radius di sini hanya untuk umpan balik instan;
 * verifikasi otoritatif tetap dilakukan "backend" (lihat api.ts / server).
 */
import type { Coords, OfficeConfig } from "./types";

/** Jarak dua koordinat (meter) — rumus Haversine. */
export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const GPS_ERRORS: Record<number, string> = {
  1: "Izin lokasi ditolak. Aktifkan izin lokasi di browser, atau nyalakan Mode Demo GPS di Dasbor Admin.",
  2: "Posisi tidak tersedia. Pastikan GPS perangkat aktif.",
  3: "Waktu permintaan lokasi habis. Coba lagi di tempat terbuka.",
};

/**
 * Ambil posisi saat ini.
 * Jika `office.demoGps` aktif (mode demo), posisi disimulasikan tepat di
 * sekitar titik kantor agar alur sukses bisa dicoba tanpa berada di kantor.
 */
export function getPosition(office: OfficeConfig): Promise<Coords> {
  if (office.demoGps) {
    // jitter acak ±~15 m supaya terasa nyata
    const j = () => (Math.random() - 0.5) * 0.00028;
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            lat: +(office.lat + j()).toFixed(6),
            lng: +(office.lng + j()).toFixed(6),
            accuracy: 8 + Math.random() * 8,
          }),
        500
      )
    );
  }

  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Browser tidak mendukung geolokasi."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(new Error(GPS_ERRORS[err.code] ?? "Gagal mengambil lokasi.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }
    );
  });
}

/** Cek radius di sisi klien (umpan balik instan sebelum dikirim ke server). */
export function radiusCheck(coords: Coords, office: OfficeConfig) {
  const distanceM = haversineM(coords, office);
  return { distanceM, inside: distanceM <= office.radiusM };
}
