/**
 * Riwayat absensi pengguna — filter tipe, dikelompokkan per tanggal,
 * foto bukti bisa diperbesar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../state/AppContext";
import * as api from "../lib/api";
import { Modal, Pill, SectionTitle } from "../components/ui";
import { RecordBadge } from "./HomeScreen";
import { cls, dateKey, fmtDate, fmtMeters, fmtTime } from "../lib/utils";
import type { AttendanceRecord, AttendanceType } from "../lib/types";
import { IconSpinner, IconCalendar } from "../components/icons";

type Filter = "all" | AttendanceType;

export default function HistoryScreen() {
  const { token } = useApp();
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [photo, setPhoto] = useState<{ src: string; label: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    const r = await api.myRecords(token);
    if (r.ok) setRecords(r.data);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(
    () => (records ?? []).filter((r) => filter === "all" || r.type === filter),
    [records, filter]
  );

  /* kelompokkan per tanggal */
  const groups = useMemo(() => {
    const map = new Map<string, AttendanceRecord[]>();
    for (const r of filtered) {
      const k = dateKey(r.timestamp);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const totalIn = (records ?? []).filter((r) => r.type === "in").length;

  return (
    <div className="px-5 pt-6 pb-32 max-w-md mx-auto relative z-10">
      <header className="animate-fade-up">
        <h1 className="font-display text-[28px] tracking-wide text-cream uppercase">
          Riwayat<span className="text-amber">.</span>
        </h1>
        <p className="text-[12px] text-fog mt-1">
          {records ? `${records.length} catatan · ${totalIn} hari hadir` : "Memuat…"}
        </p>
      </header>

      {/* filter tipe */}
      <div className="mt-5 flex gap-2 animate-fade-up" style={{ animationDelay: "60ms" }}>
        {([["all", "Semua"], ["in", "Masuk"], ["out", "Pulang"]] as [Filter, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={cls(
              "rounded-full border px-4 py-2 text-[12px] font-bold transition-all active:scale-95",
              filter === v ? "bg-amber border-amber text-ink" : "border-line bg-pine-900 text-fog hover:text-cream"
            )}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-2 animate-fade-up" style={{ animationDelay: "120ms" }}>
        {!records && (
          <div className="grid place-items-center py-20 text-fog">
            <IconSpinner size={28} />
            <p className="mt-3 text-[12px] font-semibold">Mengambil riwayat…</p>
          </div>
        )}

        {records && filtered.length === 0 && (
          <div className="mt-8 rounded-xl border border-dashed border-line py-12 text-center">
            <IconCalendar size={30} className="mx-auto text-fog-dim" />
            <p className="mt-3 text-[13px] font-semibold text-fog">Belum ada catatan{filter !== "all" ? ` tipe "${filter}"` : ""}.</p>
          </div>
        )}

        {groups.map(([day, items]) => (
          <section key={day}>
            <SectionTitle right={<span className="text-[11px] font-mono text-fog-dim">{items.length} catatan</span>}>
              {fmtDate(day)}
            </SectionTitle>
            <ul className="space-y-2">
              {items.map((r) => (
                <li key={r.id} className="punch-card pt-5 pb-3 px-4">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => r.photo && setPhoto({ src: r.photo, label: `${r.type === "in" ? "Masuk" : "Pulang"} · ${fmtTime(r.timestamp)}` })}
                      disabled={!r.photo}
                      className={cls("shrink-0", r.photo && "active:scale-95 transition")}
                      aria-label="Lihat foto bukti"
                    >
                      {r.photo ? (
                        <img src={r.photo} alt="Bukti absensi" className="h-14 w-12 rounded-lg object-cover border-2 border-line" />
                      ) : (
                        <span className="grid h-14 w-12 place-items-center rounded-lg border border-dashed border-line text-fog-dim text-[9px] font-bold">
                          NO&nbsp;PIC
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <RecordBadge type={r.type} />
                        <p className="font-mono font-bold text-cream text-[16px]">{fmtTime(r.timestamp)}</p>
                        {r.simulated && <Pill tone="amber">SIM</Pill>}
                      </div>
                      <p className="mt-1 text-[11px] text-fog font-mono">
                        {fmtMeters(r.distanceM)} dari kantor · wajah Δ{r.faceDistance.toFixed(2)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* penampil foto */}
      <Modal open={!!photo} onClose={() => setPhoto(null)}>
        {photo && (
          <div className="p-4">
            <p className="font-bold text-cream text-[14px] mb-3">{photo.label}</p>
            <img src={photo.src} alt="Bukti absensi" className="w-full rounded-xl border border-line" />
            <button onClick={() => setPhoto(null)}
              className="btn-hard mt-4 w-full rounded-xl bg-cream py-3 font-display tracking-[0.12em] text-ink uppercase text-[14px]">
              Tutup
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
