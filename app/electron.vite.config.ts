import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'
import { strings } from './src/strings'

const root = import.meta.dirname

const csp =
  "default-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'; connect-src 'self' http://127.0.0.1:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'"

// Fills the placeholder right after <meta charset> in production builds only:
// the dev server needs an inline React refresh preamble.
function cspPlugin(): Plugin {
  return {
    name: 'aiplot-csp',
    transformIndexHtml: (html, ctx) => {
      const placeholder = '<!-- csp -->'
      if (!html.includes(placeholder)) throw new Error('index.html must contain <!-- csp -->')
      const meta = ctx.server
        ? ''
        : `<meta http-equiv="Content-Security-Policy" content="${csp}" />`
      return html.replace(placeholder, meta)
    },
  }
}

function titlePlugin(): Plugin {
  return {
    name: 'aiplot-title',
    transformIndexHtml: (html) => {
      const placeholder = /<title>\s*<\/title>/
      if (!placeholder.test(html)) throw new Error('index.html must contain an empty <title>')
      return html.replace(placeholder, `<title>${strings.app.name}</title>`)
    },
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
    root: resolve(root, 'src'),
    server: { fs: { allow: [resolve(root, 'src'), resolve(root, 'node_modules')] } },
    build: {
      outDir: resolve(root, 'out/renderer'),
      rolldownOptions: { input: { index: resolve(root, 'src/index.html') } },
    },
    plugins: [react(), titlePlugin(), cspPlugin()],
  },
})
