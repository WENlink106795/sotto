import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Renderer-only preview for UI work and screenshots. No Electron preload is
// present here, so the renderer falls back to its built-in demo bridge.
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  resolve: {
    alias: {
      '@shared': resolve('src/shared'),
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve('out/renderer-web'),
    emptyOutDir: true
  }
})
