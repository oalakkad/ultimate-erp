import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The web app calls the API on the same origin (/api → the API on port 3000). The browser's Host
// header (e.g. acme.localhost:5173) is passed through unchanged, so the API resolves the company
// from it — exactly like production behind a reverse proxy — and session cookies stay host-only.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    },
  },
});
