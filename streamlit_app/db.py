"""
Lapisan persistensi — SQLite (file lokal, zero-config).

Catatan produksi:
 - Ganti SQLite dengan PostgreSQL/MongoDB tanpa mengubah tanda tangan fungsi.
 - Foto saat ini disimpan sebagai BLOB; untuk produksi unggah ke S3 dan
   simpan URL-nya (lihat README).
 - PIN di-hash dengan PBKDF2-HMAC-SHA256 (200.000 iterasi) + salt acak.
"""
import hashlib
import os
import sqlite3
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "presensia.db")

# Titik kantor default: Monumen Nasional, Jakarta (ubah via panel admin)
DEFAULT_OFFICE = {
    "lat": -6.175392,
    "lng": 106.827153,
    "radius_m": 150,
    "demo_gps": 1,  # default AKTIF agar demo langsung bisa dicoba di mana saja
}


def _conn():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


# ------------------------------------------------------------------
# Hashing PIN
# ------------------------------------------------------------------

def hash_pin(pin: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", pin.encode(), salt, 200_000)
    return salt.hex() + "$" + digest.hex()


def verify_pin(pin: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$")
        candidate = hashlib.pbkdf2_hmac("sha256", pin.encode(), bytes.fromhex(salt_hex), 200_000)
        return candidate.hex() == digest_hex
    except (ValueError, TypeError):
        return False


# ------------------------------------------------------------------
# Inisialisasi & seeding
# ------------------------------------------------------------------

def init_db():
    conn = _conn()
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            employee_id TEXT NOT NULL UNIQUE,
            pin_hash    TEXT NOT NULL,
            role        TEXT NOT NULL DEFAULT 'employee',
            photo       BLOB,
            descriptor  BLOB,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attendance (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            user_name   TEXT NOT NULL,
            employee_id TEXT NOT NULL,
            type        TEXT NOT NULL CHECK (type IN ('in','out')),
            timestamp   TEXT NOT NULL,
            lat         REAL, lng REAL, accuracy REAL,
            distance_m  REAL,
            similarity  REAL,
            photo       BLOB,
            simulated   INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS office (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            lat        REAL NOT NULL,
            lng        REAL NOT NULL,
            radius_m   REAL NOT NULL,
            demo_gps   INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
        """
    )

    # Seed admin (ADMIN01 / 123456) bila belum ada
    if cur.execute("SELECT 1 FROM users WHERE employee_id='ADMIN01'").fetchone() is None:
        cur.execute(
            "INSERT INTO users (name, employee_id, pin_hash, role, photo, descriptor, created_at) "
            "VALUES (?,?,?,?,NULL,NULL,?)",
            ("Admin Kantor", "ADMIN01", hash_pin("123456"), "admin", _now()),
        )

    # Seed konfigurasi kantor (singleton)
    if cur.execute("SELECT 1 FROM office WHERE id=1").fetchone() is None:
        cur.execute(
            "INSERT INTO office (id, lat, lng, radius_m, demo_gps, updated_at) VALUES (1,?,?,?,?,?)",
            (DEFAULT_OFFICE["lat"], DEFAULT_OFFICE["lng"], DEFAULT_OFFICE["radius_m"],
             DEFAULT_OFFICE["demo_gps"], _now()),
        )

    conn.commit()
    conn.close()


def reset_db():
    """Hapus seluruh data demo (file SQLite dihapus, lalu dibuat ulang)."""
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    init_db()


def _now():
    return datetime.now().isoformat(timespec="seconds")


def _row_to_dict(row):
    return dict(row) if row else None


# ------------------------------------------------------------------
# Users
# ------------------------------------------------------------------

def register_user(name, employee_id, pin, photo: bytes, descriptor: bytes):
    conn = _conn()
    try:
        conn.execute(
            "INSERT INTO users (name, employee_id, pin_hash, role, photo, descriptor, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (name.strip(), employee_id.strip().upper(), hash_pin(pin), "employee",
             sqlite3.Binary(photo), sqlite3.Binary(descriptor), _now()),
        )
        conn.commit()
        return _row_to_dict(conn.execute(
            "SELECT * FROM users WHERE employee_id=?", (employee_id.strip().upper(),)).fetchone())
    except sqlite3.IntegrityError:
        return None  # NIP sudah terdaftar
    finally:
        conn.close()


def login(employee_id, pin):
    conn = _conn()
    row = conn.execute("SELECT * FROM users WHERE employee_id=?",
                       (employee_id.strip().upper(),)).fetchone()
    conn.close()
    if row is None or not verify_pin(pin, row["pin_hash"]):
        return None
    return _row_to_dict(row)


def list_users():
    conn = _conn()
    rows = conn.execute("SELECT id, name, employee_id, role, created_at, "
                        "photo IS NOT NULL AS has_photo, descriptor IS NOT NULL AS has_face "
                        "FROM users ORDER BY created_at").fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ------------------------------------------------------------------
# Absensi
# ------------------------------------------------------------------

def log_attendance(user, att_type, lat, lng, accuracy, distance_m, similarity, photo, simulated):
    conn = _conn()
    cur = conn.execute(
        "INSERT INTO attendance (user_id, user_name, employee_id, type, timestamp, lat, lng, "
        "accuracy, distance_m, similarity, photo, simulated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (user["id"], user["name"], user["employee_id"], att_type, _now(),
         lat, lng, accuracy, distance_m, similarity,
         sqlite3.Binary(photo) if photo else None, 1 if simulated else 0),
    )
    conn.commit()
    record = _row_to_dict(conn.execute("SELECT * FROM attendance WHERE id=?",
                                       (cur.lastrowid,)).fetchone())
    conn.close()
    return record


def last_record(user_id):
    conn = _conn()
    row = conn.execute("SELECT * FROM attendance WHERE user_id=? ORDER BY timestamp DESC, id DESC LIMIT 1",
                       (user_id,)).fetchone()
    conn.close()
    return _row_to_dict(row)


def my_records(user_id, limit=50):
    conn = _conn()
    rows = conn.execute("SELECT * FROM attendance WHERE user_id=? ORDER BY timestamp DESC, id DESC LIMIT ?",
                        (user_id, limit)).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def query_logs(date_str=None, user_id=None, att_type=None):
    """Query log untuk admin, dengan filter tanggal (YYYY-MM-DD), user, dan tipe."""
    sql = "SELECT * FROM attendance WHERE 1=1"
    params = []
    if date_str:
        sql += " AND substr(timestamp,1,10)=?"
        params.append(date_str)
    if user_id:
        sql += " AND user_id=?"
        params.append(user_id)
    if att_type:
        sql += " AND type=?"
        params.append(att_type)
    sql += " ORDER BY timestamp DESC, id DESC LIMIT 1000"
    conn = _conn()
    rows = conn.execute(sql, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def today_stats():
    today = datetime.now().strftime("%Y-%m-%d")
    conn = _conn()
    total = conn.execute("SELECT COUNT(*) c FROM attendance WHERE substr(timestamp,1,10)=?",
                         (today,)).fetchone()["c"]
    ins = conn.execute("SELECT COUNT(*) c FROM attendance WHERE substr(timestamp,1,10)=? AND type='in'",
                       (today,)).fetchone()["c"]
    outs = conn.execute("SELECT COUNT(*) c FROM attendance WHERE substr(timestamp,1,10)=? AND type='out'",
                        (today,)).fetchone()["c"]
    users = conn.execute("SELECT COUNT(*) c FROM users WHERE role='employee'").fetchone()["c"]
    conn.close()
    return {"total": total, "ins": ins, "outs": outs, "employees": users,
            "active_now": max(0, ins - outs)}


def last_seven_days():
    """Hitung absensi per hari untuk 7 hari terakhir (untuk grafik admin)."""
    from datetime import timedelta

    counts = []
    conn = _conn()
    for i in range(6, -1, -1):
        day = (datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d")
        c = conn.execute("SELECT COUNT(*) c FROM attendance WHERE substr(timestamp,1,10)=?",
                         (day,)).fetchone()["c"]
        counts.append({"Tanggal": day[5:], "Absensi": c})
    conn.close()
    return counts


# ------------------------------------------------------------------
# Konfigurasi kantor
# ------------------------------------------------------------------

def get_office():
    conn = _conn()
    row = conn.execute("SELECT * FROM office WHERE id=1").fetchone()
    conn.close()
    return _row_to_dict(row)


def update_office(lat, lng, radius_m, demo_gps):
    conn = _conn()
    conn.execute("UPDATE office SET lat=?, lng=?, radius_m=?, demo_gps=?, updated_at=? WHERE id=1",
                 (lat, lng, radius_m, 1 if demo_gps else 0, _now()))
    conn.commit()
    row = conn.execute("SELECT * FROM office WHERE id=1").fetchone()
    conn.close()
    return _row_to_dict(row)
