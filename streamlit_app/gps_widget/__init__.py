"""
gps_widget — komponen GPS bawaan (tanpa dependensi pihak ketiga).

Pengganti `st-geolite` (yang sudah tidak tersedia di registry PyPI dan
membuat instalasi Streamlit Cloud gagal). Komponen ini mengimplementasikan
protokol komponen Streamlit langsung lewat postMessage di frontend/index.html:

  browser (navigator.geolocation) → Streamlit.setComponentValue → Python

Penggunaan:
    from gps_widget import st_geolocate
    loc = st_geolocate(key="gps")
    # loc: {'ok': True, 'lat': ..., 'lng': ..., 'accuracy': ...}
    #      {'ok': False, 'error': '...'}  atau None (belum ada nilai)
"""
import os

import streamlit.components.v1 as components

_component_func = components.declare_component(
    "gps_widget",
    path=os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend"),
)


def st_geolocate(key: str = "gps_widget"):
    """Minta posisi perangkat dari browser. Return dict atau None."""
    return _component_func(key=key, default=None)
