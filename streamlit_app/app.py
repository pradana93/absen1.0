"""
======================================================================
PRESSENSIA — Aplikasi Absensi (Verifikasi Wajah + Radius GPS)
Python · Streamlit · OpenCV (YuNet + SFace) · SQLite
======================================================================
Arsitektur singkat:
 - Streamlit menjalankan SELURUH logika di sisi server; browser hanya
   menjadi antarmuka. Karena itu:
     * JWT tidak dipakai — Streamlit menjaga state per sesi browser
       (st.session_state). Ini setara session-cookie pada app monolitik.
     * Ekstraksi & pencocokan wajah terjadi di server dengan OpenCV
       (tidak perlu mengunduh model ke ponsel user).
 - Urutan verifikasi absensi: WAJAH → RADIUS GPS → URUTAN MASUK/PULANG.
 - Foto & descriptor disimpan di SQLite (BLOB). Produksi: ganti ke
   PostgreSQL + S3 (lihat README).
======================================================================
"""
import io
import re
from datetime import datetime

import pandas as pd
import streamlit as st
from PIL import Image, ImageDraw, ImageFont

import db
import face_utils
from geo import check_radius, synthetic_descriptor

st.set_page_config(
    page_title="Presensia — Absensi Wajah & GPS",
    page_icon="icon.svg",
    layout="centered",
)

# ----------------------------------------------------------------------
#  Tema & CSS kustom (palet pine / amber / cream)
# ----------------------------------------------------------------------
CUSTOM_CSS = """
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Manrope:wght@400;600;800&display=swap');

html, body, [class*="st-"], [class*="css"] { font-family: 'Manrope', sans-serif; }
#MainMenu, footer { visibility: hidden; }

.brand h1 {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 44px; font-weight: 700; letter-spacing: -0.02em;
    margin: 10px 0 2px 0; color: #F2EDDD;
}
.brand p { color: #9DB2A4; margin: 0 0 26px 0; }

.clock {
    font-family: 'Space Grotesk', sans-serif;
    font-size: 46px; font-weight: 700; line-height: 1;
    font-variant-numeric: tabular-nums; color: #F5B84B;
    text-align: right;
}
.clock-date { text-align: right; color: #9DB2A4; font-size: 13px; margin-top: 6px; }

.hello { font-family: 'Space Grotesk', sans-serif; font-size: 26px; font-weight: 700; color: #F2EDDD; }
.chip {
    display: inline-block; margin-top: 6px; padding: 3px 12px; border-radius: 999px;
    border: 1px solid rgba(245,184,75,.4); color: #F5B84B;
    font-size: 12px; font-weight: 800; letter-spacing: .08em;
}

.card-title {
    font-family: 'Space Grotesk', sans-serif; font-size: 19px; font-weight: 700;
    color: #F2EDDD; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 10px;
}
.card-title span { color: #F5B84B; }

.stamp {
    font-family: 'Space Grotesk', sans-serif; font-weight: 700;
    display: inline-block; padding: 8px 22px; margin: 6px 0 2px 0;
    border: 3px solid currentColor; border-radius: 10px;
    letter-spacing: .16em; font-size: 22px; transform: rotate(-4deg);
}
.stamp-ok   { color: #4BD489; }
.stamp-fail { color: #F87060; }

div[data-testid="stMetric"] {
    background: #13211C; border: 1px solid rgba(255,255,255,.08);
    border-radius: 12px; padding: 14px 16px;
}
div[data-testid="stMetric"] label { color: #9DB2A4 !important; }

.stButton > button { font-weight: 800; border-radius: 12px; }
section[data-testid="stSidebar"] { background: #0A120F; }
"""
st.markdown(f"<style>{CUSTOM_CSS}</style>", unsafe_allow_html=True)

HARI = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"]
BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni",
         "Juli", "Agustus", "September", "Oktober", "November", "Desember"]


def fmt_id(iso: str) -> str:
    dt = datetime.fromisoformat(iso)
    return f"{HARI[dt.weekday()]}, {dt.day} {BULAN[dt.month - 1]} {dt.year} · {dt.strftime('%H:%M')}"


# ----------------------------------------------------------------------
#  Bootstrap: siapkan database (model wajah diunduh saat pertama dipakai)
# ----------------------------------------------------------------------
db.init_db()

for _key, _val in (("user", None), ("last_result", None)):
    st.session_state.setdefault(_key, _val)


