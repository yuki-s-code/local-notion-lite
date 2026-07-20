import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { getSaveRetryPlan } from "../../../shared/persistence/retryPolicy";

export type SaveRecoveryEntry = { label: string; attempt: number; exhausted: boolean };

/** Shared retry/backoff policy for page, journal and database saves. */
export function useSaveRecovery(options: {
  setRecovery: Dispatch<SetStateAction<Record<string, SaveRecoveryEntry>>>;
  setStatus: (message: string) => void;
}) {
  const timersRef = useRef<Record<string, number | null>>({});
  const attemptsRef = useRef<Record<string, number>>({});
  const clear = (kind: string) => {
    const timer = timersRef.current[kind];
    if (timer) window.clearTimeout(timer);
    timersRef.current[kind] = null;
    attemptsRef.current[kind] = 0;
    options.setRecovery((prev) => {
      if (!prev[kind]) return prev;
      const next = { ...prev }; delete next[kind]; return next;
    });
  };
  const schedule = (kind: string, label: string, retry: () => Promise<unknown>) => {
    if (timersRef.current[kind]) return;
    const { attempt, delayMs, exhausted } = getSaveRetryPlan(attemptsRef.current[kind] || 0);
    attemptsRef.current[kind] = attempt;
    options.setRecovery((prev) => ({ ...prev, [kind]: { label, attempt, exhausted } }));
    if (exhausted || delayMs === null) {
      options.setStatus(`${label}の保存に繰り返し失敗しています。未保存の内容を保持しています。［今すぐ再試行］を押してください。`);
      return;
    }
    options.setStatus(`${label}の保存に失敗しました。${Math.ceil(delayMs / 1000)}秒後に自動再試行します（${attempt}/3）。`);
    timersRef.current[kind] = window.setTimeout(() => {
      timersRef.current[kind] = null;
      void retry().catch(() => undefined);
    }, delayMs);
  };
  const resetAll = () => {
    (Object.values(timersRef.current) as Array<number | null>).forEach((timer) => { if (timer) window.clearTimeout(timer); });
    timersRef.current = {}; attemptsRef.current = {}; options.setRecovery({});
  };
  useEffect(() => () => resetAll(), []);
  return { clear, schedule, resetAll, timersRef, attemptsRef };
}
