/**
 * State global aplikasi: sesi login, konfigurasi kantor, status model AI,
 * dan sistem toast. Dipakai semua layar.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { OfficeConfig, SafeUser, Session } from "../lib/types";
import * as api from "../lib/api";
import { loadModels, type ModelProgress } from "../lib/face";
import { uid } from "../lib/utils";

export interface Toast {
  id: string;
  kind: "success" | "error" | "info";
  text: string;
}

interface AppState {
  booting: boolean;
  user: SafeUser | null;
  token: string | null;
  office: OfficeConfig | null;
  model: ModelProgress;
  toasts: Toast[];
  setSession: (s: Session) => void;
  signOut: () => void;
  refreshOffice: () => Promise<void>;
  toast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: string) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [session, setSessionState] = useState<Session | null>(null);
  const [office, setOffice] = useState<OfficeConfig | null>(null);
  const [model, setModel] = useState<ModelProgress>({ status: "idle", loaded: 0, total: 3, label: "Menyiapkan…" });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Record<string, number>>({});

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = uid("t");
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    timers.current[id] = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      delete timers.current[id];
    }, 3800);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    if (timers.current[id]) window.clearTimeout(timers.current[id]);
  }, []);

  const refreshOffice = useCallback(async () => {
    setOffice(await api.getOffice());
  }, []);

  // Boot: seed data demo → pulihkan sesi → muat kantor & model AI paralel.
  useEffect(() => {
    api.seedIfNeeded();
    (async () => {
      const s = await api.restoreSession();
      if (s) setSessionState(s);
      setOffice(await api.getOffice());
      setBooting(false);
    })();
    loadModels(setModel);
    return () => Object.values(timers.current).forEach((t) => window.clearTimeout(t));
  }, []);

  const value = useMemo<AppState>(
    () => ({
      booting,
      user: session?.user ?? null,
      token: session?.token ?? null,
      office,
      model,
      toasts,
      setSession: (s) => setSessionState(s),
      signOut: () => {
        api.logout();
        setSessionState(null);
      },
      refreshOffice,
      toast,
      dismissToast,
    }),
    [booting, session, office, model, toasts, refreshOffice, toast, dismissToast]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp harus dipakai di dalam AppProvider");
  return ctx;
}
