import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

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
    rollupOptions: {
      input: {
        // Existing Excalidraw canvas (used by .codetrace files).
        index: resolve(__dirname, 'index.html'),
        // Call-graph webview (used by codetrace.openCallGraph command).
        callgraph: resolve(__dirname, 'callgraph.html'),
      },
    },
  },
});