# ----------------------------------------------------------------------
#  Widget kecil
# ----------------------------------------------------------------------
@st.fragment(run_every="1s")
def live_clock():
    now = datetime.now()
    st.markdown(
        f'<div class="clock">{now.strftime("%H:%M:%S")}</div>'
        f'<div class="clock-date">{HARI[now.weekday()]}, {now.day} {BULAN[now.month - 1]} {now.year}</div>',
        unsafe_allow_html=True,
    )


def placeholder_photo(name: str) -> bytes:
    """Foto placeholder untuk Mode Simulasi (kamera tidak tersedia)."""
    img = Image.new("RGB", (320, 400), (19, 33, 28))
    draw = ImageDraw.Draw(img)
    draw.ellipse([74, 80, 246, 252], fill=(30, 58, 47))
    draw.rectangle([60, 266, 260, 400], fill=(30, 58, 47))
    try:
        font_big = ImageFont.load_default(size=64)
        font_small = ImageFont.load_default(size=16)
    except TypeError:  # Pillow lama
        font_big = font_small = ImageFont.load_default()
    init = "".join(w[0].upper() for w in name.split()[:2]) or "?"
    draw.text((160, 166), init, fill="#F5B84B", anchor="mm", font=font_big)
    draw.text((160, 366), "MODE SIMULASI", fill=(242, 237, 220), anchor="mm", font=font_small)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


# ----------------------------------------------------------------------
#  GPS: mode demo → titik kantor; jika tidak, widget geolite; fallback manual
# ----------------------------------------------------------------------
def gps_section(office):
    """Kembalikan koordinat saat ini: {'lat','lng','accuracy'}."""
    if office["demo_gps"]:
        st.caption("Mode GPS Demo aktif — posisi dianggap tepat di titik kantor.")
        return {"lat": office["lat"], "lng": office["lng"], "accuracy": 0.0}

    coords = None
    try:
        from st_geolite import st_geolocate  # widget GPS browser (leaflet)

        loc = st_geolocate(key="geolite_gps")
        if isinstance(loc, dict) and loc.get("coords"):
            c = loc["coords"]
            if c.get("latitude") is not None and c.get("longitude") is not None:
                coords = {"lat": float(c["latitude"]), "lng": float(c["longitude"]),
                          "accuracy": float(c.get("accuracy") or 0)}
    except Exception:
        st.info("Widget `st-geolite` tidak tersedia di lingkungan ini — gunakan input manual di bawah.")

    lat = lng = None
    with st.expander("Koordinat manual (fallback / pengujian)"):
        c1, c2 = st.columns(2)
        lat = c1.number_input("Latitude", value=float(office["lat"]), format="%.6f", key="man_lat")
        lng = c2.number_input("Longitude", value=float(office["lng"]), format="%.6f", key="man_lng")

    if coords is None:
        coords = {"lat": float(lat), "lng": float(lng), "accuracy": 0.0}
    return coords


