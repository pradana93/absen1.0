/**
 * Dasbor utama — jam hidup, status GPS & model AI, ringkasan hari ini,
 * tombol ABSEN MASUK/PULANG besar, dan alur verifikasi bertahap
 * (wajah → GPS → server) dengan stempel hasil.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/AppContext";
import * as api from "../lib/api";
import CameraCapture, { type CaptureResult } from "../components/CameraCapture";
import { Avatar, Modal, Pill, SectionTitle } from "../components/ui";
import { euclidean, FACE_THRESHOLD, fmtClock, fmtDate, fmtMeters, fmtTime, sleep, syntheticDescriptor, todayKey, dateKey, cls } from "../lib/utils";
import { getPosition, radiusCheck } from "../lib/geo";
import type { AttendanceRecord, AttendanceType, Coords } from "../lib/types";
import {
  IconCheck, IconClose, IconLogout, IconMapPin, IconRefresh, IconScanFace,
  IconSpinner, IconAlert, IconCamera, IconClockIn,
} from "../components/icons";

/* ---------- model alur verifikasi ---------- */
type StepStatus = "wait" | "run" | "ok" | "fail";
interface Step { id: string; label: string; status: StepStatus; detail?: string }
interface FlowOutcome {
  ok: boolean;
  type: AttendanceType;
  reason?: string;
  detail?: string;
  record?: AttendanceRecord;
  faceDist?: number;
  distanceM?: number;
  accuracy?: number;
  simulated: boolean;
}

