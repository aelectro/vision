/**
 * Measures the expensive parts of the app in a real browser.
 *
 * The numbers here are what decide whether the working-resolution caps are in
 * the right place, and they are the baseline a future change has to beat. Node
 * can measure none of it - there is no WebGL and no WebCodecs.
 *
 *   npm run dev        (in another terminal)
 *   npm run benchmark
 */
/* oxlint-disable eslint/no-await-in-loop --
   Each resolution holds a WebGL context while it is measured, and browsers cap
   how many can be live at once, so these have to run one after another. */
import { chromium } from 'playwright'

const URL = process.env.VERIFY_URL ?? 'http://localhost:5173/'

const scenario = async () => {
  const { VisionRenderer } = await import('/src/render/gl/renderer.ts')
  const { defaultParams } = await import('/src/ml/params.ts')
  const { MlpHead } = await import('/src/ml/head/mlp.ts')
  const { Adam } = await import('/src/ml/head/adam.ts')
  const { MLP_INPUT_SIZE, MLP_PARAMETER_COUNT } = await import('/src/ml/head/mlp.ts')
  const { PARAM_COUNT } = await import('/src/ml/params.ts')

  const makeImage = (size) => {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = Math.round(size * 0.75)
    const ctx = canvas.getContext('2d')
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
    gradient.addColorStop(0, '#26303a')
    gradient.addColorStop(1, '#8a9099')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // Something with real structure, so the edge pass has work to do.
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = i % 2 ? '#e8e2d8' : '#1a1a22'
      ctx.beginPath()
      ctx.arc((i * 97) % canvas.width, (i * 131) % canvas.height, 6 + (i % 7) * 4, 0, Math.PI * 2)
      ctx.fill()
    }
    return canvas
  }

  const results = { render: [], video: null, training: null, memory: null }

  for (const size of [1024, 2048, 2560]) {
    const canvas = makeImage(size)
    const bitmap = await createImageBitmap(canvas)
    const renderer = VisionRenderer.create(bitmap.width, bitmap.height)
    const params = defaultParams()

    try {
      await renderer.setSource(bitmap)
      renderer.render(params) // warm up: shader compilation is a one-off

      // The GPU runs asynchronously, so timing the render calls alone measures
      // how fast we can queue commands, not how fast they execute. Reading a
      // pixel back is a hard synchronisation point.
      const sync = () => {
        const read = document.createElement('canvas')
        read.width = 1
        read.height = 1
        const rctx = read.getContext('2d', { willReadFrequently: true })
        rctx.drawImage(renderer.render(params), 0, 0, 1, 1)
        return rctx.getImageData(0, 0, 1, 1).data[3]
      }

      sync()

      const runs = 10
      const started = performance.now()
      for (let i = 0; i < runs; i++) renderer.render(params)
      sync()
      const elapsed = (performance.now() - started) / (runs + 1)

      results.render.push({
        requested: `${bitmap.width}x${bitmap.height}`,
        working: `${renderer.width}x${renderer.height}`,
        msPerFrame: +elapsed.toFixed(2),
      })
    } finally {
      bitmap.close()
      renderer.dispose()
    }
  }

  {
    const repositories = await import('/src/core/db/repositories.ts')
    const { exportVideo, VIDEO_SETTINGS } = await import('/src/render/video.ts')

    const canvas = makeImage(2048)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    const vision = await repositories.createVision({
      original: blob,
      thumb: blob,
      width: canvas.width,
      height: canvas.height,
    })

    const started = performance.now()
    const video = await exportVideo(vision.id, { params: defaultParams(), modelVersion: 0 })
    const elapsed = performance.now() - started
    await repositories.deleteVision(vision.id)

    results.video = {
      totalMs: Math.round(elapsed),
      msPerFrame: +(elapsed / 300).toFixed(2),
      sizeKb: Math.round(video.size / 1024),
      maxEdge: VIDEO_SETTINGS.MAX_EDGE,
    }
  }

  {
    const model = new MlpHead()
    const optimiser = new Adam(MLP_PARAMETER_COUNT)
    const input = new Float32Array(MLP_INPUT_SIZE).fill(0.03)
    const target = new Float32Array(PARAM_COUNT).fill(0.5)

    for (let i = 0; i < 20; i++) {
      model.zeroGrad()
      model.forward(input)
      model.backward(target)
      optimiser.step(model.parameters(), model.gradients())
    }

    const passes = 500
    let started = performance.now()
    for (let i = 0; i < passes; i++) {
      model.forward(input)
      model.backward(target)
    }
    const perPass = (performance.now() - started) / passes

    const steps = 200
    started = performance.now()
    for (let i = 0; i < steps; i++) optimiser.step(model.parameters(), model.gradients())
    const perAdam = (performance.now() - started) / steps

    // What one piece of user feedback actually costs: forty optimiser steps,
    // each over a mini-batch of the new example plus fifteen replayed ones.
    const BATCH = 16
    const STEPS = 40

    results.training = {
      parameters: MLP_PARAMETER_COUNT,
      msPerPass: +perPass.toFixed(3),
      msPerAdam: +perAdam.toFixed(3),
      msPerFeedback: Math.round(STEPS * (BATCH * perPass + perAdam)),
    }
  }

  if (performance.memory) {
    results.memory = {
      usedMb: +(performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(1),
      limitMb: +(performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0),
    }
  }

  return results
}

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('page error:', String(error)))

try {
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  const results = await page.evaluate(scenario)

  console.log('Shader chain, six passes per frame')
  for (const row of results.render) {
    console.log(
      `  ${row.requested.padEnd(11)} -> ${row.working.padEnd(11)} ${String(row.msPerFrame).padStart(7)} ms`,
    )
  }

  console.log(`\nVideo export, 300 frames at ${results.video.maxEdge} max edge`)
  console.log(`  total        ${results.video.totalMs} ms`)
  console.log(`  per frame    ${results.video.msPerFrame} ms`)
  console.log(`  size         ${results.video.sizeKb} KB`)

  console.log('\nTraining')
  console.log(`  parameters   ${results.training.parameters.toLocaleString('en-US')}`)
  console.log(`  fwd+bwd      ${results.training.msPerPass} ms per example`)
  console.log(`  adam step    ${results.training.msPerAdam} ms`)
  console.log(`  per feedback ${results.training.msPerFeedback} ms (40 steps x 16 examples)`)

  if (results.memory) {
    console.log('\nJS heap')
    console.log(`  used         ${results.memory.usedMb} MB of ${results.memory.limitMb} MB`)
  }

  console.log(
    '\nDesktop numbers. A phone is roughly three to five times slower, so scale accordingly.',
  )
} catch (error) {
  console.error('benchmark threw:', error)
  process.exitCode = 1
} finally {
  await browser.close()
}