# ----------------------------------------------------------------------
#  Inti verifikasi absensi: WAJAH → RADIUS → URUTAN
# ----------------------------------------------------------------------
def perform_attendance(user, action, cam, coords, simulated):
    office = db.get_office()
    steps = []

    def reject(title, detail):
        return {"ok": False, "action": action, "title": title, "detail": detail, "steps": steps}

    # ① Verifikasi wajah (SFace cosine similarity)
    if simulated:
        descriptor = synthetic_descriptor(user["employee_id"])
        photo = placeholder_photo(user["name"])
    else:
        with st.spinner("Menganalisis wajah…"):
            analysis = face_utils.analyze_image(Image.open(cam))
        if analysis["face_count"] != 1:
            steps.append(("Deteksi wajah", f"{analysis['face_count']} wajah terdeteksi — harus tepat satu", False))
            return reject("Wajah tidak valid",
                          "Pastikan tepat satu wajah tampak jelas di dalam bingkai, lalu coba lagi.")
        descriptor, photo = analysis["descriptor"], analysis["photo_jpeg"]

    if user["descriptor"] is None:
        steps.append(("Foto tanda tangan", "Belum tersimpan di database", False))
        return reject("Belum ada foto tanda tangan", "Akun ini belum memiliki referensi wajah.")

    similarity = face_utils.match_similarity(descriptor,
                                             face_utils.decode_descriptor(user["descriptor"]))
    face_ok = similarity >= face_utils.COSINE_THRESHOLD
    steps.append(("Verifikasi wajah",
                  f"Skor kemiripan {similarity:.3f} (ambang {face_utils.COSINE_THRESHOLD})", face_ok))
    if not face_ok:
        return reject("Wajah tidak cocok",
                      "Wajah pada foto berbeda dengan foto tanda tangan. Absensi ditolak.")

    # ② Pengecekan radius GPS (di server)
    inside, distance = check_radius(coords["lat"], coords["lng"], office, office["radius_m"])
    steps.append(("Validasi lokasi",
                  f"Jarak {distance:.0f} m dari kantor (maks {office['radius_m']:.0f} m)", inside))
    if not inside:
        return reject("Di luar area kantor",
                      f"Anda berada {distance:.0f} m dari titik kantor — maksimum {office['radius_m']:.0f} m.")

    # ③ Urutan masuk ↔ pulang
    last = db.last_record(user["id"])
    if action == "in" and last and last["type"] == "in":
        steps.append(("Urutan absen", "Sudah ada absen masuk terbuka", False))
        return reject("Sudah absen masuk", "Anda belum melakukan absen pulang.")
    if action == "out" and (not last or last["type"] != "in"):
        steps.append(("Urutan absen", "Tidak ada absen masuk sebelumnya", False))
        return reject("Belum absen masuk", "Lakukan absen masuk terlebih dahulu.")
    steps.append(("Urutan absen", "Valid", True))

    # ④ Simpan log
    record = db.log_attendance(user, action, coords["lat"], coords["lng"], coords["accuracy"],
                               round(distance, 1), round(similarity, 3), photo, simulated)
    steps.append(("Menyimpan log", f"Tercatat pukul {record['timestamp'][11:16]}", True))
    return {"ok": True, "action": action, "record": record, "steps": steps,
            "similarity": similarity, "distance": distance}


def render_result(res):
    if not res:
        return
    label = "Absen Masuk" if res["action"] == "in" else "Absen Pulang"
    with st.status(label=f"{label} — {'Berhasil' if res['ok'] else 'Ditolak'}",
                   state="complete" if res["ok"] else "error",
                   expanded=not res["ok"]):
        for name, detail, ok in res["steps"]:
            st.write(f"**{name}** — {detail} {'✓' if ok else '✕'}")
    if res["ok"]:
        st.markdown('<div class="stamp stamp-ok">HADIR</div>', unsafe_allow_html=True)
        st.success(f"{label} tercatat pukul **{res['record']['timestamp'][11:16]}**. "
                   f"Jarak {res['distance']:.0f} m · kemiripan wajah {res['similarity']:.3f}.")
    else:
        st.markdown('<div class="stamp stamp-fail">DITOLAK</div>', unsafe_allow_html=True)
        st.error(f"**{res['title']}** — {res['detail']}")


# ----------------------------------------------------------------------
#  Layar otentikasi (masuk + daftar)
# ----------------------------------------------------------------------
def auth_screen():
    st.markdown(
        """<div class="brand">
             <svg width="54" height="54" viewBox="0 0 512 512">
               <rect width="512" height="512" rx="112" fill="#13211C"/>
               <circle cx="256" cy="252" r="148" fill="none" stroke="#F5B84B" stroke-width="30"/>
               <path d="M256 252 L256 168" stroke="#F2EDDD" stroke-width="24" stroke-linecap="round"/>
               <path d="M256 252 L318 288" stroke="#4BD489" stroke-width="24" stroke-linecap="round"/>
               <circle cx="256" cy="252" r="18" fill="#F5B84B"/>
             </svg>
             <h1>Presensia</h1>
             <p>Absensi dengan verifikasi wajah &amp; radius GPS — langsung dari ponsel.</p>
           </div>""",
        unsafe_allow_html=True,
    )

    tab_login, tab_reg = st.tabs(["Masuk", "Daftar Akun"])

    with tab_login:
        with st.form("login_form"):
            emp = st.text_input("NIP / ID Karyawan", placeholder="contoh: EMP-1001")
            pin = st.text_input("PIN", type="password", max_chars=6, placeholder="6 digit")
            if st.form_submit_button("Masuk", type="primary", use_container_width=True):
                user = db.login(emp, pin)
                if user:
                    st.session_state.user = user
                    st.session_state.last_result = None
                    st.rerun()
                else:
                    st.error("NIP atau PIN salah.")
        st.caption("Akun demo — Karyawan: `EMP-1001 / 111111` · Admin: `ADMIN01 / 123456`")

    with tab_reg:
        with st.form("reg_form"):
            name = st.text_input("Nama lengkap", placeholder="contoh: Budi Santoso")
            emp = st.text_input("NIP / ID Karyawan", placeholder="contoh: EMP-2001")
            pin = st.text_input("PIN (6 digit)", type="password", max_chars=6)
            cam = st.camera_input("Foto tanda tangan — posisikan wajah dengan jelas")
            simu = st.checkbox("Mode Simulasi (kamera tidak tersedia)",
                               help="Memakai descriptor sintetis yang konsisten per NIP. Hanya untuk demo.")
            if st.form_submit_button("Daftar", type="primary", use_container_width=True):
                register_user_flow(name, emp, pin, cam, simu)

        st.info("Foto tanda tangan adalah referensi biometrik Anda — setiap absensi nanti "
                "dicocokkan terhadap foto ini.")


