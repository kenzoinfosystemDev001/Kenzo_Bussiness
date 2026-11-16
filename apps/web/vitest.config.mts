import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./', import.meta.url)) } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    css: false,
    // jsdom 27 loads ESM via require(); Node 20.18 needs this flag (default-on from Node 20.19).
    execArgv: ['--experimental-require-module', '--no-warnings'],
  },
});
