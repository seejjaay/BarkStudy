import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Main and preload are emitted as CommonJS (.cjs): sandboxed preloads cannot be ES modules, and koffi is loaded with require.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { overlay: resolve('src/preload/overlay.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    build: {
      rollupOptions: {
        input: { overlay: resolve('src/renderer/overlay/index.html') },
      },
    },
  },
});
