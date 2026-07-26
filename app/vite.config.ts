import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves the demo from /<repo>/, so asset URLs need that prefix — but only
  // there. Local dev, `vite preview`, and the E2E run all stay at '/', which is why this is
  // an env var set by the deploy workflow rather than a hardcoded base.
  base: process.env.DEPLOY_BASE ?? '/',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
