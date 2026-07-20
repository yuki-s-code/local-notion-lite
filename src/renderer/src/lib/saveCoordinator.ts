/**
 * Small shared helper for debounced/queued save pipelines.
 * It asks a pipeline to enqueue its most recent snapshot, then waits for the
 * currently active drain promise. This preserves the existing save ownership
 * in each feature while making cross-screen flush behaviour consistent.
 */
export async function flushQueuedSave(options: {
  shouldFlush: boolean;
  requestSave: () => Promise<unknown>;
  getDrain: () => Promise<void> | null;
}): Promise<void> {
  if (!options.shouldFlush) return;
  await options.requestSave();
  await (options.getDrain() ?? Promise.resolve());
}
