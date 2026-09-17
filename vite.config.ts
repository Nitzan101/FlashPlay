import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Security rules tests (and room.ts's client-contract tests, which also
    // need real Firestore to prove the claim/retry loop against) need the
    // Firestore emulator and a node environment. They run separately via
    // `npm run test:rules` so the everyday loop stays fast and does not
    // depend on an emulator being up.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'src/lib/firestore-rules.test.ts',
      'src/lib/room.test.ts',
      'src/lib/harvest.test.ts',
      'src/lib/rounds.test.ts',
      'src/lib/secondGame.test.ts',
      'src/lib/memory.test.ts',
      'src/lib/evening.test.ts',
      'src/lib/profile.test.ts',
      'src/lib/profileQuestions.test.ts',
    ],
  },
})
