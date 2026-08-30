/**
 * Presensia — Aplikasi Absensi (PWA-ready, mobile-first).
 * Struktur: AppProvider → gate boot/auth → layar (Beranda / Riwayat / Admin)
 * + navigasi bawah + toast + lapisan latar ambient.
 */
import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./state/AppContext";
import AuthScreen from "./screens/AuthScreen";
import HomeScreen from "./screens/HomeScreen";
import HistoryScreen from "./screens/HistoryScreen";
import AdminScreen from "./screens/AdminScreen";
import { ToastHost } from "./components/ui";
import { IconFingerprint, IconHistory, IconHome, IconShield } from "./components/icons";
import { cls } from "./lib/utils";

type Tab = "home" | "history" | "admin";

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

function Shell() {
  const { booting, user } = useApp();
  const [tab, setTab] = useState<Tab>("home");

  // kembali ke beranda tiap ganti akun
  useEffect(() => setTab("home"), [user?.id]);

  if (booting) return <Splash />;

  return (
    <div className="min-h-dvh app-bg text-cream font-body selection:bg-amber/30">
      <div className="relative z-10 mx-auto min-h-dvh max-w-md border-x border-line-soft/60 bg-ink/35 shadow-2xl shadow-black/50">
        {!user ? (
          <AuthScreen />
        ) : (
          <div key={tab} className="animate-fade-up">
            {tab === "home" && <HomeScreen />}
            {tab === "history" && <HistoryScreen />}
            {tab === "admin" && user.role === "admin" && <AdminScreen />}
            {tab === "admin" && user.role !== "admin" && <NoAccess />}
          </div>
        )}
      </div>

      {user && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-pine-950/95 backdrop-blur-md"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div className="mx-auto flex max-w-md">
            <TabBtn active={tab === "home"} onClick={() => setTab("home")} label="Beranda" icon={<IconHome size={20} />} />
            <TabBtn active={tab === "history"} onClick={() => setTab("history")} label="Riwayat" icon={<IconHistory size={20} />} />
            <TabBtn active={tab === "admin"} onClick={() => setTab("admin")} label="Admin" icon={<IconShield size={20} />}
              dim={user.role !== "admin"} />
          </div>
        </nav>
      )}

      <ToastHost />
    </div>
  );
}

function TabBtn({ active, onClick, label, icon, dim }: {
  active: boolean; onClick: () => void; label: string; icon: React.ReactNode; dim?: boolean;
}) {
  return (
    <button onClick={onClick}
      className={cls(
        "relative flex flex-1 flex-col items-center gap-1 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors",
        active ? "text-amber" : dim ? "text-fog-dim/60" : "text-fog hover:text-cream"
      )}>
      {active && <span className="absolute top-0 h-[3px] w-10 rounded-b bg-amber" />}
      {icon}
      {label}
    </button>
  );
}

function NoAccess() {
  return (
    <div className="px-6 py-24 text-center max-w-md mx-auto">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 border-coral/40 bg-coral/10 text-coral">
        <IconShield size={30} />
      </span>
      <h2 className="font-display text-[24px] tracking-wide uppercase text-cream mt-5">Akses Terbatas</h2>
      <p className="mt-2 text-[13px] text-fog leading-relaxed">
        Dasbor admin hanya untuk akun dengan peran <span className="text-amber font-bold">admin</span>.
        Masuk dengan <span className="font-mono text-cream">ADMIN01 / 123456</span> untuk mencoba.
      </p>
    </div>
  );
}

function Splash() {
  return (
    <div className="min-h-dvh app-bg grid place-items-center">
      <div className="text-center animate-pop relative z-10">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border-2 border-amber bg-pine-800 text-amber shadow-[5px_5px_0_rgba(0,0,0,0.45)]">
          <IconFingerprint size={34} />
        </span>
        <p className="font-display text-[30px] tracking-wide text-cream mt-5">
          PRESENSIA<span className="text-amber">.</span>
        </p>
        <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-fog mt-1.5">
          Memuat mesin absensi<span className="animate-blink text-amber">…</span>
        </p>
      </div>
    </div>
  );
}
