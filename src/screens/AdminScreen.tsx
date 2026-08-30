/**
 * Dasbor Admin — statistik ringkas, daftar seluruh absensi dengan filter
 * (tanggal / pengguna / tipe), pengaturan titik + radius kantor, dan daftar
 * karyawan terdaftar beserta status tanda tangan wajahnya.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import * as api from "../lib/api";
import { Avatar, Pill, SectionTitle } from "../components/ui";
import { RecordBadge } from "./HomeScreen";
import { cls, dateKey, fmtMeters, fmtTime, todayKey } from "../lib/utils";
import type { AttendanceRecord, AttendanceType, SafeUser } from "../lib/types";
import { IconCalendar, IconFilter, IconLocate, IconMapPin, IconRefresh, IconSliders, IconSpinner, IconUsers, IconCheck } from "../components/icons";
import { getPosition } from "../lib/geo";

export default function AdminScreen() {
  const { token, office, refreshOffice, toast } = useApp();

  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [users, setUsers] = useState<SafeUser[]>([]);
  const [loading, setLoading] = useState(true);

  /* filter */
  const [fDate, setFDate] = useState("");
  const [fUser, setFUser] = useState("");
  const [fType, setFType] = useState<"" | AttendanceType>("");

  /* form pengaturan kantor */
  const [cfg, setCfg] = useState({ lat: "", lng: "", radiusM: 150, demoGps: true });
  const [cfgBusy, setCfgBusy] = useState(false);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (office) setCfg({ lat: String(office.lat), lng: String(office.lng), radiusM: office.radiusM, demoGps: office.demoGps });
  }, [office]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    const [rec, usr] = await Promise.all([
      api.allRecords(token, { date: fDate || undefined, userId: fUser || undefined, type: fType || undefined }),
      api.allUsers(token),
    ]);
    if (rec.ok) setRecords(rec.data);
    if (usr.ok) setUsers(usr.data);
    setLoading(false);
  }, [token, fDate, fUser, fType]);

  useEffect(() => { load(); }, [load]);

  /* statistik */
  const today = todayKey();
  const stats = useMemo(() => {
    const all = records ?? [];
    const todayRecs = all.filter((r) => dateKey(r.timestamp) === today);
    const uniqueToday = new Set(todayRecs.filter((r) => r.type === "in").map((r) => r.userId));
    const simulated = all.filter((r) => r.simulated).length;
    return { todayCount: todayRecs.length, hadir: uniqueToday.size, total: all.length, simulated };
  }, [records, today]);

  const hasFilter = !!(fDate || fUser || fType);

  const useMyLocation = async () => {
    if (!office) return;
    setLocating(true);
    try {
      // pakai kantor saat ini hanya untuk demo flag; ambil lokasi asli perangkat
      const probeOffice = { ...office, demoGps: false };
      const pos = await getPosition(probeOffice);
      setCfg((c) => ({ ...c, lat: pos.lat.toFixed(6), lng: pos.lng.toFixed(6) }));
      toast("Titik kantor diisi dari lokasi Anda saat ini.", "success");
    } catch (e: any) {
      toast(e?.message ?? "Gagal mengambil lokasi.", "error");
    } finally {
      setLocating(false);
    }
  };

  const saveOffice = async () => {
    const lat = parseFloat(cfg.lat);
    const lng = parseFloat(cfg.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return toast("Koordinat harus berupa angka.", "error");
    setCfgBusy(true);
    const r = await api.updateOffice(token, { lat, lng, radiusM: cfg.radiusM, demoGps: cfg.demoGps });
    setCfgBusy(false);
    if (r.ok) {
      await refreshOffice();
      toast("Pengaturan kantor disimpan.", "success");
    } else toast(r.error.message, "error");
  };

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "—";

  return (
    <div className="px-5 pt-6 pb-32 max-w-md mx-auto relative z-10">
      <header className="animate-fade-up flex items-start justify-between">
        <div>
          <h1 className="font-display text-[28px] tracking-wide text-cream uppercase">
            Admin<span className="text-amber">.</span>
          </h1>
          <p className="text-[12px] text-fog mt-1">Pantauan & pengaturan absensi</p>
        </div>
        <button onClick={load} className="p-2.5 rounded-lg border border-line bg-pine-800 text-fog hover:text-amber active:scale-95 transition" aria-label="Muat ulang">
          <IconRefresh size={17} />
        </button>
      </header>

      {/* ===== Statistik ===== */}
      <section className="grid grid-cols-3 gap-2.5 mt-5 animate-fade-up" style={{ animationDelay: "60ms" }}>
        <Stat label="Hadir hari ini" value={loading ? "…" : String(stats.hadir)} tone="text-mint" />
        <Stat label="Catatan hari ini" value={loading ? "…" : String(stats.todayCount)} tone="text-amber" />
        <Stat label="Total (filter)" value={loading ? "…" : String(stats.total)} tone="text-cream" />
      </section>

      {/* ===== Filter ===== */}
      <SectionTitle><span className="flex items-center gap-1.5"><IconFilter size={15} className="text-amber" /> Filter Log</span></SectionTitle>
      <div className="punch-card pt-6 pb-4 px-4 space-y-3 animate-fade-up" style={{ animationDelay: "100ms" }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Tanggal</label>
            <input type="date" className="field font-mono text-[13px]" value={fDate} onChange={(e) => setFDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label">Tipe</label>
            <select className="field text-[13px]" value={fType} onChange={(e) => setFType(e.target.value as any)}>
              <option value="">Semua</option>
              <option value="in">Masuk</option>
              <option value="out">Pulang</option>
            </select>
          </div>
        </div>
        <div>
          <label className="field-label">Karyawan</label>
          <select className="field text-[13px]" value={fUser} onChange={(e) => setFUser(e.target.value)}>
            <option value="">Semua karyawan</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name} · {u.employeeId}</option>
            ))}
          </select>
        </div>
        {hasFilter && (
          <button onClick={() => { setFDate(""); setFUser(""); setFType(""); }}
            className="text-[11px] font-bold text-coral underline underline-offset-2">
            Hapus semua filter
          </button>
        )}
      </div>

      {/* ===== Daftar log ===== */}
      <SectionTitle right={<span className="text-[11px] font-mono text-fog-dim">{records?.length ?? 0} hasil</span>}>
        Log Absensi
      </SectionTitle>
      <div className="animate-fade-up" style={{ animationDelay: "140ms" }}>
        {loading && (
          <div className="grid place-items-center py-12 text-fog"><IconSpinner size={26} /><p className="mt-2 text-[12px] font-semibold">Memuat log…</p></div>
        )}
        {!loading && (records ?? []).length === 0 && (
          <div className="rounded-xl border border-dashed border-line py-10 text-center">
            <IconCalendar size={28} className="mx-auto text-fog-dim" />
            <p className="mt-2 text-[13px] font-semibold text-fog">Tidak ada catatan yang cocok dengan filter.</p>
          </div>
        )}
        <ul className="space-y-2">
          {(records ?? []).slice(0, 60).map((r) => (
            <li key={r.id} className="punch-card pt-5 pb-3 px-4">
              <div className="flex items-center gap-3">
                <Avatar photo={users.find((u) => u.id === r.userId)?.photo ?? null} name={r.userName} size={38} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-bold text-cream text-[13px] truncate">{r.userName}</p>
                    <RecordBadge type={r.type} />
                    {r.simulated && <Pill tone="amber">SIM</Pill>}
                  </div>
                  <p className="mt-0.5 text-[11px] font-mono text-fog">
                    {new Date(r.timestamp).toLocaleDateString("id-ID", { day: "numeric", month: "short" })} · {fmtTime(r.timestamp)} · {fmtMeters(r.distanceM)} · Δ{r.faceDistance.toFixed(2)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
        {(records ?? []).length > 60 && (
          <p className="mt-3 text-center text-[11px] text-fog-dim">Menampilkan 60 terbaru — persempit filter untuk lainnya.</p>
        )}
      </div>

      {/* ===== Pengaturan kantor ===== */}
      <SectionTitle><span className="flex items-center gap-1.5"><IconSliders size={15} className="text-amber" /> Titik & Radius Kantor</span></SectionTitle>
      <div className="punch-card pt-6 pb-4 px-4 space-y-4 animate-fade-up" style={{ animationDelay: "180ms" }}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Latitude</label>
            <input className="field font-mono text-[13px]" inputMode="decimal" value={cfg.lat} onChange={(e) => setCfg({ ...cfg, lat: e.target.value })} />
          </div>
          <div>
            <label className="field-label">Longitude</label>
            <input className="field font-mono text-[13px]" inputMode="decimal" value={cfg.lng} onChange={(e) => setCfg({ ...cfg, lng: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="field-label flex items-center justify-between">
            <span>Radius diizinkan</span>
            <span className="font-mono text-amber">{cfg.radiusM} m</span>
          </label>
          <input type="range" min={25} max={1000} step={25} value={cfg.radiusM}
            onChange={(e) => setCfg({ ...cfg, radiusM: +e.target.value })}
            className="w-full accent-[#F5B84B]" />
          <div className="flex justify-between text-[10px] font-mono text-fog-dim"><span>25 m</span><span>1000 m</span></div>
        </div>

        <button onClick={useMyLocation} disabled={locating}
          className="w-full flex items-center justify-center gap-2 rounded-lg border border-teal/40 bg-teal/10 py-2.5 text-[12px] font-bold text-teal active:scale-[0.98] transition disabled:opacity-50">
          {locating ? <IconSpinner size={15} /> : <IconLocate size={15} />}
          Gunakan lokasi saya sekarang
        </button>

        {/* toggle demo GPS */}
        <button onClick={() => setCfg({ ...cfg, demoGps: !cfg.demoGps })}
          className={cls(
            "w-full flex items-center justify-between rounded-lg border px-3.5 py-3 text-left transition-colors",
            cfg.demoGps ? "border-amber/50 bg-amber/10" : "border-line bg-pine-950"
          )}>
          <span>
            <span className={cls("block text-[13px] font-bold", cfg.demoGps ? "text-amber" : "text-cream")}>Mode Demo GPS</span>
            <span className="block text-[11px] text-fog mt-0.5">Simulasikan posisi di titik kantor — untuk uji coba alur sukses.</span>
          </span>
          <span className={cls(
            "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
            cfg.demoGps ? "bg-amber border-amber" : "bg-pine-700 border-line"
          )}>
            <span className={cls("absolute top-0.5 h-4.5 w-4.5 rounded-full bg-ink transition-all", cfg.demoGps ? "left-[22px]" : "left-0.5")} style={{ height: 18, width: 18 }} />
          </span>
        </button>

        <button onClick={saveOffice} disabled={cfgBusy}
          className="btn-hard w-full rounded-xl bg-amber py-3.5 font-display text-[15px] tracking-[0.12em] text-ink uppercase flex items-center justify-center gap-2">
          {cfgBusy ? <IconSpinner size={18} /> : <><IconCheck size={17} /> Simpan Pengaturan</>}
        </button>
        {office && (
          <p className="text-[10px] font-mono text-fog-dim text-center">
            Terakhir diperbarui {new Date(office.updatedAt).toLocaleString("id-ID")} · validasi ulang di sisi server
          </p>
        )}
      </div>

      {/* ===== Karyawan terdaftar ===== */}
      <SectionTitle right={<span className="text-[11px] font-mono text-fog-dim">{users.length} akun</span>}>
        <span className="flex items-center gap-1.5"><IconUsers size={15} className="text-amber" /> Karyawan Terdaftar</span>
      </SectionTitle>
      <ul className="space-y-2 animate-fade-up" style={{ animationDelay: "220ms" }}>
        {users.map((u) => (
          <li key={u.id} className="punch-card pt-5 pb-3 px-4 flex items-center gap-3">
            <Avatar photo={u.photo} name={u.name} size={40} />
            <div className="min-w-0 flex-1">
              <p className="font-bold text-cream text-[13px] truncate">{u.name}</p>
              <p className="text-[11px] font-mono text-fog-dim">{u.employeeId} · {u.role === "admin" ? "Admin" : "Karyawan"}</p>
            </div>
            <Pill tone={u.hasDescriptor ? "mint" : "fog"}>{u.hasDescriptor ? "WAJAH OK" : "TANPA FOTO"}</Pill>
          </li>
        ))}
      </ul>

      <div className="mt-6 rounded-xl border border-line bg-pine-900 p-4 text-[11px] text-fog leading-relaxed">
        <p className="flex items-center gap-1.5 font-bold text-teal mb-1"><IconMapPin size={13} /> Catatan keamanan</p>
        Radius & koordinat diverifikasi ulang di sisi server setiap absensi — pengaturan di sini hanya mengubah aturan, bukan melonggarkan validasi.
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="punch-card pt-6 pb-3.5 px-3 text-center">
      <p className={cls("font-display text-[26px] leading-none", tone)}>{value}</p>
      <p className="mt-1.5 text-[9.5px] font-bold uppercase tracking-[0.1em] text-fog leading-tight">{label}</p>
    </div>
  );
}