def register_user_flow(name, emp, pin, cam, simu):
    # Validasi dasar
    if len(name.strip()) < 3:
        st.error("Nama minimal 3 karakter.")
        return
    if not re.fullmatch(r"[A-Za-z0-9-]{3,16}", emp.strip()):
        st.error("NIP hanya boleh huruf, angka, dan tanda hubung (3–16 karakter).")
        return
    if not re.fullmatch(r"\d{6}", pin or ""):
        st.error("PIN harus tepat 6 digit angka.")
        return

    # Ekstraksi descriptor wajah
    if simu:
        descriptor = face_utils.encode_descriptor(synthetic_descriptor(emp.strip().upper()))
        photo = placeholder_photo(name)
    else:
        if cam is None:
            st.error("Ambil foto tanda tangan terlebih dahulu (atau centang Mode Simulasi).")
            return
        with st.spinner("Menganalisis wajah…"):
            analysis = face_utils.analyze_image(Image.open(cam))
        if analysis["face_count"] != 1:
            st.error(f"Terdeteksi {analysis['face_count']} wajah — harus tepat satu. Ulangi foto.")
            return
        descriptor = face_utils.encode_descriptor(analysis["descriptor"])
        photo = analysis["photo_jpeg"]

    user = db.register_user(name, emp, pin, photo, descriptor)
    if user is None:
        st.error(f"NIP “{emp.upper()}” sudah terdaftar.")
        return
    st.session_state.user = user
    st.rerun()


# ----------------------------------------------------------------------
#  Halaman karyawan
# ----------------------------------------------------------------------
def employee_home(user):
    office = db.get_office()
    last = db.last_record(user["id"])
    next_type = "in" if (last is None or last["type"] == "out") else "out"

    c1, c2 = st.columns([1.3, 1])
    with c1:
        st.markdown(f'<div class="hello">Halo, {user["name"].split()[0]}</div>'
                    f'<div class="chip">{user["employee_id"]}</div>', unsafe_allow_html=True)
        if last and last["type"] == "in":
            st.caption(f"Sedang bekerja — masuk pukul {last['timestamp'][11:16]}")
        else:
            st.caption("Belum absen masuk hari ini")
    with c2:
        live_clock()

    # Lokasi kantor + GPS perangkat
    with st.container(border=True):
        st.markdown('<div class="card-title"><span>◉</span> Lokasi Kantor</div>',
                    unsafe_allow_html=True)
        st.caption(f"Titik: {office['lat']:.6f}, {office['lng']:.6f} · Radius: "
                   f"{office['radius_m']:.0f} m")
        coords = gps_section(office)
        inside, distance = check_radius(coords["lat"], coords["lng"], office, office["radius_m"])
        if inside:
            st.success(f"Anda berada **{distance:.0f} m** dari titik kantor — di dalam radius.")
        else:
            st.warning(f"Anda berada **{distance:.0f} m** dari titik kantor — di luar radius "
                       f"{office['radius_m']:.0f} m.")

    # Form absensi
    with st.container(border=True):
        label = "Absen Masuk" if next_type == "in" else "Absen Pulang"
        st.markdown(f'<div class="card-title"><span>▸</span> {label}</div>', unsafe_allow_html=True)
        cam = st.camera_input("Ambil foto wajah Anda sekarang", key=f"cam_{next_type}")
        simu = st.checkbox("Mode Simulasi (kamera tidak tersedia)", key=f"simu_{next_type}")
        if st.button(f"Verifikasi & {label}", type="primary", use_container_width=True,
                     disabled=(cam is None and not simu)):
            result = perform_attendance(user, next_type, cam, coords, simu)
            st.session_state.last_result = result
            st.rerun()

    render_result(st.session_state.last_result)

    # Ringkasan terbaru
    recent = db.my_records(user["id"], 6)
    if recent:
        st.markdown('<div class="card-title"><span>▤</span> Aktivitas Terbaru</div>',
                    unsafe_allow_html=True)
        st.dataframe(
            pd.DataFrame([{
                "Waktu": fmt_id(r["timestamp"]),
                "Jenis": "Masuk" if r["type"] == "in" else "Pulang",
                "Jarak": f"{(r['distance_m'] or 0):.0f} m",
                "Kemiripan": f"{(r['similarity'] or 0):.3f}",
            } for r in recent]),
            hide_index=True, use_container_width=True,
        )


