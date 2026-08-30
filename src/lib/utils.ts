/**
 * Helper umum: format waktu (locale id-ID), ID acak, hashing demo,
 * matematika descriptor wajah, dan class name.
 */

export const cls = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export const uid = (prefix = "id") =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/* ---------------- waktu & tanggal (WIB / id-ID) ---------------- */

export const fmtClock = (d: Date) =>
  d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const fmtDate = (d: Date | string) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
};

export const fmtDateShort = (d: Date | string) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("id-ID", { weekday: "short", day: "numeric", month: "short" });
};

/** Kunci tanggal lokal YYYY-MM-DD (untuk filter harian). */
export const dateKey = (d: Date | string) => {
  const dt = typeof d === "string" ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

export const todayKey = () => dateKey(new Date());

export const fmtMeters = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;

/* ---------------- hashing demo (JANGAN pakai di produksi) ----------------
 * Produksi: bcrypt/argon2 di backend (lihat server/src/auth.js).
 * Di sini cukup hash deterministik agar PIN tidak disimpan polos di localStorage.
 */
export const hashPin = (pin: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = `presensia::${pin}`;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i), 2246822519) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}`;
};

/* ---------------- matematika pengenalan wajah ---------------- */

/** Ambang jarak Euclidean: <= 0.5 dianggap orang yang sama (face-api default ~0.6). */
export const FACE_THRESHOLD = 0.5;

/** Jarak Euclidean antara dua descriptor 128-dim. */
export const euclidean = (a: number[] | Float32Array, b: number[] | Float32Array): number => {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] as number) - (b[i] as number);
    sum += d * d;
  }
  return Math.sqrt(sum);
};

/**
 * Descriptor sintetis (FALLBACK MODE SIMULASI) — dipakai hanya jika kamera
 * benar-benar tidak tersedia (iframe diblokir, dsb). Deterministik per NIP,
 * sehingga registrasi & absensi simulasi tetap "cocok".
 * JANGAN dipakai sebagai fitur keamanan nyata.
 */
export const syntheticDescriptor = (seed: string): number[] => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), h | 1) >>> 0;
    h ^= h + Math.imul(h ^ (h >>> 7), h | 61) >>> 0;
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
  const v = Array.from({ length: 128 }, () => rand() * 2 - 1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
