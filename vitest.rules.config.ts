import { defineConfig } from 'vitest/config'

/**
 * Security rules tests run against the Firestore emulator, in node rather than
 * jsdom, and are kept out of the default `npm test` so that the everyday loop
 * stays fast and needs no emulator running. `npm run test:rules` starts one.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/lib/firestore-rules.test.ts'],
    // The emulator is a shared resource; parallel files would race on it.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
