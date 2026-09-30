import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false, target: 'es2022' },
  server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  test: { include: ['tests/**/*.test.ts'], root: '.' },
});
