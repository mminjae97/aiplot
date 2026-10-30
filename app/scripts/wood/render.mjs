// Renders the wood grain SVGs in this folder to WebP at 1x and 2x into src/assets/wood (§5).
// SVG filter noise is recomputed on every repaint and resize, so the app ships images instead.
// Run after changing an SVG: npm run wood
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = fileURLToPath(new URL('.', import.meta.url))
const out = fileURLToPath(new URL('../../src/assets/wood/', import.meta.url))
const SCALES = [1, 2]
const QUALITY = 0.75

/** Adds a viewBox so the drawing scales with the canvas instead of being stretched. */
function scalable(svg) {
  const match = /<svg[^>]*\swidth="(\d+)"\s+height="(\d+)"/.exec(svg)
  if (!match) throw new Error('svg needs width and height')
  const [, width, height] = match
  const text = svg.includes('viewBox')
    ? svg
    : svg.replace('<svg ', `<svg viewBox="0 0 ${width} ${height}" `)
  return { text, width: Number(width), height: Number(height) }
}

async function render(win, svg, scale) {
  // Runs in the page: decode the SVG as an image and draw it at the target size.
  const script = `(async () => {
    const svg = ${JSON.stringify(svg.text)}
    const img = new Image()
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = ${svg.width * scale}
    canvas.height = ${svg.height * scale}
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/webp', ${QUALITY})
  })()`
  const url = await win.webContents.executeJavaScript(script)
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  try {
    await win.loadURL('about:blank')
    for (const file of readdirSync(here).filter((name) => name.endsWith('.svg'))) {
      const svg = scalable(readFileSync(join(here, file), 'utf8'))
      const name = file.replace(/\.svg$/, '')
      for (const scale of SCALES) {
        const target = join(out, scale === 1 ? `${name}.webp` : `${name}@${scale}x.webp`)
        const image = await render(win, svg, scale)
        writeFileSync(target, image)
        console.log(`${target} ${image.length} bytes`)
      }
    }
  } catch (error) {
    console.error(error)
    process.exitCode = 1
  }
  app.quit()
})
