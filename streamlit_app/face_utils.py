"""
Modul Face Recognition — OpenCV (YuNet + SFace).

Kenapa OpenCV dan bukan face-api.js?
  Di aplikasi Streamlit seluruh logika berjalan DI SERVER (Python). OpenCV
  menyediakan deteksi wajah (YuNet, ONNX ~0,4 MB) dan pengenalan wajah
  (SFace, ONNX ~37 MB) sebagai model native tanpa perlu TensorFlow/Keras,
  dan pip install-nya mulus di semua OS (tanpa kompilasi dlib).

Alur:
  1. Deteksi wajah  → FaceDetectorYN (harus TEPAT SATU wajah)
  2. Align & crop   → FaceRecognizerSF.alignCrop
  3. Descriptor     → 128-dim float32 embedding
  4. Bandingkan     → skor cosinus; cocok jika >= 0.363 (ambang resmi SFace)
"""
import io
import os
import urllib.request
from functools import lru_cache

import cv2
import numpy as np
from PIL import Image

MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

YUNET_PATH = os.path.join(MODELS_DIR, "face_detection_yunet_2023mar.onnx")
SFACE_PATH = os.path.join(MODELS_DIR, "face_recognition_sface_2021dec.onnx")

YUNET_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
             "face_detection_yunet/face_detection_yunet_2023mar.onnx")
SFACE_URL = ("https://github.com/opencv/opencv_zoo/raw/main/models/"
             "face_recognition_sface/face_recognition_sface_2021dec.onnx")

# Ambang resmi OpenCV untuk SFace (cosine similarity): >= 0.363 = orang yang sama
COSINE_THRESHOLD = 0.363


def ensure_models(on_progress=None) -> None:
    """Unduh model ONNX bila belum ada (sekali saja, lalu di-cache di disk)."""
    os.makedirs(MODELS_DIR, exist_ok=True)
    for url, path, label in ((YUNET_URL, YUNET_PATH, "detektor YuNet"),
                             (SFACE_URL, SFACE_PATH, "pengenalan SFace")):
        if not os.path.exists(path):
            if on_progress:
                on_progress(f"Mengunduh model {label}…")
            tmp = path + ".part"
            with urllib.request.urlopen(url) as resp, open(tmp, "wb") as f:
                f.write(resp.read())
            os.replace(tmp, path)


@lru_cache(maxsize=1)
def _detector():
    ensure_models()
    det = cv2.FaceDetectorYN.create(YUNET_PATH, "", (320, 320))
    det.setScoreThreshold(0.7)
    det.setNMSThreshold(0.3)
    return det


@lru_cache(maxsize=1)
def _recognizer():
    ensure_models()
    return cv2.FaceRecognizerSF.create(SFACE_PATH, "")


def pil_to_bgr(image: Image.Image):
    img = image.convert("RGB")
    return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)


def encode_photo(image: Image.Image, max_w=480) -> bytes:
    """Simpan foto sebagai JPEG (diperkecil) agar hemat penyimpanan."""
    img = image.convert("RGB")
    scale = min(1.0, max_w / img.width)
    if scale < 1.0:
        img = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    return buf.getvalue()


def analyze_image(image: Image.Image):
    """
    Analisis satu gambar: deteksi wajah → align → descriptor.
    Return dict:
      descriptor : np.ndarray(128, float32) atau None
      face_count : jumlah wajah yang terdeteksi
      photo_jpeg : bytes foto terkompresi
    """
    bgr = pil_to_bgr(image)
    det = _detector()
    det.setInputSize((bgr.shape[1], bgr.shape[0]))
    _status, faces = det.detect(bgr)
    face_count = 0 if faces is None else len(faces)

    descriptor = None
    if face_count == 1:
        aligned = _recognizer().alignCrop(bgr, faces[0])
        descriptor = _recognizer().feature(aligned)

    return {
        "descriptor": descriptor,
        "face_count": face_count,
        "photo_jpeg": encode_photo(image),
    }


def match_similarity(desc_a: np.ndarray, desc_b: np.ndarray) -> float:
    """Skor kemiripan cosinus (semakin tinggi semakin mirip; ambang 0.363)."""
    a = np.asarray(desc_a, dtype=np.float32).flatten()
    b = np.asarray(desc_b, dtype=np.float32).flatten()
    return float(_recognizer().match(a, b, cv2.FaceRecognizerSF_FR_COSINE))


def is_same_person(desc_a, desc_b) -> bool:
    return match_similarity(desc_a, desc_b) >= COSINE_THRESHOLD


def encode_descriptor(descriptor) -> bytes:
    return np.asarray(descriptor, dtype=np.float32).flatten().tobytes()


def decode_descriptor(blob: bytes):
    return np.frombuffer(blob, dtype=np.float32)
