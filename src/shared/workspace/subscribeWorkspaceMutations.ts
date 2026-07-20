import type { WorkspaceMutationDetail } from "./workspaceMutation";

/**
 * One debounced subscription point for renderer cache consumers. It keeps the
 * event transport and debounce semantics consistent while each surface supplies
 * only its relevance test.
 */
export function subscribeWorkspaceMutations(options: {
  eventName?: "local-notion:workspace-graph-mutated" | "local-notion:workspace-data-mutated";
  debounceMs?: number;
  accepts?: (detail: WorkspaceMutationDetail) => boolean;
  onAccepted: (detail: WorkspaceMutationDetail) => void;
}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const eventName = options.eventName || "local-notion:workspace-data-mutated";
  const debounceMs = Math.max(0, Number(options.debounceMs ?? 300));
  let timer: number | null = null;
  let latest: WorkspaceMutationDetail | null = null;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<WorkspaceMutationDetail>).detail;
    if (!detail || (options.accepts && !options.accepts(detail))) return;
    latest = detail;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      if (latest) options.onAccepted(latest);
      latest = null;
    }, debounceMs);
  };
  window.addEventListener(eventName, listener as EventListener);
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener(eventName, listener as EventListener);
  };
}
