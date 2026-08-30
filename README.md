# Presensia — Aplikasi Absensi (Verifikasi Wajah + Radius GPS)

Aplikasi absensi karyawan berbasis **Python Streamlit** dengan:

- **Registrasi + foto tanda tangan** — foto pertama user diekstrak menjadi *face descriptor* (embedding 128-dim) dan disimpan sebagai referensi biometrik.
- **Absen masuk/pulang** — foto baru dicocokkan dengan foto tanda tangan; tidak cocok → ditolak.
- **Validasi radius GPS** — koordinat perangkat dicek terhadap titik kantor + radius (admin) dengan rumus Haversine. Dicek di UI dan **divalidasi ulang di server**.
- **Log absensi** — user, timestamp, tipe, koordinat, jarak, skor kemiripan wajah, dan foto bukti.
- **Dashboard admin** — statistik, filter tanggal/karyawan/tipe, konfigurasi titik & radius kantor, daftar pengguna.

> **Catatan lingkungan:** repositori ini juga menyertakan *web demo* (React + Vite) di root — itulah yang disajikan oleh pratinjau statis sandbox ini, karena Streamlit membutuhkan server Python yang berjalan. Kedua versi berbagi logika bisnis, alur, dan akun demo yang sama.

---

## 1. Menjalankan versi Streamlit (Python)

### Prasyarat
- Python 3.10+ dan pip
- Webcam / kamera ponsel (atau gunakan **Mode Simulasi** jika tidak ada)
- Koneksi internet saat pertama kali menjalankan (unduh model ONNX ±38 MB, sekali saja)

### Langkah

```bash
cd streamlit_app

# (opsional, disarankan) virtual environment
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r requirements.txt
streamlit run app.py
```

Buka `http://localhost:8501`. Model wajah (YuNet + SFace, format ONNX) diunduh otomatis ke `streamlit_app/models/` pada penggunaan fitur wajah pertama kali.

### Akun demo (sudah di-seed)

| Peran     | NIP       | PIN    |
|-----------|-----------|--------|
| Admin     | `ADMIN01` | 123456 |
| Karyawan  | `EMP-1001`| 111111 |

Konfigurasi default: kantor di Monas, Jakarta (`-6.175392, 106.827153`), radius **150 m**, **Mode GPS Demo aktif** (posisi dianggap di kantor — matikan di *Pengaturan* admin untuk memaksa GPS asli perangkat).

---

## 2. Arsitektur

```
streamlit_app/
├── app.py            # UI + router + alur verifikasi (Streamlit)
├── db.py             # SQLite: users, attendance, office; hashing PIN (PBKDF2)
├── face_utils.py     # OpenCV: YuNet (deteksi) + SFace (descriptor & matching)
├── geo.py            # Haversine + pengecekan radius + descriptor simulasi
├── icon.svg
├── requirements.txt
├── .streamlit/config.toml   # tema gelap pine/amber
└── models/           # (dibuat otomatis) YuNet + SFace ONNX
```

### Kenapa OpenCV (bukan face-api.js)?
Aplikasi Streamlit menjalankan seluruh logika **di server Python**. OpenCV menyediakan deteksi wajah (YuNet) dan pengenalan wajah (SFace) sebagai model ONNX native — tanpa TensorFlow, tanpa kompilasi dlib, `pip install opencv-python` langsung jalan di semua OS. Descriptor 128-dim disimpan di database; pencocokan memakai **cosine similarity** dengan ambang resmi OpenCV **0.363**.

### Kenapa tidak ada JWT?
Streamlit adalah aplikasi *stateful* per sesi browser — `st.session_state` adalah padanan session-cookie pada app monolitik (server dan UI satu proses). Jika kelak UI dan API dipisah, terapkan JWT seperti pola umum REST.

### Alur verifikasi absensi (`perform_attendance` di `app.py`)
1. **Wajah** — analisis foto → harus *tepat satu* wajah → descriptor → cosine similarity vs. foto tanda tangan (gagal → `DITOLAK: Wajah tidak cocok`).
2. **Radius GPS** — Haversine ke titik kantor vs. radius admin (gagal → `DITOLAK: Di luar area kantor`). Pengecekan ini terjadi **di server**, bukan sekadar di UI.
3. **Urutan** — masuk ↔ pulang harus bergantian.
4. **Simpan log** — termasuk koordinat, jarak, skor kemiripan, dan foto bukti.

Setiap langkah ditampilkan sebagai *status checklist* di UI, diakhiri stempel **HADIR** / **DITOLAK**.

### Penyimpanan
- SQLite (file `presensia.db`) — users, attendance, office. Foto & descriptor sebagai BLOB.
- PIN di-hash **PBKDF2-HMAC-SHA256, 200.000 iterasi** + salt acak.

---

## 3. Catatan produksi

| Aspek | Demo | Produksi |
|---|---|---|
| Database | SQLite file | PostgreSQL (skema sama) |
| Foto | BLOB di DB | Unggah ke **AWS S3** (`boto3`), simpan URL |
| PIN | PBKDF2 | `bcrypt` / `argon2` |
| GPS | geolite / manual / demo | `st-geolite` + validasi akurasi (tolak `accuracy > 50 m`), pertimbangkan anti-spoofing (mock-location check) |
| Wajah | SFace ambang 0.363 | Tambah *liveness* (kedip/gerak) agar foto statis tak bisa dipakai |
| Deploy | `streamlit run` | Streamlit Community Cloud / Docker + reverse proxy HTTPS |

### Mengganti penyimpanan foto ke S3 (sketsa)
```python
import boto3
s3 = boto3.client("s3")
s3.upload_fileobj(io.BytesIO(photo_bytes), "presensia-photos", key)
# simpan f"https://…/{key}" di kolom photo, bukan BLOB
```

---

## 4. Web demo (pratinjau statis sandbox)

Versi React + Vite + Tailwind di root mereplikasi fitur yang sama di browser
(face-api.js/TinyFace + SFace-style descriptor di klien, radius dicek ulang "server-side"
oleh lapisan API simulasi). Menjalankan lokal:

```bash
npm install
npm run dev      # http://localhost:5173
```

Struktur utama: `src/lib/api.ts` (kontrak API + aturan bisnis), `src/lib/face.ts`
(model wajah), `src/lib/geo.ts` (GPS + radius), `src/screens/*` (UI).
