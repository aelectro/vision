/// <reference lib="webworker" />

import {
  AutoProcessor,
  AutoTokenizer,
  CLIPTextModelWithProjection,
  CLIPVisionModelWithProjection,
  RawImage,
  env,
  pipeline,
  type PreTrainedModel,
  type PreTrainedTokenizer,
  type Processor,
} from '@huggingface/transformers'

import { EMBEDDING_SIZE, MODEL_SPECS, type ModelTier } from '~/ml/tiers'
import type { DepthMap, MlRequest, MlResponse } from '~/ml/worker/protocol'

// Weights come from the Hugging Face CDN and are cached by Transformers.js in
// Cache Storage; caching the wasm runtime too is what makes the app genuinely
// work offline after the first load rather than only appearing to.
env.allowLocalModels = false
env.useBrowserCache = true
env.useWasmCache = true

// No cross-origin isolation, by choice - it would rule out GitHub Pages and
// break the Hugging Face fetches - so SharedArrayBuffer is unavailable and
// wasm threading cannot work. Saying so up front avoids ORT trying and failing.
if (env.backends.onnx.wasm) env.backends.onnx.wasm.numThreads = 1

type Device = 'webgpu' | 'wasm'

let device: Device | null = null

/**
 * WebGPU where it exists, wasm everywhere else.
 *
 * Resolved once and cached: on iOS a WebGPU failure surfaces as the whole tab
 * being killed rather than a catchable error, so the decision is made before
 * any weights are loaded and never revisited mid-run.
 */
async function resolveDevice(): Promise<Device> {
  if (device) return device

  device = 'wasm'
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (gpu && (await gpu.requestAdapter())) device = 'webgpu'
  } catch {
    device = 'wasm'
  }
  return device
}

type VisionBundle = { model: PreTrainedModel; processor: Processor }
type TextBundle = { model: PreTrainedModel; tokenizer: PreTrainedTokenizer }
type DepthBundle = { estimate: (image: RawImage) => Promise<unknown> }

const loaded = new Map<ModelTier, VisionBundle | TextBundle | DepthBundle>()
const loading = new Map<ModelTier, Promise<unknown>>()

function report(tier: ModelTier, progress: number): void {
  const message: MlResponse = { type: 'progress', tier, progress }
  self.postMessage(message)
}

function progressCallback(tier: ModelTier) {
  return (event: { status?: string; progress?: number }) => {
    if (event.status === 'progress' && typeof event.progress === 'number') {
      report(tier, Math.min(1, Math.max(0, event.progress / 100)))
    }
    if (event.status === 'done') report(tier, 1)
  }
}

async function loadVision(): Promise<VisionBundle> {
  const spec = MODEL_SPECS.vision
  const options = {
    dtype: spec.dtype,
    device: await resolveDevice(),
    progress_callback: progressCallback('vision'),
  } as const

  const [model, processor] = await Promise.all([
    CLIPVisionModelWithProjection.from_pretrained(spec.repo, options),
    AutoProcessor.from_pretrained(spec.repo),
  ])
  return { model, processor }
}

async function loadText(): Promise<TextBundle> {
  const spec = MODEL_SPECS.text
  const options = {
    dtype: spec.dtype,
    device: await resolveDevice(),
    progress_callback: progressCallback('text'),
  } as const

  const [model, tokenizer] = await Promise.all([
    CLIPTextModelWithProjection.from_pretrained(spec.repo, options),
    AutoTokenizer.from_pretrained(spec.repo),
  ])
  return { model, tokenizer }
}

async function loadDepth(): Promise<DepthBundle> {
  const spec = MODEL_SPECS.depth
  const estimator = await pipeline('depth-estimation', spec.repo, {
    dtype: spec.dtype,
    device: await resolveDevice(),
    progress_callback: progressCallback('depth'),
  })
  return { estimate: (image) => estimator(image) as Promise<unknown> }
}

