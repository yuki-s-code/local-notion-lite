export {};

declare global {
  interface Window {
    localNotion: {
      getBootstrap: () => Promise<{ apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string } | null>;
      onReady: (callback: (payload: { apiUrl: string; apiToken?: string; sharedRoot: string; localDbPath?: string; privatePagesRoot?: string; privateDatabasesRoot?: string; ocrBinaryPath?: string; popplerBinaryPath?: string }) => void) => () => void;
      chooseSharedRoot: () => Promise<string | null>;
      chooseLocalDbPath: () => Promise<string | null>;
      useAutoLocalDbPath: () => Promise<boolean>;
      choosePrivatePagesRoot: () => Promise<string | null>;
      choosePrivateDatabasesRoot: () => Promise<string | null>;
      chooseTransformerModelRoot: () => Promise<string | null>;
      chooseGenerationModelRoot: () => Promise<string | null>;
      chooseSemanticCacheDir: () => Promise<string | null>;
      chooseGenerationExecutable: () => Promise<string | null>;
      chooseGenerationRuntimeDir: () => Promise<string | null>;
      chooseOcrBinary: () => Promise<string | null>;
      resetOcrBinary: () => Promise<boolean>;
      choosePopplerFolder: () => Promise<string | null>;
      choosePopplerBinary: () => Promise<string | null>;
      resetPopplerBinary: () => Promise<boolean>;
      resetPrivatePagesRoot: () => Promise<boolean>;
      resetPrivateDatabasesRoot: () => Promise<boolean>;
      chooseAttachment: () => Promise<string[]>;
      openExternalHttpUrl: (url: string) => Promise<boolean>;
      onBeforeQuit: (callback: (requestId: string) => void) => () => void;
      notifySaveFlushComplete: (requestId: string) => void;
    };
  }
}
