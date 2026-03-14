import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'main.js',
        assetFileNames: 'main.css',
        manualChunks: undefined,
      },
    },
    assetsInlineLimit: 100000,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 800,
  },
});