def employee_history(user):
    st.markdown('<div class="card-title"><span>▤</span> Riwayat Absensi Saya</div>',
                unsafe_allow_html=True)
    records = db.my_records(user["id"], 200)
    if not records:
        st.info("Belum ada riwayat absensi.")
        return

    st.dataframe(
        pd.DataFrame([{
            "Waktu": fmt_id(r["timestamp"]),
            "Jenis": "Masuk" if r["type"] == "in" else "Pulang",
            "Jarak": f"{(r['distance_m'] or 0):.0f} m",
            "Kemiripan": f"{(r['similarity'] or 0):.3f}",
            "Simulasi": "Ya" if r["simulated"] else "—",
        } for r in records]),
        hide_index=True, use_container_width=True, height=340,
    )

    with_photo = [r for r in records if r["photo"]]
    if with_photo:
        choice = st.selectbox("Lihat bukti foto",
                              options=[r["id"] for r in with_photo],
                              format_func=lambda rid: fmt_id(
                                  next(r["timestamp"] for r in with_photo if r["id"] == rid))
                                  + (" · Masuk" if next(r["type"] for r in with_photo if r["id"] == rid) == "in"
                                     else " · Pulang"))
        rec = next(r for r in with_photo if r["id"] == choice)
        st.image(Image.open(io.BytesIO(rec["photo"])), width=300, caption=fmt_id(rec["timestamp"]))


# ----------------------------------------------------------------------
#  Halaman admin
# ----------------------------------------------------------------------
def admin_dashboard():
    stats = db.today_stats()
    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Absensi hari ini", stats["total"])
    m2.metric("Sedang bekerja", stats["active_now"])
    m3.metric("Karyawan terdaftar", stats["employees"])
    m4.metric("Radius kantor", f"{db.get_office()['radius_m']:.0f} m")

    st.markdown('<div class="card-title"><span>▤</span> 7 Hari Terakhir</div>',
                unsafe_allow_html=True)
    st.bar_chart(pd.DataFrame(db.last_seven_days()), x="Tanggal", y="Absensi", color="#F5B84B")

    recent = db.query_logs(date_str=datetime.now().strftime("%Y-%m-%d"))
    st.markdown('<div class="card-title"><span>▤</span> Log Hari Ini</div>', unsafe_allow_html=True)
    if not recent:
        st.info("Belum ada absensi hari ini.")
        return
    st.dataframe(logs_frame(recent), hide_index=True, use_container_width=True, height=320)


def logs_frame(records):
    return pd.DataFrame([{
        "Waktu": fmt_id(r["timestamp"]),
        "Nama": r["user_name"],
        "NIP": r["employee_id"],
        "Jenis": "Masuk" if r["type"] == "in" else "Pulang",
        "Jarak": f"{(r['distance_m'] or 0):.0f} m",
        "Kemiripan": f"{(r['similarity'] or 0):.3f}",
        "Sim": "Ya" if r["simulated"] else "—",
    } for r in records])


