import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  build: { outDir: 'dist/web', sourcemap: false },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/mcp': 'http://localhost:8787', '/s/': 'http://localhost:8787' },
  },
});
