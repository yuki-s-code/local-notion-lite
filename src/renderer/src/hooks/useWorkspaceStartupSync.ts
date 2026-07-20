import { useEffect, useRef } from "react";

type RefreshOptions = Record<string, boolean>;
type Priority = "save" | "manual" | "startup" | "periodic";
/** Initial local-cache hydration followed by idle shared-folder import. */
export function useWorkspaceStartupSync(options: {
  apiUrl: string; enabled: boolean;
  loadHealth: () => Promise<unknown>;
  enqueue: (message: string, options: RefreshOptions, priority: Priority) => Promise<unknown>;
  setStatus: (message: string) => void;
  onInitialLocalReady?: () => void;
  onInitialLocalError?: (message: string) => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    const current = optionsRef.current;
    if (!current.enabled) return;
    let cancelled = false;
    void current.loadHealth().catch(() => undefined);
    void current.enqueue("起動しました", { health:true, tree:true, databases:true, journals:true }, "startup")
      .then(() => { if (!cancelled) current.onInitialLocalReady?.(); })
      .catch((err: any) => {
        if (cancelled) return;
        const message = err?.message ?? "起動データを読み込めませんでした";
        current.setStatus(message);
        current.onInitialLocalError?.(message);
      });
    let idleId: number | null = null;
    const runImport = () => {
      if (cancelled) return;
      void current.enqueue("共有フォルダを同期しました", { importShared:true, health:false, tree:true, databases:true, journals:true, trash:true, inbox:true, tasks:true, dashboard:true }, "startup")
        .catch((err: any) => { if (!cancelled) current.setStatus(`共有フォルダ同期: ${err?.message ?? "失敗しました"}`); });
    };
    const timer = window.setTimeout(() => {
      const requestIdle = (window as any).requestIdleCallback as undefined | ((callback: () => void, opts?: { timeout?: number }) => number);
      if (requestIdle) idleId = requestIdle(runImport, { timeout: 4000 }); else runImport();
    }, 2200);
    return () => { cancelled=true; window.clearTimeout(timer); (window as any).cancelIdleCallback?.(idleId); };
  }, [options.apiUrl, options.enabled]);
}
