import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const root = import.meta.dirname

const csp =
  "default-src 'self'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'"

// Injected only into production builds: the dev server needs an inline React refresh preamble.
function cspPlugin(): Plugin {
  return {
    name: 'aiplot-csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: csp },
        injectTo: 'head-prepend',
      },
    ],
  }
}

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
    plugins: [react(), cspPlugin()],
  },
})
