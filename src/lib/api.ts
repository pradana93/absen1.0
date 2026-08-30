/**
 * ============================================================
 *  LAPISAN "BACKEND" — API SIMULASI DI BROWSER
 * ============================================================
 * File ini meniru backend Express + MongoDB (kode nyata ada di /server)
 * dengan kontrak endpoint yang IDENTIK, menggunakan localStorage sebagai
 * database dan latensi jaringan buatan. Ganti isi file ini dengan fetch()
 * HTTP ke /server untuk produksi — seluruh UI tetap bekerja tanpa perubahan.
 *
 *  POST /api/auth/register   → api.register()
 *  POST /api/auth/login      → api.login()
 *  GET  /api/office          → api.getOffice()
 *  PUT  /api/office          → api.updateOffice()   (admin)
 *  POST /api/attendance      → api.attend()
 *  GET  /api/attendance/me   → api.myRecords()
 *  GET  /api/attendance      → api.allRecords()     (admin)
 *  GET  /api/users           → api.allUsers()       (admin)
 *
 * Keamanan: validasi wajah & radius dilakukan DI SINI (sisi "server"),
 * bukan dipercaya dari klien — sama seperti server/src/index.js.
 */
import type {
  ApiErrorCode,
  ApiResult,
  AttendPayload,
  AttendanceRecord,
  AttendanceType,
  OfficeConfig,
  RecordsFilter,
  RegisterPayload,
  SafeUser,
  Session,
  StoredUser,
} from "./types";
import { dateKey, euclidean, FACE_THRESHOLD, hashPin, sleep, uid } from "./utils";
import { haversineM } from "./geo";

/* ---------------- "database" (localStorage) ---------------- */

const K = {
  users: "presensia:v1:users",
  records: "presensia:v1:records",
  office: "presensia:v1:office",
  session: "presensia:v1:session",
};

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

/* ---------------- "JWT" demo (lihat server untuk HMAC asli) ---------------- */

