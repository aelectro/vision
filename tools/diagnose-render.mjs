/**
 * Dumps statistics for each intermediate pass of the shader chain, to find
 * where an expected signal disappears.
 *
 *   npm run dev        (in another terminal)
 *   npm run diagnose:render
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
  const params = { ...defaultParams(), grain: 0 }

  const sample = (debug) => {
    const canvas = renderer.render(params, debug ? { debug } : {})
    const read = document.createElement('canvas')
    read.width = canvas.width
    read.height = canvas.height
    const rctx = read.getContext('2d')
    rctx.drawImage(canvas, 0, 0)
    const { data, width, height } = rctx.getImageData(0, 0, read.width, read.height)

    const scale = width / size
    const centre = (size / 2) * scale
    const radius = (size / 4) * scale

    const region = (predicate) => {
      const channels = [0, 0, 0]
      let count = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - centre
          const dy = y - centre
          if (!predicate(Math.sqrt(dx * dx + dy * dy))) continue
          const i = (y * width + x) * 4
          channels[0] += data[i]
          channels[1] += data[i + 1]
          channels[2] += data[i + 2]
          count += 1
        }
      }
      return channels.map((c) => +(c / Math.max(count, 1)).toFixed(1))
    }

    return {
      boundary: region((d) => Math.abs(d - radius) <= 2.5 * scale),
      interior: region((d) => d < radius * 0.6),
      background: region((d) => d > radius * 1.6),
    }
  }

  try {
    await renderer.setSource(bitmap)
    return {
      analysis: sample('analysis'),
      tensor: sample('tensor'),
      edges: sample('edges'),
    }
  } finally {
    bitmap.close()
    renderer.dispose()
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('page error:', String(error)))

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  const result = await page.evaluate(scenario)

  for (const [pass, regions] of Object.entries(result)) {
    console.log(`\n${pass} (mean RGB, 0-255)`)
    for (const [where, rgb] of Object.entries(regions)) {
      console.log(`  ${where.padEnd(11)} ${rgb.join(', ')}`)
    }
  }
} catch (error) {
  console.error('diagnosis threw:', error)
} finally {
  await browser.close()
}
