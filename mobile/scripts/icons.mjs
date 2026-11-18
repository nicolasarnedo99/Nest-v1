// Renders assets/mark.svg to the app PNGs with the Mac's headless Chrome (no npm dependency).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
if (!existsSync(CHROME)) throw new Error(`Chrome not found at ${CHROME}`)

const assets = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
const svg = readFileSync(join(assets, 'mark.svg'), 'utf8')
const dir = mkdtempSync(join(tmpdir(), 'nest-icons-'))

function render(out, canvas, mark, bg, strokeWidth = 5) {
  const art = svg
    .replace('<svg ', `<svg width="${mark}" height="${mark}" `)
    .replace('stroke-width="5"', `stroke-width="${strokeWidth}"`)
  const html = `<!doctype html><html><head><style>html,body{margin:0;width:${canvas}px;height:${canvas}px;overflow:hidden;background:${bg}}
body{display:flex;align-items:center;justify-content:center}svg{display:block}</style></head><body>${art}</body></html>`
  const file = join(dir, `${out}.html`)
  writeFileSync(file, html)
  const dest = join(assets, out)
  rmSync(dest, { force: true }) // so a stale PNG can't mask a failed render
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', `--window-size=${canvas},${canvas}`,
    '--default-background-color=00000000', `--screenshot=${dest}`, file], { stdio: 'inherit' })
  if (!existsSync(dest) || statSync(dest).size === 0) throw new Error(`render failed: ${out}`)
}

try {
  render('icon.png', 1024, 960, '#ffffff') // the ring spans ~85% of the mark, so 960 fills ~80% of the tile, like other apps' marks
  render('splash-icon.png', 1024, 480, 'transparent')
  render('mark@3x.png', 288, 288, 'transparent', 6)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