const SECRET = "presensia-demo-secret";
const sign = (payload: { sub: string; role: string; exp: number }) => {
  const body = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=+$/, "");
  let h = 0;
  const s = body + SECRET;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return `${body}.${(h >>> 0).toString(16)}`;
};
const verify = (token: string | null): { sub: string; role: string } | null => {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let h = 0;
  const s = body + SECRET;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  if ((h >>> 0).toString(16) !== sig) return null;
  try {
    const payload = JSON.parse(decodeURIComponent(escape(atob(body))));
    if (typeof payload.exp === "number" && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

/**
 * withDescriptor=true HANYA untuk sesi pemiliknya sendiri (pra-verifikasi
 * di perangkat). Daftar user untuk admin tidak pernah membawa descriptor.
 */
const toSafe = (u: StoredUser, withDescriptor = false): SafeUser => ({
  id: u.id,
  name: u.name,
  employeeId: u.employeeId,
  role: u.role,
  photo: u.photo,
  hasDescriptor: !!u.descriptor,
  createdAt: u.createdAt,
  descriptor: withDescriptor ? u.descriptor : undefined,
});

const latency = () => sleep(300 + Math.random() * 350);

function err<T>(code: ApiErrorCode, message: string, detail?: string): ApiResult<T> {
  return { ok: false, error: { code, message, detail } };
}

/* ---------------- seed data demo (hanya sekali) ---------------- */

export function seedIfNeeded() {
  if (localStorage.getItem(K.users)) return;

  const now = new Date();
  const admin: StoredUser = {
    id: "u_admin",
    name: "Admin Kantor",
    employeeId: "ADMIN01",
    pinHash: hashPin("123456"),
    role: "admin",
    photo: null,
    hasDescriptor: false,
    descriptor: null,
    createdAt: now.toISOString(),
  };
  const budi: StoredUser = {
    id: "u_budi",
    name: "Budi Santoso",
    employeeId: "EMP-1001",
    pinHash: hashPin("111111"),
    role: "employee",
    photo: null,
    hasDescriptor: false,
    descriptor: null,
    createdAt: now.toISOString(),
  };
  write(K.users, [admin, budi]);

  // Kantor demo: Monas, Jakarta — radius 150 m, Mode Demo GPS aktif.
  const office: OfficeConfig = {
    lat: -6.175392,
    lng: 106.827153,
    radiusM: 150,
    demoGps: true,
    updatedAt: now.toISOString(),
  };
  write(K.office, office);

  // Riwayat contoh untuk Budi (3 hari terakhir, tanpa foto).
  const records: AttendanceRecord[] = [];
  for (const daysAgo of [3, 2, 1]) {
    const day = new Date(now);
    day.setDate(day.getDate() - daysAgo);
    const mk = (h: number, m: number, type: AttendanceType): AttendanceRecord => {
      const t = new Date(day);
      t.setHours(h, m, Math.floor(Math.random() * 50), 0);
      const lat = office.lat + (Math.random() - 0.5) * 0.0008;
      const lng = office.lng + (Math.random() - 0.5) * 0.0008;
      return {
        id: uid("rec"),
        userId: budi.id,
        userName: budi.name,
        employeeId: budi.employeeId,
        type,
        timestamp: t.toISOString(),
        coords: { lat, lng, accuracy: 12 },
        distanceM: Math.round(haversineM({ lat, lng }, office)),
        faceDistance: +(0.3 + Math.random() * 0.16).toFixed(3),
        photo: null,
        simulated: false,
      };
    };
    records.push(mk(7, 42 + daysAgo, "in"), mk(17, 2 + daysAgo * 3, "out"));
  }
  write(K.records, records);
}

/* ================= AUTH ================= */

/** POST /api/auth/register — daftar + simpan foto & descriptor tanda tangan. */
export async function register(payload: RegisterPayload): Promise<ApiResult<Session>> {
  await latency();
  const name = payload.name.trim();
  const employeeId = payload.employeeId.trim().toUpperCase();
  if (name.length < 3) return err("INVALID", "Nama minimal 3 karakter.");
  if (!/^[A-Z0-9-]{3,16}$/.test(employeeId))
    return err("INVALID", "NIP/ID karyawan: 3–16 huruf/angka/tanda hubung.");
  if (!/^\d{6}$/.test(payload.pin)) return err("INVALID", "PIN harus 6 digit angka.");

  const users = read<StoredUser[]>(K.users, []);
  if (users.some((u) => u.employeeId === employeeId))
    return err("INVALID", `NIP "${employeeId}" sudah terdaftar. Silakan masuk.`);

  const user: StoredUser = {
    id: uid("u"),
    name,
    employeeId,
    pinHash: hashPin(payload.pin),
    role: "employee",
    photo: payload.photo,
    descriptor: payload.descriptor,
    hasDescriptor: !!payload.descriptor,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  write(K.users, users);

  const token = sign({ sub: user.id, role: user.role, exp: Date.now() + 24 * 3600 * 1000 });
  write(K.session, token);
  return { ok: true, data: { token, user: toSafe(user, true) } };
}

/** POST /api/auth/login */
export async function login(employeeId: string, pin: string): Promise<ApiResult<Session>> {
  await latency();
  const users = read<StoredUser[]>(K.users, []);
  const user = users.find((u) => u.employeeId === employeeId.trim().toUpperCase());
  if (!user || user.pinHash !== hashPin(pin))
    return err("UNAUTHORIZED", "NIP atau PIN salah.");
  const token = sign({ sub: user.id, role: user.role, exp: Date.now() + 24 * 3600 * 1000 });
  write(K.session, token);
  return { ok: true, data: { token, user: toSafe(user, true) } };
}

/** Pulihkan sesi dari token tersimpan (dipanggil saat aplikasi dibuka). */
export async function restoreSession(): Promise<Session | null> {
  await sleep(350);
  const token = read<string | null>(K.session, null);
  const payload = verify(token);
  if (!payload) return null;
  const user = read<StoredUser[]>(K.users, []).find((u) => u.id === payload.sub);
  return user ? { token: token as string, user: toSafe(user, true) } : null;
}

export function logout() {
  localStorage.removeItem(K.session);
}

/* ================= KONFIGURASI KANTOR ================= */

/** GET /api/office */
export async function getOffice(): Promise<OfficeConfig> {
  await sleep(150);
  return read<OfficeConfig>(K.office, {
    lat: -6.175392,
    lng: 106.827153,
    radiusM: 150,
    demoGps: true,
    updatedAt: new Date().toISOString(),
  });
}

/** PUT /api/office — hanya admin. */
export async function updateOffice(
  token: string | null,
  patch: Partial<Pick<OfficeConfig, "lat" | "lng" | "radiusM" | "demoGps">>
): Promise<ApiResult<OfficeConfig>> {
  await latency();
  const p = verify(token);
  if (!p) return err("UNAUTHORIZED", "Sesi berakhir. Silakan masuk ulang.");
  if (p.role !== "admin") return err("FORBIDDEN", "Hanya admin yang dapat mengubah pengaturan.");
  const office = await getOffice();
  const next: OfficeConfig = { ...office, ...patch, updatedAt: new Date().toISOString() };
  if (Math.abs(next.lat) > 90 || Math.abs(next.lng) > 180)
    return err("INVALID", "Koordinat tidak valid.");
  if (next.radiusM < 10 || next.radiusM > 5000)
    return err("INVALID", "Radius harus 10–5000 meter.");
  write(K.office, next);
  return { ok: true, data: next };
}

/* ================= ABSENSI (inti verifikasi) ================= */

/**
 * POST /api/attendance
 * Verifikasi berlapis (sama dengan server nyata):
 *  1. Token valid
 *  2. Descriptor wajah tersimpan ada
 *  3. Jarak Euclidean wajah <= ambang (0.5)
 *  4. Jarak GPS <= radius kantor (Haversine)
 *  5. Urutan masuk/pulang bergantian (anti duplikat)
 */
export async function attend(token: string | null, payload: AttendPayload): Promise<ApiResult<AttendanceRecord>> {
  await latency();
  const p = verify(token);
  if (!p) return err("UNAUTHORIZED", "Sesi berakhir. Silakan masuk ulang.");

  const users = read<StoredUser[]>(K.users, []);
  const user = users.find((u) => u.id === p.sub);
  if (!user) return err("UNAUTHORIZED", "Pengguna tidak ditemukan.");
  if (!user.descriptor)
    return err("NO_SIGNATURE", "Akun ini belum punya foto tanda tangan. Hubungi admin untuk registrasi ulang.");

  // ① Verifikasi wajah (di "server")
  if (!payload.descriptor || payload.descriptor.length !== 128)
    return err("NO_FACE", "Wajah tidak terdeteksi pada foto.");
  const faceDistance = euclidean(payload.descriptor, user.descriptor);
  if (faceDistance > FACE_THRESHOLD)
    return err(
      "FACE_MISMATCH",
      "Wajah tidak cocok dengan foto tanda tangan.",
      `Jarak ${faceDistance.toFixed(3)} > ambang ${FACE_THRESHOLD}. Absensi ditolak.`
    );

  // ② Verifikasi radius GPS (di "server")
  const office = read<OfficeConfig>(K.office, { lat: 0, lng: 0, radiusM: 100, demoGps: false, updatedAt: "" });
  const distanceM = haversineM(payload.coords, office);
  if (distanceM > office.radiusM)
    return err(
      "OUT_OF_RADIUS",
      "Anda berada di luar area kantor.",
      `Jarak ${Math.round(distanceM)} m dari titik kantor — maksimum ${office.radiusM} m.`
    );

  // ③ Urutan masuk ↔ pulang
  const records = read<AttendanceRecord[]>(K.records, []);
  const last = records.filter((r) => r.userId === user.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0];
  if (payload.type === "in" && (!last || last.type === "out") === false)
    return err("DUPLICATE", "Anda sudah absen masuk.", 'Absen pulang terlebih dahulu sebelum absen masuk lagi.');
  if (payload.type === "out" && (!last || last.type !== "in"))
    return err("DUPLICATE", "Belum ada absen masuk.", "Absen masuk terlebih dahulu.");

  const record: AttendanceRecord = {
    id: uid("rec"),
    userId: user.id,
    userName: user.name,
    employeeId: user.employeeId,
    type: payload.type,
    timestamp: new Date().toISOString(),
    coords: payload.coords,
    distanceM: Math.round(distanceM),
    faceDistance: +faceDistance.toFixed(3),
    photo: payload.photo,
    simulated: payload.simulated,
  };
  records.unshift(record);
  write(K.records, records);
  return { ok: true, data: record };
}

/* ================= RIWAYAT ================= */

/** GET /api/attendance/me */
export async function myRecords(token: string | null): Promise<ApiResult<AttendanceRecord[]>> {
  await latency();
  const p = verify(token);
  if (!p) return err("UNAUTHORIZED", "Sesi berakhir.");
  const records = read<AttendanceRecord[]>(K.records, [])
    .filter((r) => r.userId === p.sub)
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { ok: true, data: records };
}

/** GET /api/attendance — admin, dengan filter tanggal/user/tipe. */
export async function allRecords(token: string | null, filter: RecordsFilter = {}): Promise<ApiResult<AttendanceRecord[]>> {
  await latency();
  const p = verify(token);
  if (!p) return err("UNAUTHORIZED", "Sesi berakhir.");
  if (p.role !== "admin") return err("FORBIDDEN", "Khusus admin.");
  let records = read<AttendanceRecord[]>(K.records, []);
  if (filter.date) records = records.filter((r) => dateKey(r.timestamp) === filter.date);
  if (filter.userId) records = records.filter((r) => r.userId === filter.userId);
  if (filter.type) records = records.filter((r) => r.type === filter.type);
  return { ok: true, data: records.sort((a, b) => b.timestamp.localeCompare(a.timestamp)) };
}

/** GET /api/users — admin. */
export async function allUsers(token: string | null): Promise<ApiResult<SafeUser[]>> {
  await latency();
  const p = verify(token);
  if (!p) return err("UNAUTHORIZED", "Sesi berakhir.");
  if (p.role !== "admin") return err("FORBIDDEN", "Khusus admin.");
  return { ok: true, data: read<StoredUser[]>(K.users, []).map((u) => toSafe(u)) };
}