function ensure(tier: ModelTier): Promise<unknown> {
  const ready = loaded.get(tier)
  if (ready) return Promise.resolve(ready)

  // Two callers asking at once must share one download, not start two.
  const inFlight = loading.get(tier)
  if (inFlight) return inFlight

  const load = (async () => {
    const bundle =
      tier === 'vision'
        ? await loadVision()
        : tier === 'text'
          ? await loadText()
          : await loadDepth()
    loaded.set(tier, bundle)
    loading.delete(tier)
    report(tier, 1)
    return bundle
  })().catch((error: unknown) => {
    loading.delete(tier)
    throw error
  })

  loading.set(tier, load)
  return load
}

async function release(tier: ModelTier): Promise<void> {
  const bundle = loaded.get(tier)
  loaded.delete(tier)
  if (!bundle) return

  // Freeing the session matters more than it looks: iOS kills the tab on GPU
  // memory pressure without raising anything JavaScript can catch, so a model
  // that is no longer needed must not stay resident.
  const disposable = (bundle as { model?: { dispose?: () => Promise<void> } }).model
  await disposable?.dispose?.()
}

function firstEmbedding(output: Record<string, unknown>): Float32Array {
  const tensor =
    (output['image_embeds'] as { data?: unknown } | undefined) ??
    (output['text_embeds'] as { data?: unknown } | undefined)
  const data = tensor?.data

  if (!(data instanceof Float32Array)) throw new Error('Model returned no embedding')
  if (data.length < EMBEDDING_SIZE) throw new Error(`Embedding is ${data.length} values long`)

  // Cosine similarity reduces to a dot product once these are unit length, and
  // every consumer downstream assumes that.
  return normalise(data.slice(0, EMBEDDING_SIZE))
}

function normalise(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm
  }
  return vector
}

async function embedImage(bitmap: ImageBitmap): Promise<Float32Array> {
  const bundle = (await ensure('vision')) as VisionBundle
  const image = await RawImage.fromBlob(await bitmapToBlob(bitmap))
  const inputs = await bundle.processor(image)
  const output = (await bundle.model(inputs)) as Record<string, unknown>
  return firstEmbedding(output)
}

async function embedText(text: string): Promise<Float32Array> {
  const bundle = (await ensure('text')) as TextBundle
  const inputs = bundle.tokenizer([text], { padding: true, truncation: true })
  const output = (await bundle.model(inputs)) as Record<string, unknown>
  return firstEmbedding(output)
}

async function estimateDepth(bitmap: ImageBitmap): Promise<DepthMap> {
  const bundle = (await ensure('depth')) as DepthBundle
  const image = await RawImage.fromBlob(await bitmapToBlob(bitmap))
  const output = (await bundle.estimate(image)) as { depth?: RawImage }

  const depth = output.depth
  if (!depth) throw new Error('Depth estimation returned no map')

  const grey = depth.data
  const width = depth.width
  const height = depth.height
  const channels = grey.length / (width * height)

  // Expanded to RGBA here so the main thread can hand it straight to
  // texImage2D without another pass over the pixels.
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let p = 0; p < width * height; p++) {
    const value = grey[p * channels] ?? 0
    rgba[p * 4] = value
    rgba[p * 4 + 1] = value
    rgba[p * 4 + 2] = value
    rgba[p * 4 + 3] = 255
  }

  return { data: rgba, width, height }
}

async function bitmapToBlob(bitmap: ImageBitmap): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('OffscreenCanvas 2D context unavailable')
  context.drawImage(bitmap, 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}

async function handle(request: MlRequest): Promise<unknown> {
  switch (request.type) {
    case 'ensure':
      await ensure(request.tier)
      return true
    case 'release':
      await release(request.tier)
      return true
    case 'embedImage':
      try {
        return await embedImage(request.bitmap)
      } finally {
        request.bitmap.close()
      }
    case 'embedText':
      return await embedText(request.text)
    case 'depth':
      try {
        return await estimateDepth(request.bitmap)
      } finally {
        request.bitmap.close()
      }
  }
}

self.onmessage = (event: MessageEvent<MlRequest>) => {
  const request = event.data

  void handle(request).then(
    (result) => {
      const message: MlResponse = { id: request.id, ok: true, result }
      self.postMessage(message)
      return undefined
    },
    (error: unknown) => {
      const message: MlResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      self.postMessage(message)
      return undefined
    },
  )
}
