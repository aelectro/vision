/**
 * Checks that the transformation actually singles out the found image.
 *
 * This is the property the app was missing: recognition could say "a bird",
 * but nothing said where, so every contour in the frame was emphasised
 * equally - which on a textured surface reads as contrast and shadow rather
 * than as a bird. The test puts structure in one corner of an otherwise flat
 * field and asserts two things: that the region is located there, and that the
 * contours end up measurably stronger inside it than outside.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:focus
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const scenario = async () => {
  const { VisionRenderer } = await import('/src/render/gl/renderer.ts')
  const { focusFromGrid, WHOLE_FRAME } = await import('/src/render/focus.ts')
  const { defaultParams } = await import('/src/ml/params.ts')

  const width = 480
  const height = 480
  const source = document.createElement('canvas')
  source.width = width
  source.height = height
  const ctx = source.getContext('2d')

  // A calm gradient everywhere, and a knot of detail in the lower right.
  const gradient = ctx.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#44505c')
  gradient.addColorStop(1, '#5c6672')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, width, height)

  ctx.strokeStyle = '#ece6dc'
  ctx.lineWidth = 3
  for (let i = 0; i < 14; i++) {
    ctx.beginPath()
    ctx.arc(340, 340, 12 + i * 6, i * 0.4, i * 0.4 + 2.4)
    ctx.stroke()
  }

  const bitmap = await createImageBitmap(source)
  const renderer = VisionRenderer.create(width, height)
  const params = { ...defaultParams(), grain: 0, vignette: 0 }

  try {
    await renderer.setSource(bitmap)

    const grid = renderer.edgeGrid(params, 6, 6)
    const region = focusFromGrid(grid)

    // Contour strength inside the located region versus a quiet area, with
    // the emphasis on and off. Only the difference between the two renders is
    // attributable to the focus behaviour.
    const sample = (focus) => {
      const canvas = renderer.render(params, { focus })
      const read = document.createElement('canvas')
      read.width = canvas.width
      read.height = canvas.height
      const rctx = read.getContext('2d', { willReadFrequently: true })
      rctx.drawImage(canvas, 0, 0)
      return rctx.getImageData(0, 0, read.width, read.height)
    }

    const focused = sample(region)
    const even = sample(WHOLE_FRAME)

    const contrastIn = (image, cx, cy, radius) => {
      let min = 255
      let max = 0
      const scale = image.width / width
      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          const dx = x / scale - cx
          const dy = y / scale - cy
          if (dx * dx + dy * dy > radius * radius) continue
          const i = (y * image.width + x) * 4
          const lum =
            0.2126 * image.data[i] + 0.7152 * image.data[i + 1] + 0.0722 * image.data[i + 2]
          if (lum < min) min = lum
          if (lum > max) max = lum
        }
      }
      return max - min
    }

    return {
      grid: Array.from(grid.values, (v) => +v.toFixed(3)),
      region: {
        x: +region.x.toFixed(3),
        y: +region.y.toFixed(3),
        radius: +region.radius.toFixed(3),
        confidence: +region.confidence.toFixed(3),
      },
      // The knot of detail sits at (340, 340) of 480.
      detailFocused: +contrastIn(focused, 340, 340, 90).toFixed(1),
      detailEven: +contrastIn(even, 340, 340, 90).toFixed(1),
      quietFocused: +contrastIn(focused, 120, 120, 90).toFixed(1),
      quietEven: +contrastIn(even, 120, 120, 90).toFixed(1),
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
  const r = await page.evaluate(scenario)

  console.log('Structure grid (6x6, detail was drawn in the lower right)')
  for (let row = 0; row < 6; row++) {
    console.log(
      '  ' +
        r.grid
          .slice(row * 6, row * 6 + 6)
          .map((v) => v.toFixed(2))
          .join('  '),
    )
  }

  console.log('\nLocated region')
  console.log(`  centre       ${r.region.x}, ${r.region.y}   <- expected around 0.7, 0.7`)
  console.log(`  radius       ${r.region.radius}`)
  console.log(`  confidence   ${r.region.confidence}`)

  console.log('\nLocal contrast, emphasis on vs off')
  console.log(`  at the shape ${r.detailFocused}  vs  ${r.detailEven}`)
  console.log(`  quiet corner ${r.quietFocused}  vs  ${r.quietEven}`)

  const checks = [
    ['the region landed on the detail', r.region.x > 0.5 && r.region.y > 0.5],
    ['it is confident enough to act on', r.region.confidence > 0.2],
    ['the shape keeps its contrast', r.detailFocused >= r.detailEven * 0.9],
    ['the surroundings give way', r.quietFocused < r.quietEven * 0.85],
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
  console.error('focus check threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
