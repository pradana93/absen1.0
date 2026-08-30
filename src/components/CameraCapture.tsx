/**
 * Modul Kamera — getUserMedia + face-api.
 * Alur: buka kamera depan → indikator live "wajah terdeteksi" →
 * tombol rana → bekukan frame → ekstraksi descriptor 128-dim →
 * kembalikan {photo, descriptor} ke pemanggil.
 * Jika kamera gagal (iframe tanpa izin, dsb) → Mode Simulasi.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "./ui";
import { IconCamera, IconClose, IconScanFace, IconAlert, IconFingerprint } from "./icons";
import { analyzeFrame, capturePhoto, hasFace, placeholderPhoto } from "../lib/face";
import { cls, sleep, syntheticDescriptor } from "../lib/utils";

export interface CaptureResult {
  photo: string;
  descriptor: number[] | null;
  simulated: boolean;
  faceCount: number;
}

type CamState = "starting" | "live" | "processing" | "noface" | "fallback";

export default function CameraCapture({
  open,
  title,
  seed,
  name,
  onClose,
  onResult,
}: {
  open: boolean;
  title: string;
  /** seed descriptor sintetis (NIP) untuk mode simulasi */
  seed: string;
  name: string;
  onClose: () => void;
  onResult: (r: CaptureResult) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const [state, setState] = useState<CamState>("starting");
  const [faceSeen, setFaceSeen] = useState(false);
  const [flash, setFlash] = useState(false);

  const stopAll = useCallback(() => {
    if (loopRef.current) window.clearInterval(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Buka kamera saat modal terbuka
  useEffect(() => {
    if (!open) return;
    setState("starting");
    setFaceSeen(false);
    let cancelled = false;

    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("no-media");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 800 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        if (cancelled) return;
        setState("live");

        // Loop indikator deteksi wajah (ringan, tiny detector; 1 inferensi pada satu waktu)
        loopRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.paused || busyRef.current) return;
          busyRef.current = true;
          setFaceSeen(await hasFace(videoRef.current));
          busyRef.current = false;
        }, 850);
      } catch {
        if (!cancelled) setState("fallback");
      }
    })();

    return () => {
      cancelled = true;
      stopAll();
    };
  }, [open, stopAll]);

  const shoot = async () => {
    const video = videoRef.current;
    if (!video || state !== "live" || busyRef.current) return;
    busyRef.current = true; // hentikan loop deteksi selama analisis
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setState("processing");
    await sleep(120);

    let analysis;
    try {
      analysis = await analyzeFrame(video);
    } catch {
      // model AI gagal dimuat/dijalankan → tawarkan mode simulasi
      busyRef.current = false;
      setState("fallback");
      return;
    }
    if (!analysis || analysis.descriptor.length === 0 || analysis.faceCount > 1) {
      // tanpa wajah, atau wajah lebih dari satu (ambigu) → tolak
      busyRef.current = false;
      setState("noface");
      return;
    }
    const photo = capturePhoto(video);
    stopAll();
    busyRef.current = false;
    onResult({ photo, descriptor: analysis.descriptor, simulated: false, faceCount: 1 });
  };

  const useSimulation = () => {
    stopAll();
    onResult({
      photo: placeholderPhoto(name),
      descriptor: syntheticDescriptor(seed),
      simulated: true,
      faceCount: 0,
    });
  };

  return (
    <Modal open={open} onClose={state === "processing" ? undefined : onClose} full locked>
      <div className="h-full flex flex-col bg-ink relative">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2 relative z-10">
          <div>
            <p className="font-display tracking-[0.1em] text-cream text-lg uppercase leading-tight">{title}</p>
            <p className="text-[12px] text-fog">Posisikan wajah di dalam bingkai</p>
          </div>
          <button
            onClick={onClose}
            disabled={state === "processing"}
            className="p-2.5 rounded-lg border border-line bg-pine-800 text-fog hover:text-cream active:scale-95 transition disabled:opacity-40"
            aria-label="Tutup kamera"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Viewfinder — video selalu ter-mount agar ref tersedia saat stream datang */}
        <div className="flex-1 relative overflow-hidden mx-4 rounded-xl border border-line bg-pine-950">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={cls(
              "absolute inset-0 w-full h-full object-cover -scale-x-100 transition-opacity",
              state === "live" || state === "processing" ? "opacity-100" : state === "noface" ? "opacity-50" : "opacity-0"
            )}
          />

          {/* Pemindai menyapu */}
          {state === "live" && (
            <div className="absolute inset-x-10 top-0 h-1/3 pointer-events-none overflow-visible">
              <div className="w-full h-16 bg-gradient-to-b from-transparent via-amber/25 to-transparent animate-sweep" />
            </div>
          )}

          {/* Bingkai wajah oval + sudut */}
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div
              className={cls(
                "w-[68%] aspect-[3/4] rounded-[50%] border-2 transition-colors duration-300",
                state === "processing" ? "border-amber" : faceSeen ? "border-mint" : "border-cream/30"
              )}
            />
            <span className="absolute top-4 left-4 h-7 w-7 border-t-2 border-l-2 border-amber rounded-tl-lg" />
            <span className="absolute top-4 right-4 h-7 w-7 border-t-2 border-r-2 border-amber rounded-tr-lg" />
            <span className="absolute bottom-4 left-4 h-7 w-7 border-b-2 border-l-2 border-amber rounded-bl-lg" />
            <span className="absolute bottom-4 right-4 h-7 w-7 border-b-2 border-r-2 border-amber rounded-br-lg" />
          </div>

          {/* Status live */}
          {state === "live" && (
            <div className="absolute top-4 inset-x-0 flex justify-center">
              <span
                className={cls(
                  "flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] font-bold border backdrop-blur-sm transition-colors",
                  faceSeen ? "bg-mint/15 border-mint/50 text-mint" : "bg-black/40 border-cream/20 text-cream/80"
                )}
              >
                <IconScanFace size={15} />
                {faceSeen ? "Wajah terdeteksi" : "Mencari wajah…"}
              </span>
            </div>
          )}

          {state === "starting" && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-center">
                <div className="mx-auto mb-3 h-10 w-10 rounded-full border-2 border-amber border-t-transparent animate-spin-slow" />
                <p className="text-sm text-fog font-semibold">Membuka kamera…</p>
                <p className="text-[11px] text-fog-dim mt-1">Izinkan akses kamera bila diminta</p>
              </div>
            </div>
          )}

          {state === "processing" && (
            <div className="absolute inset-0 grid place-items-center bg-black/45">
              <div className="text-center animate-pop">
                <IconFingerprint size={40} className="mx-auto text-amber mb-3" />
                <p className="text-sm font-bold text-cream">Mengekstrak tanda tangan wajah…</p>
                <p className="text-[11px] text-fog mt-1 font-mono">128-dim descriptor</p>
              </div>
            </div>
          )}

          {state === "noface" && (
            <div className="absolute inset-0 grid place-items-center bg-black/55 px-6">
              <div className="text-center animate-pop">
                <IconAlert size={34} className="mx-auto text-coral mb-2" />
                <p className="font-bold text-cream">Wajah tidak terdeteksi</p>
                <p className="text-[12px] text-fog mt-1">Pastikan wajah berada di dalam bingkai oval dan pencahayaan cukup. Hanya satu orang di depan kamera.</p>
                <button
                  onClick={() => setState("live")}
                  className="btn-hard mt-4 rounded-lg bg-coral px-5 py-2.5 text-[13px] font-bold text-ink"
                >
                  Coba Lagi
                </button>
              </div>
            </div>
          )}

          {state === "fallback" && (
            <div className="absolute inset-0 grid place-items-center px-6">
              <div className="text-center animate-pop max-w-xs">
                <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full border border-coral/40 bg-coral/10 text-coral">
                  <IconCamera size={24} />
                </div>
                <p className="font-bold text-cream">Kamera / model AI tidak tersedia</p>
                <p className="text-[12px] text-fog mt-1.5 leading-relaxed">
                  Lingkungan ini memblokir akses kamera atau gagal memuat model wajah. Untuk demo, lanjutkan dengan
                  <strong className="text-amber"> Mode Simulasi</strong> — descriptor sintetis yang konsisten per NIP.
                </p>
                <button
                  onClick={useSimulation}
                  className="btn-hard mt-4 w-full rounded-lg bg-amber px-5 py-3 text-[13px] font-bold text-ink"
                >
                  Gunakan Mode Simulasi
                </button>
                <button onClick={onClose} className="mt-2 w-full rounded-lg border border-line px-5 py-2.5 text-[12px] font-semibold text-fog">
                  Batal
                </button>
              </div>
            </div>
          )}

          {/* Efek flash rana */}
          {flash && <div className="absolute inset-0 bg-white/80 z-20 animate-fade-in" />}
        </div>

        {/* Kontrol bawah */}
        <div className="flex items-center justify-center py-5 relative z-10">
          {state === "live" && (
            <button
              onClick={shoot}
              aria-label="Ambil foto"
              className="btn-hard group relative grid h-18 w-18 place-items-center rounded-full border-4 border-amber bg-pine-800 p-1"
              style={{ height: 72, width: 72 }}
            >
              <span className="block h-full w-full rounded-full bg-amber transition-transform group-active:scale-90 grid place-items-center text-ink">
                <IconCamera size={28} />
              </span>
            </button>
          )}
          {(state === "starting" || state === "processing") && (
            <p className="text-[12px] text-fog-dim font-semibold tracking-wide uppercase">
              {state === "starting" ? "Menyiapkan…" : "Memproses…"}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
