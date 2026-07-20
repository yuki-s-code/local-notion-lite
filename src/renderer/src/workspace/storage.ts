export type VersionedJsonStore<T> = {
  read(): T;
  write(value: T): void;
  clear(): void;
};

export function createVersionedJsonStore<T>(options: {
  key: string;
  legacyKeys?: string[];
  fallback: () => T;
  sanitize: (raw: unknown) => T;
}): VersionedJsonStore<T> {
  const keys = [options.key, ...(options.legacyKeys || [])];
  return {
    read() {
      if (typeof window === "undefined") return options.fallback();
      for (const key of keys) {
        try {
          const raw = window.localStorage.getItem(key);
          if (!raw) continue;
          const value = options.sanitize(JSON.parse(raw));
          if (key !== options.key) {
            try { window.localStorage.setItem(options.key, JSON.stringify(value)); } catch { /* preference only */ }
          }
          return value;
        } catch { /* try next migration source */ }
      }
      return options.fallback();
    },
    write(value) {
      if (typeof window === "undefined") return;
      try { window.localStorage.setItem(options.key, JSON.stringify(value)); } catch { /* preference only */ }
    },
    clear() {
      if (typeof window === "undefined") return;
      keys.forEach((key) => {
        try { window.localStorage.removeItem(key); } catch { /* preference only */ }
      });
    },
  };
}
