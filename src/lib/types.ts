/**
 * Tipe data bersama — kontrak yang SAMA dipakai oleh API simulasi di browser
 * (src/lib/api.ts) dan backend Express nyata (folder /server).
 */

export type Role = "employee" | "admin";

export type AttendanceType = "in" | "out";

export interface Coords {
  lat: number;
  lng: number;
  /** akurasi GPS dalam meter */
  accuracy: number;
}

/** Data user yang aman dikirim ke klien (tanpa PIN). */
export interface SafeUser {
  id: string;
  name: string;
  employeeId: string;
  role: Role;
  photo: string | null;
  /** true jika deskriptor wajah (tanda tangan biometrik) sudah tersimpan */
  hasDescriptor: boolean;
  createdAt: string;
  /**
   * Descriptor wajah MILIK SENDIRI — dikembalikan hanya pada sesi pemiliknya
   * agar pra-verifikasi bisa berjalan di perangkat (server tetap memverifikasi
   * ulang). Tidak dikirim ke pengguna lain/admin.
   */
  descriptor?: number[] | null;
}

/** Record user internal (disimpan di "database"). */
export interface StoredUser extends SafeUser {
  pinHash: string;
  /** 128 angka — vektor embedding wajah dari FaceRecognitionNet */
  descriptor: number[] | null;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  employeeId: string;
  type: AttendanceType;
  /** ISO timestamp */
  timestamp: string;
  coords: Coords;
  /** jarak user ke titik kantor (meter) saat absen */
  distanceM: number;
  /** jarak Euclidean descriptor wajah (0 = identik) */
  faceDistance: number;
  /** foto hasil tangkapan (base64 JPEG) — opsional */
  photo: string | null;
  /** true jika face/gps berjalan dalam mode simulasi (kamera diblokir) */
  simulated: boolean;
}

export interface OfficeConfig {
  lat: number;
  lng: number;
  /** radius yang diizinkan dalam meter */
  radiusM: number;
  /** mode demo: GPS disimulasikan tepat di titik kantor */
  demoGps: boolean;
  updatedAt: string;
}

export interface Session {
  token: string;
  user: SafeUser;
}

export type ApiErrorCode =
  | "INVALID"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "NO_SIGNATURE"
  | "NO_FACE"
  | "FACE_MISMATCH"
  | "OUT_OF_RADIUS";

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  detail?: string;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface RegisterPayload {
  name: string;
  employeeId: string;
  pin: string;
  /** foto tanda tangan (base64) */
  photo: string | null;
  /** descriptor wajah 128-dim */
  descriptor: number[] | null;
}

export interface AttendPayload {
  type: AttendanceType;
  photo: string | null;
  descriptor: number[] | null;
  coords: Coords;
  simulated: boolean;
}

export interface RecordsFilter {
  date?: string; // YYYY-MM-DD
  userId?: string;
  type?: AttendanceType;
}