def admin_logs():
    st.markdown('<div class="card-title"><span>▤</span> Log Absensi</div>', unsafe_allow_html=True)
    users = db.list_users()

    f1, f2, f3 = st.columns([1, 1.2, 1])
    all_dates = f1.checkbox("Semua tanggal", value=True)
    date_val = None if all_dates else f1.date_input("Tanggal",
                                                    value=datetime.now().date()).strftime("%Y-%m-%d")
    user_val = f2.selectbox("Karyawan",
                            options=[0] + [u["id"] for u in users],
                            format_func=lambda x: "Semua karyawan" if x == 0
                            else next(u["name"] for u in users if u["id"] == x))
    type_val = f3.selectbox("Jenis", options=["", "in", "out"],
                            format_func=lambda x: {"": "Semua", "in": "Masuk", "out": "Pulang"}[x])

    records = db.query_logs(date_str=date_val,
                            user_id=user_val or None,
                            att_type=type_val or None)
    st.caption(f"{len(records)} catatan")
    if records:
        st.dataframe(logs_frame(records), hide_index=True, use_container_width=True, height=420)

        with_photo = [r for r in records if r["photo"]]
        if with_photo:
            st.markdown('<div class="card-title"><span>◉</span> Bukti Foto</div>',
                        unsafe_allow_html=True)
            choice = st.selectbox("Pilih catatan",
                                  options=[r["id"] for r in with_photo],
                                  format_func=lambda rid: fmt_id(
                                      next(r["timestamp"] for r in with_photo if r["id"] == rid))
                                      + " · " + next(r["user_name"] for r in with_photo if r["id"] == rid))
            rec = next(r for r in with_photo if r["id"] == choice)
            st.image(Image.open(io.BytesIO(rec["photo"])), width=300,
                     caption=f"{rec['user_name']} — {fmt_id(rec['timestamp'])}")
    else:
        st.info("Tidak ada catatan untuk filter ini.")


def admin_settings():
    st.markdown('<div class="card-title"><span>◉</span> Konfigurasi Radius Kantor</div>',
                unsafe_allow_html=True)
    office = db.get_office()
    with st.form("office_form"):
        c1, c2 = st.columns(2)
        lat = c1.number_input("Latitude kantor", value=float(office["lat"]), format="%.6f")
        lng = c2.number_input("Longitude kantor", value=float(office["lng"]), format="%.6f")
        radius = st.number_input("Radius yang diizinkan (meter)",
                                 value=float(office["radius_m"]), min_value=10.0,
                                 max_value=5000.0, step=10.0)
        demo = st.checkbox("Mode GPS Demo (karyawan dianggap di kantor)",
                           value=bool(office["demo_gps"]),
                           help="Matikan untuk memaksa GPS asli perangkat.")
        if st.form_submit_button("Simpan konfigurasi", type="primary"):
            db.update_office(lat, lng, radius, demo)
            st.success("Konfigurasi kantor diperbarui.")
            st.rerun()

    st.divider()
    st.markdown('<div class="card-title"><span>⚠</span> Zona Berbahaya</div>', unsafe_allow_html=True)
    confirm = st.checkbox("Saya paham seluruh data demo akan dihapus")
    if st.button("Reset database demo", disabled=not confirm):
        db.reset_db()
        st.session_state.clear()
        st.rerun()


def admin_users():
    st.markdown('<div class="card-title"><span>▤</span> Pengguna Terdaftar</div>',
                unsafe_allow_html=True)
    users = db.list_users()
    st.dataframe(
        pd.DataFrame([{
            "Nama": u["name"],
            "NIP": u["employee_id"],
            "Peran": "Admin" if u["role"] == "admin" else "Karyawan",
            "Foto tanda tangan": "✓ Tersimpan" if u["has_face"] else "—",
            "Terdaftar": fmt_id(u["created_at"]),
        } for u in users]),
        hide_index=True, use_container_width=True,
    )


# ----------------------------------------------------------------------
#  Router utama
# ----------------------------------------------------------------------
def main():
    user = st.session_state.user

    if user is None:
        auth_screen()
        return

    with st.sidebar:
        st.markdown("**Presensia**")
        st.caption(f"{user['name']} · {user['employee_id']}")
        st.caption("Admin" if user["role"] == "admin" else "Karyawan")

        if user["role"] == "admin":
            page = st.radio("Menu", ["Dashboard", "Log Absensi", "Pengaturan", "Pengguna"])
        else:
            page = st.radio("Menu", ["Absensi", "Riwayat Saya"])

        if st.button("Keluar", use_container_width=True):
            st.session_state.user = None
            st.session_state.last_result = None
            st.rerun()

    if user["role"] == "admin":
        {"Dashboard": admin_dashboard, "Log Absensi": admin_logs,
         "Pengaturan": admin_settings, "Pengguna": admin_users}[page]()
    else:
        {"Absensi": lambda: employee_home(user),
         "Riwayat Saya": lambda: employee_history(user)}[page]()


main()
