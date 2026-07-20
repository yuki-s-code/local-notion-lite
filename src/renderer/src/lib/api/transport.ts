export type ApiTransport = {
  getJson<T = any>(path: string, init?: RequestInit): Promise<T>;
  postJson<T = any>(path: string, body: unknown, signal?: AbortSignal): Promise<T>;
  putJson<T = any>(path: string, body: unknown): Promise<T>;
  patchJson<T = any>(path: string, body: unknown): Promise<T>;
  deleteJson<T = any>(path: string): Promise<T>;
  pathId(value: string): string;
};
