/**
 * Layar Autentikasi — Masuk (NIP + PIN) dan Pendaftaran.
 * Pendaftaran = wizard 3 langkah: data diri → foto tanda tangan (kamera)
 * → konfirmasi. Foto + descriptor wajah disimpan sebagai referensi verifikasi.
 */
import { useState } from "react";
import { useApp } from "../state/AppContext";
import * as api from "../lib/api";
import CameraCapture, { type CaptureResult } from "../components/CameraCapture";
import { IconArrowRight, IconCamera, IconCheck, IconEye, IconEyeOff, IconFingerprint, IconScanFace, IconSpinner } from "../components/icons";
import { cls } from "../lib/utils";

type Tab = "login" | "register";
type Step = 1 | 2 | 3;

export default function AuthScreen() {
  const { setSession, toast } = useApp();
  const [tab, setTab] = useState<Tab>("login");

  /* ---------- state login ---------- */
  const [loginNip, setLoginNip] = useState("");
  const [loginPin, setLoginPin] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginErr, setLoginErr] = useState<string | null>(null);

  /* ---------- state registrasi ---------- */
  const [step, setStep] = useState<Step>(1);
  const [regName, setRegName] = useState("");
  const [regNip, setRegNip] = useState("");
  const [regPin, setRegPin] = useState("");
  const [regPin2, setRegPin2] = useState("");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [camOpen, setCamOpen] = useState(false);
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [regBusy, setRegBusy] = useState(false);

  const doLogin = async (nip: string, pin: string) => {
    setLoginBusy(true);
    setLoginErr(null);
    const r = await api.login(nip, pin);
    setLoginBusy(false);
    if (r.ok) {
      setSession(r.data);
      toast(`Selamat datang, ${r.data.user.name.split(" ")[0]}!`, "success");
    } else setLoginErr(r.error.message);
  };

  const submitStep1 = () => {
    setFormErr(null);
    if (regName.trim().length < 3) return setFormErr("Nama minimal 3 karakter.");
    if (!/^[A-Za-z0-9-]{3,16}$/.test(regNip.trim())) return setFormErr("NIP: 3–16 huruf/angka/tanda hubung, tanpa spasi.");
    if (!/^\d{6}$/.test(regPin)) return setFormErr("PIN harus tepat 6 digit angka.");
    if (regPin !== regPin2) return setFormErr("Konfirmasi PIN tidak sama.");
    setStep(2);
    setCamOpen(true);
  };

  const onCapture = (r: CaptureResult) => {
    setCamOpen(false);
    setCapture(r);
    setStep(3);
  };

  const submitRegister = async () => {
    if (!capture) return;
    setRegBusy(true);
    const r = await api.register({
      name: regName,
      employeeId: regNip,
      pin: regPin,
      photo: capture.photo,
      descriptor: capture.descriptor,
    });
    setRegBusy(false);
    if (r.ok) {
      setSession(r.data);
      toast(capture.simulated ? "Pendaftaran berhasil (mode simulasi)." : "Pendaftaran berhasil! Foto tanda tangan tersimpan.", "success");
    } else {
      setFormErr(r.error.message);
      setStep(1);
    }
  };

  const stepDone = (s: Step) => (step > s ? "done" : step === s ? "now" : "todo");

  return (
    <div className="min-h-dvh flex flex-col px-5 pt-12 pb-8 max-w-md mx-auto w-full relative z-10">
      {/* ===== Merek ===== */}
      <header className="animate-fade-up">
        <div className="flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-xl border-2 border-amber bg-pine-800 text-amber shadow-[4px_4px_0_rgba(0,0,0,0.45)]">
            <IconFingerprint size={26} />
          </span>
          <div>
            <h1 className="font-display text-[34px] leading-none tracking-wide text-cream">
              PRESENSIA<span className="text-amber">.</span>
            </h1>
            <p className="text-[11px] font-bold tracking-[0.22em] text-fog uppercase mt-1">Absensi Wajah + GPS</p>
          </div>
        </div>
        <p className="mt-5 text-[13px] leading-relaxed text-fog max-w-[34ch]">
          Verifikasi identitas dengan <span className="text-mint font-semibold">tanda tangan wajah</span> dan
          validasi <span className="text-amber font-semibold">radius lokasi kantor</span> — langsung dari ponsel.
        </p>
      </header>

      {/* ===== Tab ===== */}
      <div className="mt-7 grid grid-cols-2 rounded-xl border border-line bg-pine-900 p-1 animate-fade-up" style={{ animationDelay: "60ms" }}>
        {(["login", "register"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setLoginErr(null); setFormErr(null); }}
            className={cls(
              "rounded-lg py-2.5 text-[13px] font-bold tracking-wide transition-all",
              tab === t ? "bg-amber text-ink shadow-md" : "text-fog hover:text-cream"
            )}
          >
            {t === "login" ? "Masuk" : "Daftar"}
          </button>
        ))}
      </div>

      {/* ===== Kartu ===== */}
      <div className="punch-card mt-4 p-5 pt-7 animate-fade-up" style={{ animationDelay: "120ms" }}>
        {tab === "login" ? (
          <form
            onSubmit={(e) => { e.preventDefault(); doLogin(loginNip, loginPin); }}
            className="space-y-4"
          >
            <div>
              <label className="field-label" htmlFor="nip">NIP / ID Karyawan</label>
              <input id="nip" className="field font-mono" placeholder="cth: EMP-1001" value={loginNip}
                onChange={(e) => setLoginNip(e.target.value)} autoComplete="username" />
            </div>
            <div>
              <label className="field-label" htmlFor="pin">PIN (6 digit)</label>
              <div className="relative">
                <input id="pin" className="field font-mono pr-12 tracking-[0.3em]" type={showPin ? "text" : "password"}
                  inputMode="numeric" maxLength={6} placeholder="••••••" value={loginPin}
                  onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, ""))} />
                <button type="button" onClick={() => setShowPin((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-fog hover:text-cream" aria-label="Tampilkan PIN">
                  {showPin ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                </button>
              </div>
            </div>

            {loginErr && <ErrorNote text={loginErr} />}

            <button type="submit" disabled={loginBusy || !loginNip || loginPin.length !== 6}
              className="btn-hard w-full rounded-xl bg-amber py-3.5 font-display text-[17px] tracking-[0.12em] text-ink uppercase flex items-center justify-center gap-2">
              {loginBusy ? <IconSpinner size={20} /> : <>Masuk <IconArrowRight size={18} /></>}
            </button>

            {/* pintasan akun demo */}
            <div className="pt-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-fog-dim mb-2">Akun demo</p>
              <div className="flex gap-2">
                <DemoChip label="Admin · ADMIN01" onClick={() => { setLoginNip("ADMIN01"); setLoginPin("123456"); }} />
                <DemoChip label="Karyawan · EMP-1001" onClick={() => { setLoginNip("EMP-1001"); setLoginPin("111111"); }} />
              </div>
            </div>
          </form>
        ) : (
          <div>
            {/* indikator langkah */}
            <div className="flex items-center gap-2 mb-5">
              {([1, 2, 3] as Step[]).map((s) => (
                <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
                  <span className={cls(
                    "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[12px] font-bold transition-colors",
                    stepDone(s) === "done" && "bg-mint border-mint text-ink",
                    stepDone(s) === "now" && "bg-amber border-amber text-ink",
                    stepDone(s) === "todo" && "border-line text-fog-dim"
                  )}>
                    {stepDone(s) === "done" ? <IconCheck size={13} /> : s}
                  </span>
                  {s < 3 && <span className={cls("h-[2px] flex-1 rounded", step > s ? "bg-mint" : "bg-line")} />}
                </div>
              ))}
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-fog mb-4">
              {step === 1 ? "Langkah 1 — Data diri" : step === 2 ? "Langkah 2 — Foto tanda tangan" : "Langkah 3 — Konfirmasi"}
            </p>

            {step === 1 && (
              <form onSubmit={(e) => { e.preventDefault(); submitStep1(); }} className="space-y-4 animate-fade-in">
                <div>
                  <label className="field-label">Nama lengkap</label>
                  <input className="field" placeholder="cth: Siti Rahma" value={regName} onChange={(e) => setRegName(e.target.value)} />
                </div>
                <div>
                  <label className="field-label">NIP / ID karyawan</label>
                  <input className="field font-mono uppercase" placeholder="cth: EMP-2045" value={regNip}
                    onChange={(e) => setRegNip(e.target.value.toUpperCase())} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">PIN (6 digit)</label>
                    <input className="field font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••••"
                      value={regPin} onChange={(e) => setRegPin(e.target.value.replace(/\D/g, ""))} />
                  </div>
                  <div>
                    <label className="field-label">Ulangi PIN</label>
                    <input className="field font-mono" type="password" inputMode="numeric" maxLength={6} placeholder="••••••"
                      value={regPin2} onChange={(e) => setRegPin2(e.target.value.replace(/\D/g, ""))} />
                  </div>
                </div>
                {formErr && <ErrorNote text={formErr} />}
                <button type="submit" className="btn-hard w-full rounded-xl bg-amber py-3.5 font-display text-[16px] tracking-[0.12em] text-ink uppercase flex items-center justify-center gap-2">
                  Lanjut — Ambil Foto <IconCamera size={18} />
                </button>
              </form>
            )}

            {step === 3 && capture && (
              <div className="animate-fade-in">
                <div className="flex gap-4 items-center">
                  <img src={capture.photo} alt="Foto tanda tangan" className="h-24 w-20 rounded-lg object-cover border-2 border-line" />
                  <div className="text-[12px] space-y-1.5">
                    <p className="flex items-center gap-1.5 text-mint font-bold"><IconCheck size={14} /> Foto tanda tangan diambil</p>
                    <p className={cls("flex items-center gap-1.5 font-semibold", capture.descriptor ? "text-mint" : "text-coral")}>
                      {capture.descriptor ? <IconScanFace size={14} /> : <IconCamera size={14} />}
                      {capture.descriptor ? "Descriptor wajah 128-dim tersimpan" : "Mode simulasi — descriptor sintetis"}
                    </p>
                    {capture.simulated && <p className="text-amber font-semibold">Kamera tidak tersedia — dipakai mode simulasi.</p>}
                  </div>
                </div>
                <div className="mt-4 rounded-lg border border-line bg-pine-950 p-3 text-[12px] text-fog space-y-1 font-mono">
                  <p>Nama&nbsp;&nbsp;: <span className="text-cream">{regName}</span></p>
                  <p>NIP&nbsp;&nbsp;&nbsp;: <span className="text-cream">{regNip}</span></p>
                  <p>Wajah&nbsp;: <span className="text-cream">{capture.simulated ? "simulasi" : "biometrik tersimpan"}</span></p>
                </div>
                {formErr && <div className="mt-3"><ErrorNote text={formErr} /></div>}
                <div className="mt-4 flex gap-2">
                  <button onClick={() => { setStep(2); setCamOpen(true); }}
                    className="btn-hard rounded-xl border border-line bg-pine-800 px-4 py-3 text-[13px] font-bold text-fog">
                    Ulangi Foto
                  </button>
                  <button onClick={submitRegister} disabled={regBusy}
                    className="btn-hard flex-1 rounded-xl bg-mint py-3 font-display text-[16px] tracking-[0.1em] text-ink uppercase flex items-center justify-center gap-2">
                    {regBusy ? <IconSpinner size={20} /> : <>Selesai & Daftar <IconCheck size={18} /></>}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-fog-dim leading-relaxed animate-fade-up" style={{ animationDelay: "180ms" }}>
        Dengan mendaftar, wajah Anda disimpan sebagai <em>referensi tanda tangan</em>.
        <br />Data demo tersimpan lokal di perangkat ini.
      </p>

      <CameraCapture
        open={camOpen}
        title="Foto Tanda Tangan"
        seed={regNip}
        name={regName || "Karyawan"}
        onClose={() => { setCamOpen(false); setStep(1); }}
        onResult={onCapture}
      />
    </div>
  );
}

function ErrorNote({ text }: { text: string }) {
  return (
    <p className="animate-pop rounded-lg border border-coral/40 bg-coral/10 px-3.5 py-2.5 text-[12px] font-semibold text-coral">
      {text}
    </p>
  );
}

function DemoChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex-1 rounded-lg border border-line bg-pine-950 px-2 py-2 text-[10.5px] font-bold text-fog hover:text-amber hover:border-amber/40 transition-colors font-mono">
      {label}
    </button>
  );
}
