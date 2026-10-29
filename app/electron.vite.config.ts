import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

const root = import.meta.dirname

export default defineConfig({
  main: {
    build: { rolldownOptions: { input: { index: resolve(root, 'electron/main.ts') } } },
  },
  preload: {
    build: { rolldownOptions: { input: { index: resolve(root, 'electron/preload.ts') } } },
  },
  renderer: {
    root,
    build: { rolldownOptions: { input: { index: resolve(root, 'index.html') } } },
    plugins: [react()],
  },
})
