/**
 * Modul Face Recognition — @vladmandic/face-api (fork terpelihara dari face-api.js).
 *
 * ARSITEKTUR (dan alasannya):
 *  Ekstraksi descriptor wajah dilakukan DI FRONTEND karena model TensorFlow.js
 *  berjalan di browser — backend Node murni tidak bisa menjalankan model ini
 *  tanpa native binding yang berat. Yang dikirim/disimpan hanyalah:
 *   - foto (base64 JPEG, opsional, untuk arsip)
 *   - descriptor 128 angka (embedding) → ringan & bisa dibandingkan cepat.
 *  Perbandingan = jarak Euclidean antar descriptor, divalidasi ulang di
 *  "backend" (api.ts, dan server/src/index.js untuk versi nyata).
 *
 * Model yang dimuat (dari CDN, total ±6 MB, di-cache browser):
 *  - TinyFaceDetector      : deteksi wajah (ringan untuk ponsel)
 *  - FaceLandmark68Tiny    : 68 titik wajah (untuk alignment)
 *  - FaceRecognitionNet    : menghasilkan descriptor 128-dim
 *  (Ganti ke SSD-MobileNet v1 untuk akurasi lebih tinggi di perangkat kuat.)
 */
import * as faceapi from "@vladmandic/face-api";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface ModelProgress {
  status: ModelStatus;
  loaded: number; // 0..3
  total: number;
  label: string;
}

/** Beberapa sumber CDN — dicoba berurutan sampai berhasil. */
const MODEL_BASES = [
  "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model",
  "https://raw.githubusercontent.com/vladmandic/face-api/master/model",
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights",
];

let loadPromise: Promise<boolean> | null = null;

/** Muat ketiga model. Idempoten — pemanggilan berulang memakai promise yang sama. */
export function loadModels(onProgress?: (p: ModelProgress) => void): Promise<boolean> {
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const jobs: Array<{ label: string; load: (base: string) => Promise<void> }> = [
      { label: "Detektor wajah", load: (b) => faceapi.nets.tinyFaceDetector.loadFromUri(b) },
      { label: "Landmark wajah", load: (b) => faceapi.nets.faceLandmark68TinyNet.loadFromUri(b) },
      { label: "Model pengenalan", load: (b) => faceapi.nets.faceRecognitionNet.loadFromUri(b) },
    ];

    for (const base of MODEL_BASES) {
      try {
        let done = 0;
        onProgress?.({ status: "loading", loaded: 0, total: jobs.length, label: jobs[0].label });
        for (const job of jobs) {
          onProgress?.({ status: "loading", loaded: done, total: jobs.length, label: job.label });
          await job.load(base);
          done++;
        }
        onProgress?.({ status: "ready", loaded: jobs.length, total: jobs.length, label: "Siap" });
        return true;
      } catch {
        /* coba CDN berikutnya */
      }
    }
    onProgress?.({ status: "error", loaded: 0, total: jobs.length, label: "Gagal memuat model" });
    return false;
  })();

  return loadPromise;
}

const tinyOptions = () =>
  new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 });

/** Deteksi cepat: apakah ada wajah di frame video? (untuk indikator live) */
export async function hasFace(video: HTMLVideoElement): Promise<boolean> {
  try {
    const det = await faceapi.detectSingleFace(video, tinyOptions());
    return !!det;
  } catch {
    return false;
  }
}

export interface FrameAnalysis {
  /** descriptor 128-dim sebagai array angka biasa (siap disimpan) */
  descriptor: number[];
  /** jumlah wajah yang terdeteksi */
  faceCount: number;
  score: number;
}

/**
 * Analisis frame (video / canvas / gambar):
 * deteksi SATU wajah → landmark → descriptor.
 * Return null jika tidak ada wajah; faceCount > 1 ditolak di caller.
 */
export async function analyzeFrame(source: HTMLVideoElement | HTMLCanvasElement): Promise<FrameAnalysis | null> {
  // satu kali inferensi: semua wajah → landmark tiny → descriptor masing-masing
  const all = await faceapi
    .detectAllFaces(source, tinyOptions())
    .withFaceLandmarks(true)
    .withFaceDescriptors();
  if (all.length === 0) return null;

  const best = [...all].sort((a, b) => b.detection.score - a.detection.score)[0];
  return {
    descriptor: best.descriptor ? Array.from(best.descriptor) : [],
    faceCount: all.length,
    score: best.detection.score,
  };
}

/** Tangkap frame video → base64 JPEG (diperkecil agar hemat penyimpanan). */
export function capturePhoto(video: HTMLVideoElement, maxW = 480): string {
  const scale = Math.min(1, maxW / (video.videoWidth || maxW));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((video.videoWidth || 480) * scale);
  canvas.height = Math.round((video.videoHeight || 640) * scale);
  const ctx = canvas.getContext("2d")!;
  // efek cermin supaya sesuai preview
  ctx.translate(canvas.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

/** Foto placeholder (kanvas) untuk mode simulasi — avatar inisial. */
export function placeholderPhoto(name: string, seedHue = 152): string {
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 400;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `hsl(${seedHue} 32% 14%)`;
  ctx.fillRect(0, 0, 320, 400);
  ctx.fillStyle = `hsl(${seedHue} 35% 22%)`;
  ctx.beginPath();
  ctx.arc(160, 168, 86, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(60, 268, 200, 132);
  const init = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  ctx.fillStyle = "#F5B84B";
  ctx.font = "700 64px Sora, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(init || "?", 160, 172);
  ctx.fillStyle = "rgba(242,237,220,0.75)";
  ctx.font = "600 15px Sora, sans-serif";
  ctx.fillText("MODE SIMULASI", 160, 366);
  return canvas.toDataURL("image/jpeg", 0.8);
}
