/**
 * Komponen UI bersama: Modal (bottom-sheet mobile), ToastHost, Avatar,
 * Pill status, dan stempel hasil absensi.
 */
import type { ReactNode } from "react";
import { useApp } from "../state/AppContext";
import { cls, initials } from "../lib/utils";
import { IconAlert, IconCheck, IconClose } from "./icons";

/* ---------------- Modal bottom-sheet ---------------- */
export function Modal({
  open,
  onClose,
  children,
  full = false,
  locked = false,
}: {
  open: boolean;
  onClose?: () => void;
  children: ReactNode;
  /** true = tinggi penuh (kamera) */
  full?: boolean;
  /** true = tidak bisa ditutup dengan tap latar */
  locked?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-[2px] animate-fade-in"
        onClick={locked ? undefined : onClose}
      />
      <div
        className={cls(
          "relative w-full sm:max-w-md bg-pine-900 border border-line animate-fade-up overflow-hidden",
          full ? "h-[100dvh] sm:h-[85dvh] sm:rounded-2xl" : "max-h-[88dvh] rounded-t-2xl sm:rounded-2xl"
        )}
      >
        {children}
      </div>
    </div>
  );
}

/* ---------------- Toast ---------------- */
export function ToastHost() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="fixed inset-x-0 bottom-24 z-[70] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={cls(
            "pointer-events-auto animate-toast flex items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-[13px] font-semibold shadow-xl shadow-black/40 max-w-sm",
            t.kind === "success" && "bg-mint-deep/20 border-mint/40 text-mint",
            t.kind === "error" && "bg-coral-deep/20 border-coral/40 text-coral",
            t.kind === "info" && "bg-pine-700/90 border-line text-cream"
          )}
        >
          <span className="shrink-0">
            {t.kind === "success" ? <IconCheck size={16} /> : t.kind === "error" ? <IconAlert size={16} /> : <IconClose size={16} className="opacity-0" />}
          </span>
          {t.text}
        </button>
      ))}
    </div>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar({ photo, name, size = 40 }: { photo: string | null; name: string; size?: number }) {
  return photo ? (
    <img
      src={photo}
      alt={name}
      style={{ width: size, height: size }}
      className="rounded-full object-cover border-2 border-line shrink-0"
    />
  ) : (
    <span
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      className="rounded-full bg-pine-700 border-2 border-line grid place-items-center font-bold text-amber shrink-0"
    >
      {initials(name)}
    </span>
  );
}

/* ---------------- Pill status kecil ---------------- */
export function Pill({
  tone,
  children,
  pulse = false,
}: {
  tone: "mint" | "coral" | "amber" | "fog" | "teal";
  children: ReactNode;
  pulse?: boolean;
}) {
  const tones: Record<string, string> = {
    mint: "bg-mint/10 border-mint/35 text-mint",
    coral: "bg-coral/10 border-coral/35 text-coral",
    amber: "bg-amber/10 border-amber/35 text-amber",
    fog: "bg-pine-700/60 border-line text-fog",
    teal: "bg-teal/10 border-teal/35 text-teal",
  };
  const dots: Record<string, string> = {
    mint: "bg-mint",
    coral: "bg-coral",
    amber: "bg-amber",
    fog: "bg-fog",
    teal: "bg-teal",
  };
  return (
    <span className={cls("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide", tones[tone])}>
      <span className="relative flex h-1.5 w-1.5">
        {pulse && <span className={cls("absolute inline-flex h-full w-full rounded-full animate-ping-dot", dots[tone])} />}
        <span className={cls("relative inline-flex h-1.5 w-1.5 rounded-full", dots[tone])} />
      </span>
      {children}
    </span>
  );
}

/* ---------------- Judul seksi ---------------- */
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5 mt-6 first:mt-0">
      <h2 className="font-display text-[15px] tracking-[0.08em] text-cream uppercase flex items-center gap-2">
        <span className="h-3.5 w-1 bg-amber rounded-sm inline-block" />
        {children}
      </h2>
      {right}
    </div>
  );
}
