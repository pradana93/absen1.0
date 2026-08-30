/**
 * ============================================================
 *  PRESSENSIA — Backend Express + MongoDB
 * ============================================================
 *  Kontrak endpoint IDENTIK dengan API simulasi browser (frontend/src/lib/api.ts),
 *  sehingga frontend tinggal mengganti pemanggilan lokal dengan fetch().
 *
 *  Desain pengenalan wajah:
 *   - Descriptor 128-dim diekstrak DI KLIEN (face-api.js / TensorFlow.js)
 *     karena model tidak praktis dijalankan di Node murni.
 *   - Server MENYIMPAN descriptor dan MENGHITUNG ULANG jarak Euclidean
 *     setiap absensi → klien tidak pernah bisa memalsukan hasil cocok.
 *   - Foto disimpan base64 (demo). Produksi: unggah ke S3, simpan URL.
 * ============================================================
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User, Attendance, Office } from "./models.js";
import { requireAuth, requireAdmin, signToken } from "./middleware/auth.js";

const app = express();
app.use(cors());
// base64 foto membuat body besar — naikkan batas JSON
app.use(express.json({ limit: "8mb" }));

const FACE_THRESHOLD = 0.5;

/* ---------- util ---------- */
const euclidean = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
};
const haversineM = (a, b) => {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};
const fail = (res, status, code, message, detail) =>
  res.status(status).json({ ok: false, error: { code, message, detail } });
const toSafe = (u, withDescriptor = false) => ({
  id: u._id.toString(),
  name: u.name,
  employeeId: u.employeeId,
  role: u.role,
  photo: u.photo,
  hasDescriptor: !!u.descriptor?.length,
  createdAt: u.createdAt,
  ...(withDescriptor ? { descriptor: u.descriptor } : {}),
});

/* ---------- AUTH ---------- */

// POST /api/auth/register — daftar + simpan foto & descriptor tanda tangan
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, employeeId, pin, photo, descriptor } = req.body ?? {};
    if (!name || name.trim().length < 3) return fail(res, 400, "INVALID", "Nama minimal 3 karakter.");
    if (!/^[A-Z0-9-]{3,16}$/i.test(employeeId ?? "")) return fail(res, 400, "INVALID", "NIP tidak valid.");
    if (!/^\d{6}$/.test(pin ?? "")) return fail(res, 400, "INVALID", "PIN harus 6 digit.");
    if (descriptor && descriptor.length !== 128) return fail(res, 400, "INVALID", "Descriptor wajah tidak valid.");

    const exists = await User.findOne({ employeeId: employeeId.toUpperCase() });
    if (exists) return fail(res, 409, "INVALID", `NIP "${employeeId}" sudah terdaftar.`);

    const user = await User.create({
      name: name.trim(),
      employeeId: employeeId.toUpperCase(),
      pinHash: await bcrypt.hash(pin, 10),
      photo: photo ?? null,
      descriptor: descriptor ?? null,
    });
    res.json({ ok: true, data: { token: signToken(user), user: toSafe(user, true) } });
  } catch (e) {
    fail(res, 500, "INVALID", "Registrasi gagal.", e.message);
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const { employeeId, pin } = req.body ?? {};
  const user = await User.findOne({ employeeId: (employeeId ?? "").toUpperCase() });
  if (!user || !(await bcrypt.compare(pin ?? "", user.pinHash)))
    return fail(res, 401, "UNAUTHORIZED", "NIP atau PIN salah.");
  res.json({ ok: true, data: { token: signToken(user), user: toSafe(user, true) } });
});

/* ---------- KONFIGURASI KANTOR ---------- */

// GET /api/office
app.get("/api/office", async (_req, res) => {
  const office = await Office.findOne();
  if (!office) return fail(res, 404, "NOT_FOUND", "Konfigurasi kantor belum dibuat.");
  res.json({ ok: true, data: office });
});

// PUT /api/office — admin mengatur titik & radius (divalidasi skema)
app.put("/api/office", requireAuth, requireAdmin, async (req, res) => {
  const { lat, lng, radiusM, demoGps } = req.body ?? {};
  const office = await Office.findOne();
  if (!office) return fail(res, 404, "NOT_FOUND", "Konfigurasi kantor belum dibuat.");
  if (lat != null) office.lat = lat;
  if (lng != null) office.lng = lng;
  if (radiusM != null) office.radiusM = radiusM;
  if (demoGps != null) office.demoGps = demoGps;
  await office.save(); // validasi min/max dari skema
  res.json({ ok: true, data: office });
});

/* ---------- ABSENSI (inti verifikasi) ---------- */

