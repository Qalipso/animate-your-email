import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest and Playwright both default to picking up `*.spec.ts`. Scoping Vitest to the
    // unit tests keeps `npm run test:unit` from trying to run the browser suite in Node.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
