/**
 * Checks that the renderer keeps the image the right way up.
 *
 * This exists because the contour check could not: it draws a centred circle,
 * which looks identical upside down. A vertical flip survived that test
 * untouched and only surfaced on a real photo. The target here is deliberately
 * asymmetric in both axes, so any flip or mirror shows up as a marker landing
 * in the wrong corner.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:orientation
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const scenario = async () => {
  const { VisionRenderer } = await import('/src/render/gl/renderer.ts')
  const { defaultParams } = await import('/src/ml/params.ts')

  const width = 240
  const height = 320
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const ctx = source.getContext('2d')

  ctx.fillStyle = '#20242c'
  ctx.fillRect(0, 0, width, height)

  // One bright block, in one corner only. Its position in the output is the
  // whole answer: top-left means correct, bottom-left means flipped
  // vertically, top-right means mirrored.
  ctx.fillStyle = '#f2ece0'
  ctx.fillRect(16, 16, 80, 60)

  const bitmap = await createImageBitmap(source)
  const renderer = VisionRenderer.create(width, height)
  const params = { ...defaultParams(), grain: 0, vignette: 0, edgeStrength: 0 }

  try {
    await renderer.setSource(bitmap)
    const canvas = renderer.render(params)

    const read = document.createElement('canvas')
    read.width = canvas.width
    read.height = canvas.height
    const rctx = read.getContext('2d', { willReadFrequently: true })
    rctx.drawImage(canvas, 0, 0)
    const { data } = rctx.getImageData(0, 0, read.width, read.height)

    // Brightness per quadrant. The marker is in exactly one of them.
    const quadrant = (left, top) => {
      let sum = 0
      let count = 0
      const x0 = left ? 0 : Math.floor(read.width / 2)
      const x1 = left ? Math.floor(read.width / 2) : read.width
      const y0 = top ? 0 : Math.floor(read.height / 2)
      const y1 = top ? Math.floor(read.height / 2) : read.height

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * read.width + x) * 4
          sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
          count += 1
        }
      }
      return sum / count
    }

    return {
      size: `${read.width}x${read.height}`,
      topLeft: +quadrant(true, true).toFixed(1),
      topRight: +quadrant(false, true).toFixed(1),
      bottomLeft: +quadrant(true, false).toFixed(1),
      bottomRight: +quadrant(false, false).toFixed(1),
    }
  } finally {
    bitmap.close()
    renderer.dispose()
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

let failed = false

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  const q = await page.evaluate(scenario)

  console.log(`Rendered ${q.size}; the marker was drawn in the top-left of the source.\n`)
  console.log('Mean brightness by quadrant')
  console.log(`  top-left     ${String(q.topLeft).padStart(6)}   <- the marker belongs here`)
  console.log(`  top-right    ${String(q.topRight).padStart(6)}`)
  console.log(`  bottom-left  ${String(q.bottomLeft).padStart(6)}`)
  console.log(`  bottom-right ${String(q.bottomRight).padStart(6)}`)

  const others = [q.topRight, q.bottomLeft, q.bottomRight]
  const brightest = Math.max(q.topLeft, ...others)

  const diagnosis =
    q.topLeft === brightest
      ? 'upright'
      : q.bottomLeft === brightest
        ? 'flipped vertically'
        : q.topRight === brightest
          ? 'mirrored horizontally'
          : 'rotated 180 degrees'

  console.log(`\n  orientation: ${diagnosis}`)

  const checks = [
    ['the marker stayed in the top-left', q.topLeft === brightest],
    ['it is clearly there, not a rounding artefact', q.topLeft > Math.max(...others) + 8],
    ['nothing threw', errors.length === 0],
  ]

  console.log('')
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) failed = true
  }

  for (const error of errors) console.log(`  ${error}`)
} catch (error) {
  failed = true
  console.error('orientation check threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
