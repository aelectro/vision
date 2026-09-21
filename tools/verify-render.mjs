/**
 * Renders a synthetic image through the real shader chain in a real browser
 * and checks the result, because none of that can run under Node.
 *
 * The contour check works by difference: the same image is rendered twice,
 * once with the edge overlay off and once with it at full strength. Whatever
 * changed between them is the contour pass and nothing else, which is far more
 * honest than looking at absolute brightness - a dark subject is dark whether
 * or not we drew a line around it.
 *
 * Uses the system Edge rather than a downloaded Chromium: this machine sits
 * behind TLS interception that blocks Playwright's browser download.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:render
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const scenario = async () => {
  const { VisionRenderer } = await import('/src/render/gl/renderer.ts')
  const { defaultParams } = await import('/src/ml/params.ts')

  const size = 256
  const source = document.createElement('canvas')
  source.width = size
  source.height = size
  const ctx = source.getContext('2d')

  // A soft gradient with one hard-edged, clearly contrasting shape. The
  // contrast matters: a shape whose luminance sits near the gradient's own
  // midpoint has almost no edge for the detector to find, and would make this
  // check fail for reasons that have nothing to do with the shaders.
  const gradient = ctx.createLinearGradient(0, 0, size, size)
  gradient.addColorStop(0, '#3d4a57')
  gradient.addColorStop(1, '#6a7480')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#ece6dc'
  ctx.beginPath()
  ctx.arc(size / 2, size / 2, size / 4, 0, Math.PI * 2)
  ctx.fill()

  const bitmap = await createImageBitmap(source)
  const renderer = VisionRenderer.create(size, size)

  const grab = (canvas) => {
    const read = document.createElement('canvas')
    read.width = canvas.width
    read.height = canvas.height
    read.getContext('2d').drawImage(canvas, 0, 0)
    return read.getContext('2d').getImageData(0, 0, read.width, read.height)
  }

  try {
    renderer.setSource(bitmap)

    const base = defaultParams()
    // Grain is random per pixel and would swamp the difference measurement.
    base.grain = 0

    const withoutEdges = grab(renderer.render({ ...base, edgeStrength: 0 }))
    const withEdges = grab(renderer.render({ ...base, edgeStrength: 1 }))

    const width = withEdges.width
    const height = withEdges.height
    const a = withoutEdges.data
    const b = withEdges.data

    const delta = new Float32Array(width * height)
    for (let p = 0; p < delta.length; p++) {
      const i = p * 4
      delta[p] =
        (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
    }

    const scale = width / size
    const centre = (size / 2) * scale
    const radius = (size / 4) * scale

    const meanIn = (predicate) => {
      let sum = 0
      let count = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - centre
          const dy = y - centre
          if (!predicate(Math.sqrt(dx * dx + dy * dy))) continue
          sum += delta[y * width + x]
          count += 1
        }
      }
      return count > 0 ? sum / count : 0
    }

    // Statistics of the plain render, to catch a pipeline that produces
    // something technically non-empty but visually broken.
    let min = 255
    let max = 0
    let sum = 0
    for (let p = 0; p < delta.length; p++) {
      const i = p * 4
      const lum = 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]
      if (lum < min) min = lum
      if (lum > max) max = lum
      sum += lum
    }

    return {
      width,
      height,
      min,
      max,
      mean: sum / delta.length,
      // A band straddling the circle's boundary.
      boundaryDelta: meanIn((d) => Math.abs(d - radius) <= 2.5 * scale),
      // Flat regions where there is nothing for an edge detector to find.
      interiorDelta: meanIn((d) => d < radius * 0.6),
      backgroundDelta: meanIn((d) => d > radius * 1.6),
    }
  } finally {
    bitmap.close()
    renderer.dispose()
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

const consoleErrors = []
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text())
})
page.on('pageerror', (error) => consoleErrors.push(String(error)))

let failed = false

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })

  const webgl = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    return gl ? gl.getParameter(gl.VERSION) : null
  })

  if (!webgl) throw new Error('WebGL2 is unavailable in this browser session')
  console.log(`WebGL2: ${webgl}`)

  const stats = await page.evaluate(scenario)

  console.log('\nRendered output')
  console.log(`  size              ${stats.width}x${stats.height}`)
  console.log(
    `  luminance         min ${stats.min.toFixed(1)}  mean ${stats.mean.toFixed(1)}  max ${stats.max.toFixed(1)}`,
  )
  console.log('\nContour pass, measured as the difference it makes')
  console.log(`  at the boundary   ${stats.boundaryDelta.toFixed(2)}`)
  console.log(`  flat interior     ${stats.interiorDelta.toFixed(2)}`)
  console.log(`  flat background   ${stats.backgroundDelta.toFixed(2)}`)

  const checks = [
    ['produced a non-empty image', stats.width > 0 && stats.height > 0],
    ['output is not a flat colour', stats.max - stats.min > 30],
    ['output is neither black nor blown out', stats.mean > 5 && stats.mean < 250],
    ['contours appear at the shape boundary', stats.boundaryDelta > 8],
    [
      'contours do not smear across flat areas',
      stats.boundaryDelta > stats.interiorDelta * 3 &&
        stats.boundaryDelta > stats.backgroundDelta * 3,
    ],
  ]

  console.log('')
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) failed = true
  }

  if (consoleErrors.length > 0) {
    failed = true
    console.log('\nConsole errors:')
    for (const error of consoleErrors) console.log(`  ${error}`)
  }
} catch (error) {
  failed = true
  console.error('\nVerification threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
