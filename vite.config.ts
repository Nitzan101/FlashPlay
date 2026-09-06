import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Security rules tests need the Firestore emulator and a node environment.
    // They run separately via `npm run test:rules` so the everyday loop stays
    // fast and does not depend on an emulator being up.
    exclude: ['**/node_modules/**', '**/dist/**', 'src/lib/firestore-rules.test.ts'],
  },
})
