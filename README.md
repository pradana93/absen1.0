# Presensia — Aplikasi Absensi (Face Recognition + GPS Radius)

Aplikasi absensi mobile-web (PWA-ready) berbahasa Indonesia: registrasi dengan **foto tanda tangan wajah**, absen masuk/pulang dengan **verifikasi wajah** (face-api.js) dan **validasi radius GPS kantor**, plus **dasbor admin** untuk log & pengaturan.

## Struktur Proyek

```
├── index.html                  # shell PWA (font, manifest, meta)
├── public/
│   ├── icon.svg                # ikon aplikasi
│   ├── manifest.webmanifest    # PWA manifest
│   └── sw.js                   # service worker (offline shell)
├── src/                        # FRONTEND React + TypeScript + Tailwind v4
│   ├── lib/
│   │   ├── types.ts            # kontrak data bersama (frontend ↔ backend)
│   │   ├── api.ts              # "backend" simulasi (localStorage + validasi server-side)
│   │   ├── face.ts             # face-api.js: load model, deteksi, descriptor 128-dim
│   │   ├── geo.ts              # Geolocation API + Haversine + cek radius
│   │   └── utils.ts            # format waktu id-ID, Euclidean, hash demo
│   ├── state/AppContext.tsx    # sesi, kantor, status model, toast
│   ├── components/             # CameraCapture, UI kit, ikon SVG inline
│   └── screens/                # Auth, Home, History, Admin
└── server/                     # BACKEND referensi: Node.js + Express + MongoDB
    ├── package.json
    ├── .env.example
    └── src/
        ├── index.js            # semua endpoint + verifikasi otoritatif
        ├── models.js           # skema Mongoose
        └── middleware/auth.js  # JWT
```

## Jalankan Demo (frontend saja — tanpa server)

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # hasil build statis di dist/
```

Frontend berjalan mandiri memakai **API simulasi di browser** (`src/lib/api.ts`) dengan localStorage sebagai database — kontraknya identik dengan backend Express, jadi berpindah ke server nyata hanya mengganti isi file itu dengan `fetch()`.

**Akun demo (diseed otomatis):**

| Peran     | NIP       | PIN    |
|-----------|-----------|--------|
| Admin     | `ADMIN01` | `123456` |
| Karyawan  | `EMP-1001`| `111111` (punya riwayat, tanpa foto tanda tangan) |

Daftarkan akun baru lewat tab **Daftar** — foto tanda tangan diambil dari kamera.
Jika lingkungan memblokir kamera/GPS (mis. iframe pratinjau), tersedia **Mode Simulasi**
(descriptor sintetis konsisten per NIP) dan **Mode Demo GPS** (toggle di Dasbor Admin)
agar seluruh alur tetap bisa dicoba. Semua record simulasi diberi penanda `SIM`.

## Jalankan Backend Nyata (Express + MongoDB)

```bash
cd server
npm install
cp .env.example .env      # isi MONGODB_URI & JWT_SECRET
npm run dev               # http://localhost:4000
```

Endpoint (sama persis dengan simulasi):

| Method | Path                  | Keterangan |
|--------|-----------------------|------------|
| POST   | `/api/auth/register`  | daftar + simpan foto & descriptor |
| POST   | `/api/auth/login`     | login → JWT |
| GET    | `/api/office`         | ambil titik & radius kantor |
| PUT    | `/api/office`         | atur titik/radius (admin) |
| POST   | `/api/attendance`     | check-in/out — **verifikasi ulang wajah + radius** |
| GET    | `/api/attendance/me`  | riwayat sendiri |
| GET    | `/api/attendance`     | log semua + filter `date`, `userId`, `type` (admin) |
| GET    | `/api/users`          | daftar karyawan (admin) |

## Kenapa Pengenalan Wajah di Frontend?

Model TensorFlow.js (SSD-MobileNet / TinyFace + FaceRecognitionNet) dirancang berjalan
**di browser** — menjalankannya di Node murni butuh native binding yang berat dan rapuh.
Maka arsitekturnya:

1. **Klien** mengekstrak descriptor 128 angka dari foto (sekali saat registrasi, sekali tiap absen).
2. **Server menyimpan descriptor** (bukan logika AI) dan **menghitung ulang jarak Euclidean**
   setiap absensi (`server/src/index.js`) — hasil "cocok" dari klien tidak pernah dipercaya.
3. **Radius GPS juga diverifikasi ulang di server** dengan Haversine — cek di klien hanya
   untuk umpan balik instan.

Ambang jarak Euclidean: `0.5` (face-api default ≈ 0.6; diperketat untuk absensi).
Model yang dimuat: TinyFaceDetector + FaceLandmark68Tiny + FaceRecognitionNet (±6 MB,
dari CDN, di-cache browser). Ganti ke SSD-MobileNet v1 bila perangkat memadai.

## Keamanan & Catatan Produksi

- **PIN**: demo memakai hash sederhana di localStorage; backend nyata memakai **bcrypt** (`bcryptjs`).
- **JWT**: demo menandatangani sendiri di browser; backend memakai `jsonwebtoken` + `JWT_SECRET`.
- **Foto**: demo menyimpan base64 di localStorage/Mongo. Produksi: unggah ke **AWS S3**
  (lihat komentar di `POST /api/attendance` & `.env.example`), simpan URL-nya saja.
- **Model AI**: untuk offline total, unduh weights ke `public/models/` dan ganti
  `MODEL_BASES` di `src/lib/face.ts` ke path lokal.
- **HTTPS wajib** untuk `getUserMedia` & Geolocation di perangkat nyata.
- Mode Simulasi/Demo GPS hanyalah alat uji — matikan `demoGps` untuk pemakaian sungguhan.

## Alur Verifikasi (setiap absen)

```
Foto kamera → deteksi 1 wajah → descriptor 128-dim
   ├─ pra-cek klien: Euclidean ≤ 0.5 & Haversine ≤ radius
   └─ server: hitung ulang keduanya + urutan masuk↔pulang (anti-duplikat)
Hasil: stempel HADIR / DITOLAK + alasan + metrik (Δ wajah, jarak, akurasi GPS)
```
