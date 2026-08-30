"""
Modul GPS & pengecekan radius.

Pengecekan radius dilakukan DI SERVER (Streamlit) — koordinat yang dikirim
perangkat hanya dipakai sebagai input, keputusan akhir selalu di sisi ini.
"""
import hashlib
import math

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Jarak lintasan besar antara dua koordinat, dalam meter."""
    rlat1, rlat2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(rlat1) * math.cos(rlat2) * math.sin(dlng / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def check_radius(lat, lng, office, radius_m):
    """Return (di_dalam_radius, jarak_meter)."""
    distance = haversine_m(lat, lng, office["lat"], office["lng"])
    return distance <= radius_m, distance


def synthetic_descriptor(seed: str):
    """
    Descriptor sintetis untuk MODE SIMULASI (kamera tidak tersedia).
    Deterministik per NIP, sehingga registrasi & absensi simulasi tetap "cocok".
    BUKAN fitur keamanan nyata — hanya untuk demo.
    """
    import numpy as np

    digest = hashlib.sha512(seed.encode()).digest()
    rng = np.random.default_rng(int.from_bytes(digest[:8], "big"))
    vec = rng.normal(size=128).astype(np.float32)
    vec /= np.linalg.norm(vec) + 1e-9
    return vec