// POST /api/attendance
app.post("/api/attendance", requireAuth, async (req, res) => {
  const { type, photo, descriptor, coords, simulated } = req.body ?? {};
  const user = await User.findById(req.auth.sub);
  if (!user) return fail(res, 401, "UNAUTHORIZED", "Pengguna tidak ditemukan.");
  if (!user.descriptor?.length)
    return fail(res, 400, "NO_SIGNATURE", "Akun belum punya foto tanda tangan.");
  if (!["in", "out"].includes(type)) return fail(res, 400, "INVALID", "Tipe absensi tidak valid.");
  if (typeof coords?.lat !== "number" || typeof coords?.lng !== "number")
    return fail(res, 400, "GEO_REQUIRED", "Koordinat GPS wajib dikirim.");

  // ① verifikasi wajah DI SERVER
  if (!Array.isArray(descriptor) || descriptor.length !== 128)
    return fail(res, 400, "NO_FACE", "Descriptor wajah tidak ada.");
  const faceDistance = euclidean(descriptor, user.descriptor);
  if (faceDistance > FACE_THRESHOLD)
    return fail(res, 400, "FACE_MISMATCH", "Wajah tidak cocok dengan foto tanda tangan.",
      `Jarak ${faceDistance.toFixed(3)} > ambang ${FACE_THRESHOLD}.`);

  // ② verifikasi radius DI SERVER
  const office = await Office.findOne();
  if (!office) return fail(res, 500, "NOT_FOUND", "Konfigurasi kantor belum ada.");
  const distanceM = haversineM(coords, office);
  if (distanceM > office.radiusM)
    return fail(res, 400, "OUT_OF_RADIUS", "Anda berada di luar area kantor.",
      `Jarak ${Math.round(distanceM)} m — maksimum ${office.radiusM} m.`);

  // ③ urutan masuk ↔ pulang
  const last = await Attendance.findOne({ user: user._id }).sort({ timestamp: -1 });
  if (type === "in" && last && last.type === "in")
    return fail(res, 409, "DUPLICATE", "Anda sudah absen masuk.", "Absen pulang terlebih dahulu.");
  if (type === "out" && (!last || last.type !== "in"))
    return fail(res, 409, "DUPLICATE", "Belum ada absen masuk.");

  // Produksi: unggah `photo` ke S3 di sini, simpan URL-nya.
  const record = await Attendance.create({
    user: user._id,
    userName: user.name,
    employeeId: user.employeeId,
    type,
    coords,
    distanceM: Math.round(distanceM),
    faceDistance: +faceDistance.toFixed(3),
    photo: photo ?? null,
    simulated: !!simulated,
  });
  res.json({ ok: true, data: record });
});

// GET /api/attendance/me
app.get("/api/attendance/me", requireAuth, async (req, res) => {
  const records = await Attendance.find({ user: req.auth.sub }).sort({ timestamp: -1 }).limit(500);
  res.json({ ok: true, data: records });
});

/* ---------- ADMIN ---------- */

// GET /api/attendance?date=YYYY-MM-DD&userId=&type=
app.get("/api/attendance", requireAuth, requireAdmin, async (req, res) => {
  const q = {};
  if (req.query.userId) q.user = req.query.userId;
  if (req.query.type) q.type = req.query.type;
  if (req.query.date) {
    const [y, m, d] = req.query.date.split("-").map(Number);
    const start = new Date(y, m - 1, d), end = new Date(y, m - 1, d + 1);
    q.timestamp = { $gte: start, $lt: end };
  }
  const records = await Attendance.find(q).sort({ timestamp: -1 }).limit(1000);
  res.json({ ok: true, data: records });
});

// GET /api/users — tanpa descriptor & PIN
app.get("/api/users", requireAuth, requireAdmin, async (_req, res) => {
  const users = await User.find().sort({ createdAt: 1 });
  res.json({ ok: true, data: users.map((u) => toSafe(u)) });
});

/* ---------- bootstrap ---------- */
async function ensureSeeds() {
  const admin = await User.findOne({ role: "admin" });
  if (!admin)
    await User.create({
      name: "Admin Kantor",
      employeeId: "ADMIN01",
      pinHash: await bcrypt.hash(process.env.ADMIN_PIN || "123456", 10),
      role: "admin",
    });
  const office = await Office.findOne();
  if (!office)
    await Office.create({
      lat: +process.env.OFFICE_LAT || -6.175392,
      lng: +process.env.OFFICE_LNG || 106.827153,
      radiusM: +process.env.OFFICE_RADIUS_M || 150,
      demoGps: false,
    });
}

const PORT = process.env.PORT || 4000;
mongoose
  .connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/presensia")
  .then(async () => {
    await ensureSeeds();
    app.listen(PORT, () => console.log(`✅ Presensia API berjalan di http://localhost:${PORT}`));
  })
  .catch((e) => {
    console.error("❌ Gagal terhubung ke MongoDB:", e.message);
    process.exit(1);
  });
