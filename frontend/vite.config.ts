import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Webview serves assets from a vscode-resource URI, so emit relative asset paths.
  base: './',
  define: {
    // Excalidraw's package entrypoint reads this Node-style env flag in the browser bundle.
    'process.env.IS_PREACT': JSON.stringify('false'),
  },
  build: {
    outDir: '../extension/dist/webview',
    emptyOutDir: true,
  },
});
