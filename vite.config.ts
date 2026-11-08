import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'cloudflare' ? [cloudflare()] : [])],
  build: { outDir: 'dist/client' },
  server: { proxy: mode === 'cloudflare' ? undefined : { '/api': 'http://127.0.0.1:8788' } },
}));
