import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: { rollupOptions: { input: { main: resolve(__dirname, 'src/main/main.ts') } } }
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: { rollupOptions: { input: { preload: resolve(__dirname, 'src/main/preload.ts') } } }
    },
    renderer: {
        root: 'src/renderer',
        plugins: [react()],
        resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') } }
    }
});