export default function HomeScreen() {
  const { user, token, office, model, signOut, refreshOffice, toast } = useApp();

  const [now, setNow] = useState(() => new Date());
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [gps, setGps] = useState<{ state: "idle" | "locating" | "ok" | "err"; distanceM?: number; inside?: boolean; accuracy?: number; msg?: string }>({ state: "idle" });

  const [camOpen, setCamOpen] = useState(false);
  const [flow, setFlow] = useState<{ open: boolean; steps: Step[]; outcome: FlowOutcome | null }>({ open: false, steps: [], outcome: null });
  const flowType = useRef<AttendanceType>("in");

  /* jam hidup */
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadRecords = useCallback(async () => {
    if (!token) return;
    const r = await api.myRecords(token);
    if (r.ok) setRecords(r.data);
  }, [token]);

  useEffect(() => { loadRecords(); }, [loadRecords]);
  useEffect(() => { if (office) probeGps(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [office?.lat, office?.lng, office?.radiusM, office?.demoGps]);

  /* cek lokasi untuk kartu status (non-blokir) */
  const probeGps = async () => {
    if (!office) return;
    setGps({ state: "locating" });
    try {
      const pos = await getPosition(office);
      const rc = radiusCheck(pos, office);
      setGps({ state: "ok", distanceM: rc.distanceM, inside: rc.inside, accuracy: pos.accuracy });
    } catch (e: any) {
      setGps({ state: "err", msg: e?.message ?? "Lokasi gagal." });
    }
  };

  /* status hari ini & tombol berikutnya */
  const today = todayKey();
  const todayRecords = useMemo(() => records.filter((r) => dateKey(r.timestamp) === today), [records, today]);
  const lastRecord = records[0]; // sudah urut desc
  const nextType: AttendanceType = !lastRecord || lastRecord.type === "out" ? "in" : "out";
  const todayIns = todayRecords.filter((r) => r.type === "in");
  const todayIn = todayIns[todayIns.length - 1];
  const todayOut = todayRecords.filter((r) => r.type === "out")[0];

  /* ---------- alur verifikasi ---------- */
  const startFlow = () => {
    if (!user || !office) return;
    flowType.current = nextType;
    setCamOpen(true);
  };

  const onCapture = async (cap: CaptureResult) => {
    setCamOpen(false);
    if (!user || !office || !token) return;

    const simulatedFace = cap.simulated || !cap.descriptor;
    const descriptor = cap.descriptor ?? syntheticDescriptor(user.employeeId);

    const steps: Step[] = [
      { id: "face", label: "Verifikasi wajah", status: "wait" },
      { id: "gps", label: "Validasi radius GPS", status: "wait" },
      { id: "save", label: "Simpan absensi", status: "wait" },
    ];
    const setStep = (id: string, patch: Partial<Step>) =>
      setFlow((f) => ({ ...f, steps: f.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    const openFlow = (s: Step[]) => setFlow((f) => ({ ...f, open: true, steps: s, outcome: null }));
    const finish = (outcome: FlowOutcome) => setFlow((f) => ({ ...f, outcome }));

    openFlow(steps);

    // ① WAJAH — pra-verifikasi di perangkat (server memverifikasi ulang hasilnya)
    setStep("face", { status: "run" });
    await sleep(600);
    if (!user.hasDescriptor || !user.descriptor) {
      setStep("face", { status: "fail", detail: "Akun belum punya tanda tangan wajah." });
      return finish({ ok: false, type: flowType.current, reason: "Tidak ada foto tanda tangan", detail: "Lakukan registrasi ulang untuk menyimpan referensi wajah.", simulated: simulatedFace });
    }
    const faceDist = euclidean(descriptor, user.descriptor);
    if (faceDist > FACE_THRESHOLD) {
      setStep("face", { status: "fail", detail: `Δ ${faceDist.toFixed(3)} > ambang ${FACE_THRESHOLD}` });
      return finish({
        ok: false, type: flowType.current, reason: "Wajah tidak cocok",
        detail: `Jarak wajah ${faceDist.toFixed(3)} melebihi ambang ${FACE_THRESHOLD}. Pastikan kamera menghadap wajah Anda, bukan orang lain.`,
        faceDist, simulated: simulatedFace,
      });
    }
    setStep("face", { status: "ok", detail: simulatedFace ? "Mode simulasi · cocok" : `Δ ${faceDist.toFixed(3)} · cocok` });

    // ② GPS — cek klien untuk umpan balik instan
    setStep("gps", { status: "run" });
    let coords: Coords;
    try {
      coords = await getPosition(office);
    } catch (e: any) {
      setStep("gps", { status: "fail", detail: "Lokasi gagal diambil" });
      return finish({ ok: false, type: flowType.current, reason: "Lokasi tidak tersedia", detail: e?.message, simulated: simulatedFace });
    }
    const rc = radiusCheck(coords, office);
    if (!rc.inside) {
      setStep("gps", { status: "fail", detail: `${fmtMeters(rc.distanceM)} dari kantor` });
      return finish({ ok: false, type: flowType.current, reason: "Di luar radius kantor", detail: `Jarak ${fmtMeters(rc.distanceM)} — maksimum ${office.radiusM} m dari titik kantor.`, distanceM: rc.distanceM, accuracy: coords.accuracy, simulated: simulatedFace });
    }
    setStep("gps", { status: "ok", detail: `${fmtMeters(rc.distanceM)} dari kantor` });

    // ③ SERVER — verifikasi otoritatif (wajah + radius + urutan)
    setStep("save", { status: "run" });
    const r = await api.attend(token, {
      type: flowType.current,
      photo: cap.photo,
      descriptor,
      coords,
      simulated: simulatedFace,
    });
    if (!r.ok) {
      setStep("save", { status: "fail", detail: r.error.message });
      return finish({ ok: false, type: flowType.current, reason: r.error.message, detail: r.error.detail, simulated: simulatedFace });
    }
    setStep("save", { status: "ok", detail: "Tersimpan" });
    await sleep(350);
    finish({
      ok: true,
      type: flowType.current,
      record: r.data,
      faceDist: r.data.faceDistance,
      distanceM: r.data.distanceM,
      accuracy: coords.accuracy,
      simulated: simulatedFace,
    });
    loadRecords();
    probeGps();
  };

  if (!user || !office) return null;
  const isIn = nextType === "in";

  return (
    <div className="px-5 pt-6 pb-32 max-w-md mx-auto relative z-10">
      {/* ===== Header ===== */}
      <header className="flex items-center justify-between animate-fade-up">
        <div className="flex items-center gap-3">
          <Avatar photo={user.photo} name={user.name} size={44} />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-fog">{greeting(now)}</p>
            <p className="font-bold text-cream text-[15px] leading-tight">{user.name}</p>
            <p className="text-[11px] font-mono text-fog-dim">{user.employeeId}{user.role === "admin" && <span className="text-amber"> · ADMIN</span>}</p>
          </div>
        </div>
        <button onClick={() => { signOut(); toast("Anda telah keluar.", "info"); }}
          className="p-2.5 rounded-lg border border-line bg-pine-800 text-fog hover:text-coral hover:border-coral/40 active:scale-95 transition"
          aria-label="Keluar">
          <IconLogout size={18} />
        </button>
      </header>

      {/* ===== Kartu jam ===== */}
      <section className="punch-card mt-6 pt-8 pb-5 px-5 text-center animate-fade-up" style={{ animationDelay: "70ms" }}>
        <p className="text-[12px] font-semibold text-fog">{fmtDate(now)}</p>
        <p className="clock-digits font-mono font-bold text-[52px] leading-none text-cream mt-2">
          {fmtClock(now).replace(/\./g, ":")}
          <span className="text-amber animate-blink">_</span>
        </p>
        <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
          {office.demoGps ? <Pill tone="amber" pulse>GPS SIMULASI AKTIF</Pill> : <Pill tone="teal" pulse>GPS PERANGKAT</Pill>}
          <Pill tone={model.status === "ready" ? "mint" : model.status === "error" ? "coral" : "amber"}>
            AI WAJAH: {model.status === "ready" ? "SIAP" : model.status === "error" ? "OFFLINE" : `MEMUAT ${model.loaded}/${model.total}`}
          </Pill>
        </div>
      </section>

      {/* ===== Status baris ===== */}
      <section className="grid grid-cols-2 gap-3 mt-4 animate-fade-up" style={{ animationDelay: "140ms" }}>
        {/* GPS */}
        <div className="punch-card pt-6 pb-4 px-4">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fog flex items-center gap-1.5"><IconMapPin size={13} className="text-amber" /> Lokasi</p>
            <button onClick={probeGps} className="text-fog hover:text-amber active:scale-90 transition" aria-label="Segarkan lokasi"><IconRefresh size={14} /></button>
          </div>
          {gps.state === "locating" && <p className="mt-2 text-[13px] font-semibold text-fog flex items-center gap-2"><IconSpinner size={14} /> Mencari sinyal…</p>}
          {gps.state === "ok" && (
            <>
              <p className={cls("mt-2 font-display text-[22px] tracking-wide", gps.inside ? "text-mint" : "text-coral")}>
                {gps.inside ? "DI DALAM" : "DI LUAR"}
              </p>
              <p className="text-[11px] font-mono text-fog mt-0.5">{fmtMeters(gps.distanceM ?? 0)} · akurasi ±{Math.round(gps.accuracy ?? 0)} m</p>
            </>
          )}
          {gps.state === "err" && <p className="mt-2 text-[11px] font-semibold text-coral leading-snug">{gps.msg}</p>}
          {gps.state === "idle" && <p className="mt-2 text-[12px] text-fog-dim">—</p>}
        </div>

        {/* Hari ini */}
        <div className="punch-card pt-6 pb-4 px-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fog flex items-center gap-1.5"><IconClockIn size={13} className="text-mint" /> Hari Ini</p>
          <div className="mt-2 space-y-1.5">
            <p className="flex items-center justify-between text-[12px]">
              <span className="text-fog font-semibold">Masuk</span>
              <span className={cls("font-mono font-bold", todayIn ? "text-mint" : "text-fog-dim")}>{todayIn ? fmtTime(todayIn.timestamp) : "——:——"}</span>
            </p>
            <p className="flex items-center justify-between text-[12px]">
              <span className="text-fog font-semibold">Pulang</span>
              <span className={cls("font-mono font-bold", todayOut ? "text-amber" : "text-fog-dim")}>{todayOut ? fmtTime(todayOut.timestamp) : "——:——"}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ===== Tombol besar ===== */}
      <section className="mt-6 animate-fade-up" style={{ animationDelay: "210ms" }}>
        <button
          onClick={startFlow}
          disabled={!user.hasDescriptor}
          className={cls(
            "btn-hard relative w-full overflow-hidden rounded-2xl border-2 px-6 py-6 text-left",
            isIn ? "bg-mint-deep border-mint text-ink" : "bg-amber-deep border-amber text-ink"
          )}
        >
          <span className="absolute -right-4 -top-6 opacity-15">{isIn ? <IconScanFace size={120} /> : <IconClockIn size={120} />}</span>
          <span className="block text-[11px] font-bold uppercase tracking-[0.2em] opacity-70">
            {isIn ? "Belum absen masuk" : "Sudah masuk — akhiri hari"}
          </span>
          <span className="mt-1 flex items-center gap-3">
            <span className="font-display text-[34px] leading-none tracking-wide">
              ABSEN {isIn ? "MASUK" : "PULANG"}
            </span>
          </span>
          <span className="mt-3 inline-flex items-center gap-2 rounded-lg bg-black/20 px-3 py-1.5 text-[11px] font-bold">
            <IconCamera size={14} /> Foto → verifikasi wajah → cek radius GPS
          </span>
        </button>
        {!user.hasDescriptor && (
          <p className="mt-2 text-center text-[11px] font-semibold text-coral">
            Akun ini belum memiliki foto tanda tangan — hubungi admin untuk registrasi ulang.
          </p>
        )}
      </section>

      {/* ===== Aktivitas terbaru ===== */}
      <section className="animate-fade-up" style={{ animationDelay: "280ms" }}>
        <SectionTitle right={<span className="text-[11px] font-mono text-fog-dim">{records.length} total</span>}>
          Aktivitas Terbaru
        </SectionTitle>
        {records.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-[12px] text-fog-dim">
            Belum ada riwayat absensi. Tekan tombol di atas untuk mulai.
          </p>
        ) : (
          <ul className="space-y-2">
            {records.slice(0, 4).map((r) => (
              <li key={r.id} className="punch-card pt-5 pb-3 px-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <RecordBadge type={r.type} />
                  <div>
                    <p className="font-mono font-bold text-cream text-[14px]">{fmtTime(r.timestamp)}</p>
                    <p className="text-[11px] text-fog">{new Date(r.timestamp).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · {fmtMeters(r.distanceM)} dari kantor</p>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-fog-dim">Δ{r.faceDistance.toFixed(2)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ===== Kamera ===== */}
      <CameraCapture
        open={camOpen}
        title={flowType.current === "in" ? "Absen Masuk" : "Absen Pulang"}
        seed={user.employeeId}
        name={user.name}
        onClose={() => setCamOpen(false)}
        onResult={onCapture}
      />

      {/* ===== Modal alur verifikasi ===== */}
      <Modal open={flow.open} onClose={flow.outcome ? () => setFlow((f) => ({ ...f, open: false })) : undefined} locked={!flow.outcome}>
        <div className="p-5 pt-6 max-h-[88dvh] overflow-y-auto thin-scroll">
          <p className="font-display text-[20px] tracking-[0.08em] uppercase text-cream mb-1">
            Verifikasi {flow.outcome?.type === "out" ? "Pulang" : "Masuk"}
          </p>
          <p className="text-[12px] text-fog mb-5">Jangan tutup jendela ini selama proses berjalan.</p>

          <ol className="space-y-2.5">
            {flow.steps.map((s) => (
              <li key={s.id} className={cls(
                "flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors",
                s.status === "fail" ? "border-coral/50 bg-coral/10" : s.status === "ok" ? "border-mint/40 bg-mint/5" : "border-line bg-pine-950"
              )}>
                <span className={cls(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[12px]",
                  s.status === "run" && "border-amber text-amber",
                  s.status === "ok" && "border-mint bg-mint text-ink",
                  s.status === "fail" && "border-coral bg-coral text-ink",
                  s.status === "wait" && "border-line text-fog-dim"
                )}>
                  {s.status === "run" ? <IconSpinner size={15} /> : s.status === "ok" ? <IconCheck size={15} /> : s.status === "fail" ? <IconClose size={15} /> : <span className="font-mono">{s.id === "face" ? "1" : s.id === "gps" ? "2" : "3"}</span>}
                </span>
                <div className="min-w-0">
                  <p className={cls("text-[13px] font-bold", s.status === "fail" ? "text-coral" : s.status === "ok" ? "text-mint" : "text-cream")}>{s.label}</p>
                  {s.detail && <p className="text-[11px] text-fog truncate">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>

          {/* Hasil */}
          {flow.outcome && (
            <div className="mt-6 text-center animate-fade-in">
              <div className={cls("stamp-ring inline-block font-display text-[38px]", flow.outcome.ok ? "text-mint animate-stamp" : "text-coral animate-stamp")}>
                {flow.outcome.ok ? "HADIR" : "DITOLAK"}
              </div>

              {!flow.outcome.ok ? (
                <div className="mt-4 rounded-xl border border-coral/40 bg-coral/10 p-4 text-left">
                  <p className="flex items-center gap-2 font-bold text-coral text-[14px]"><IconAlert size={16} /> {flow.outcome.reason}</p>
                  {flow.outcome.detail && <p className="mt-1.5 text-[12px] text-fog leading-relaxed">{flow.outcome.detail}</p>}
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-2 gap-2 text-left">
                  <Meta label="Waktu" value={flow.outcome.record ? fmtTime(flow.outcome.record.timestamp) : "—"} />
                  <Meta label="Tipe" value={flow.outcome.type === "in" ? "Masuk" : "Pulang"} />
                  <Meta label="Jarak wajah" value={`Δ ${flow.outcome.faceDist?.toFixed(3) ?? "—"}`} hint={`ambang ${FACE_THRESHOLD}`} />
                  <Meta label="Jarak lokasi" value={fmtMeters(flow.outcome.distanceM ?? 0)} hint={`±${Math.round(flow.outcome.accuracy ?? 0)} m`} />
                </div>
              )}

              {flow.outcome.simulated && (
                <p className="mt-3 text-[11px] font-semibold text-amber">Dicatat dalam mode simulasi (kamera/GPS perangkat tidak dipakai).</p>
              )}

              <button
                onClick={() => setFlow((f) => ({ ...f, open: false }))}
                className="btn-hard mt-5 w-full rounded-xl bg-cream py-3.5 font-display text-[15px] tracking-[0.12em] text-ink uppercase"
              >
                Tutup
              </button>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

/* ---------- komponen kecil ---------- */
const greeting = (d: Date) => {
  const h = d.getHours();
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
};

export function RecordBadge({ type }: { type: AttendanceType }) {
  return (
    <span className={cls(
      "grid h-9 w-9 place-items-center rounded-lg border font-display text-[11px] tracking-wider",
      type === "in" ? "border-mint/50 bg-mint/10 text-mint" : "border-amber/50 bg-amber/10 text-amber"
    )}>
      {type === "in" ? "IN" : "OUT"}
    </span>
  );
}

function Meta({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-pine-950 px-3 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-fog-dim">{label}</p>
      <p className="font-mono font-bold text-cream text-[14px] mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-fog-dim font-mono">{hint}</p>}
    </div>
  );
}
