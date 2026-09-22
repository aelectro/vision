/**
 * Runs the real capture-to-video path in a real browser and inspects what
 * comes out. Node has neither WebCodecs nor WebGL, so this is the only way to
 * know the video feature works at all.
 *
 * Deliberately goes through the production modules - the database, the
 * pipeline's exporter - rather than reimplementing them, so that a break in
 * the wiring shows up here too.
 *
 *   npm run dev        (in another terminal)
 *   npm run verify:video
 */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const scenario = async () => {
  const repositories = await import('/src/core/db/repositories.ts')
  const { exportVideo, CLIP_SECONDS } = await import('/src/render/video.ts')
  const { VisionRenderer } = await import('/src/render/gl/renderer.ts')
  const { defaultParams } = await import('/src/ml/params.ts')

  const makeSource = (width, height) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#3d4a57')
    gradient.addColorStop(1, '#6a7480')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#ece6dc'
    ctx.beginPath()
    ctx.arc(width / 2, height / 2, Math.min(width, height) / 4, 0, Math.PI * 2)
    ctx.fill()
    return canvas
  }

  const size = 320
  const source = makeSource(size, size)

  const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/jpeg', 0.9))

  const hardwareH264 = await VideoEncoder.isConfigSupported({
    codec: 'avc1.42001f',
    width: size,
    height: size,
    bitrate: 4_000_000,
    framerate: 30,
    hardwareAcceleration: 'prefer-hardware',
  })
    .then((result) => result.supported === true)
    .catch(() => false)

  // The animation must genuinely move, or the clip is a still in disguise.
  const bitmap = await createImageBitmap(blob)
  const renderer = VisionRenderer.create(size, size)
  const params = defaultParams()
  let movedFraction = 0
  try {
    await renderer.setSource(bitmap)
    const snapshot = (time) => {
      const canvas = renderer.render(params, { time, motion: 1 })
      const read = document.createElement('canvas')
      read.width = canvas.width
      read.height = canvas.height
      const rctx = read.getContext('2d')
      rctx.drawImage(canvas, 0, 0)
      return rctx.getImageData(0, 0, read.width, read.height).data
    }
    const first = snapshot(0)
    const later = snapshot(0.37)
    let moved = 0
    for (let i = 0; i < first.length; i += 4) {
      if (Math.abs(first[i] - later[i]) > 3) moved += 1
    }
    movedFraction = moved / (first.length / 4)
  } finally {
    bitmap.close()
    renderer.dispose()
  }

  const vision = await repositories.createVision({
    original: blob,
    thumb: blob,
    width: size,
    height: size,
  })

  const progress = []
  const started = performance.now()
  const video = await exportVideo(vision.id, {
    params,
    modelVersion: 0,
    onProgress: (fraction) => progress.push(fraction),
  })
  const elapsed = performance.now() - started

  // If the browser's own video element can play it, it is a real MP4.
  const element = document.createElement('video')
  element.muted = true
  element.src = URL_createObjectURL(video)
  const metadata = await new Promise((resolve) => {
    element.onloadedmetadata = () =>
      resolve({
        duration: element.duration,
        width: element.videoWidth,
        height: element.videoHeight,
      })
    element.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 8000)
  })
  URL.revokeObjectURL(element.src)

  const stored = await repositories.latestArtifact(vision.id, 'video')
  await repositories.deleteVision(vision.id)

  // The shape that actually failed on the phone: a 9:16 photo, which the 720
  // cap turns into 405 pixels wide. H.264 cannot encode an odd side, so this
  // is the regression guard for that bug.
  let portrait = null
  {
    const tall = makeSource(1080, 1920)
    const tallBlob = await new Promise((resolve) => tall.toBlob(resolve, 'image/jpeg', 0.9))
    const tallVision = await repositories.createVision({
      original: tallBlob,
      thumb: tallBlob,
      width: 1080,
      height: 1920,
    })

    try {
      const clip = await exportVideo(tallVision.id, {
        params: defaultParams(),
        modelVersion: 0,
      })
      portrait = { ok: true, bytes: clip.size, error: null }
    } catch (error) {
      portrait = { ok: false, bytes: 0, error: String(error) }
    }
    await repositories.deleteVision(tallVision.id)
  }

  return {
    hardwareH264,
    movedFraction,
    clipSeconds: CLIP_SECONDS,
    bytes: video.size,
    type: video.type,
    elapsedMs: Math.round(elapsed),
    progressSteps: progress.length,
    progressEndsAtOne: progress.at(-1) === 1,
    storedArtifact: stored !== undefined,
    metadata,
    portrait,
  }
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()

const errors = []
page.on('pageerror', (error) => errors.push(String(error)))

let failed = false

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  // `URL` is shadowed inside the page by the module import above.
  await page.evaluate(() => {
    globalThis.URL_createObjectURL = (blob) => URL.createObjectURL(blob)
  })

  const stats = await page.evaluate(scenario)

  console.log('Encoder')
  console.log(`  hardware H.264   ${stats.hardwareH264 ? 'yes' : 'no'}`)

  console.log('\nEncoded clip')
  console.log(`  mime             ${stats.type}`)
  console.log(`  size             ${(stats.bytes / 1024).toFixed(0)} KB`)
  console.log(`  encode time      ${stats.elapsedMs} ms`)
  console.log(`  progress steps   ${stats.progressSteps}`)
  if (stats.metadata) {
    console.log(
      `  playback         ${stats.metadata.duration.toFixed(2)} s, ${stats.metadata.width}x${stats.metadata.height}`,
    )
  } else {
    console.log('  playback         could not be read')
  }
  console.log(`  pixels moving    ${(stats.movedFraction * 100).toFixed(1)}%`)

  const checks = [
    ['the animation actually moves', stats.movedFraction > 0.05],
    ['produced an mp4 blob', stats.type === 'video/mp4' && stats.bytes > 20_000],
    ['the browser can decode it', stats.metadata !== null],
    [
      'duration matches the intended clip length',
      stats.metadata !== null && Math.abs(stats.metadata.duration - stats.clipSeconds) < 0.5,
    ],
    ['progress was reported to completion', stats.progressSteps > 0 && stats.progressEndsAtOne],
    ['the artefact was stored', stats.storedArtifact],
    ['a 9:16 photo encodes, which is the shape that failed', stats.portrait?.ok === true],
  ]

  if (stats.portrait && !stats.portrait.ok) {
    console.log(`\n  portrait export failed: ${stats.portrait.error}`)
  } else if (stats.portrait) {
    console.log(`\n  9:16 clip       ${Math.round(stats.portrait.bytes / 1024)} KB`)
  }

  console.log('')
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`)
    if (!ok) failed = true
  }

  if (errors.length > 0) {
    failed = true
    console.log('\nPage errors:')
    for (const error of errors) console.log(`  ${error}`)
  }
} catch (error) {
  failed = true
  console.error('\nVerification threw:', error)
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
