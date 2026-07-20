import { useEffect, useRef } from "react";

export type ElectronBootstrapPayload = {
  apiUrl: string;
  apiToken?: string;
  sharedRoot: string;
  privatePagesRoot?: string;
  privateDatabasesRoot?: string;
  ocrBinaryPath?: string;
  popplerBinaryPath?: string;
};

/** Keeps Electron bootstrap subscription independent from the workspace screen. */
export function useElectronBootstrap(options: {
  onBootstrap: (payload: ElectronBootstrapPayload) => void;
  onError: (message: string) => void;
  onStartupProgress?: (progress: { stage: string; title?: string; message: string; detail?: string }) => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    const localNotion = (window as any).localNotion as {
      getBootstrap?: () => Promise<ElectronBootstrapPayload | null>;
      getStartupProgress?: () => Promise<{ stage: string; title?: string; message: string; detail?: string } | null>;
      onReady?: (listener: (payload: ElectronBootstrapPayload | null) => void) => (() => void) | undefined;
      onStartupProgress?: (listener: (progress: { stage: string; title?: string; message: string; detail?: string }) => void) => (() => void) | undefined;
    } | undefined;
    if (!localNotion?.getBootstrap) {
      optionsRef.current.onError("Electron preload が見つかりません。本文リンクはアプリ内遷移で開いてください。");
      return;
    }
    let disposed = false;
    const apply = (payload: ElectronBootstrapPayload | null) => {
      if (!payload || disposed) return;
      optionsRef.current.onBootstrap(payload);
    };
    const unsubscribe = localNotion.onReady?.(apply);
    const unsubscribeProgress = localNotion.onStartupProgress?.((progress) => optionsRef.current.onStartupProgress?.(progress));
    void localNotion.getStartupProgress?.().then((progress) => {
      if (progress && !disposed) optionsRef.current.onStartupProgress?.(progress);
    }).catch(() => undefined);
    void localNotion.getBootstrap().then(apply).catch((error: any) =>
      optionsRef.current.onError(error?.message ?? "起動情報を取得できませんでした"),
    );
    return () => { disposed = true; unsubscribe?.(); unsubscribeProgress?.(); };
  }, []);
}
