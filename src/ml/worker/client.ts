import { MODEL_SPECS, initialTierState, type ModelTier, type TierState } from '~/ml/tiers'
import type { DepthMap, MlRequest, MlRequestBody, MlResponse } from '~/ml/worker/protocol'

type Pending = {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

type TierListener = (states: Record<ModelTier, TierState>) => void

const states: Record<ModelTier, TierState> = {
  vision: initialTierState('vision'),
  depth: initialTierState('depth'),
  text: initialTierState('text'),
}

const listeners = new Set<TierListener>()
const pending = new Map<number, Pending>()

let worker: Worker | null = null
let nextId = 1

function publish(): void {
  const snapshot = { ...states }
  for (const listener of listeners) listener(snapshot)
}

function setTier(tier: ModelTier, patch: Partial<TierState>): void {
  states[tier] = { ...states[tier], ...patch }
  publish()
}

export function onTierChange(listener: TierListener): () => void {
  listeners.add(listener)
  listener({ ...states })
  return () => listeners.delete(listener)
}

export function tierStates(): Record<ModelTier, TierState> {
  return { ...states }
}

/**
 * The worker is created on first use rather than at startup, so a visitor who
 * only ever takes a photo never pays for it.
 */
function ensureWorker(): Worker {
  if (worker) return worker

  worker = new Worker(new URL('~/ml/worker/mlWorker.ts', import.meta.url), { type: 'module' })

  worker.onmessage = (event: MessageEvent<MlResponse>) => {
    const message = event.data

    if ('type' in message && message.type === 'progress') {
      setTier(message.tier, { status: 'downloading', progress: message.progress })
      return
    }

    if (!('id' in message)) return
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)

    if (message.ok) entry.resolve(message.result)
    else entry.reject(new Error(message.error))
  }

  worker.onerror = (event) => {
    const error = new Error(event.message || 'The ML worker failed to start')
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    // A worker that failed to boot will not recover; the next call rebuilds it.
    worker?.terminate()
    worker = null
  }

  return worker
}

function send<T>(request: MlRequestBody, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++
  const instance = ensureWorker()

  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
    instance.postMessage({ ...request, id } as MlRequest, transfer)
  })
}

/**
 * Downloads a tier if it is not already present.
 *
 * Resolves to false rather than throwing when the model cannot be fetched:
 * every caller has something useful to do without it, and a missing tier is a
 * reduced feature rather than an error the user should see.
 */
export async function ensureTier(tier: ModelTier): Promise<boolean> {
  if (states[tier].status === 'ready') return true

  setTier(tier, { status: 'downloading', progress: 0, error: null })
  try {
    await send<boolean>({ type: 'ensure', tier })
    setTier(tier, { status: 'ready', progress: 1, error: null })
    return true
  } catch (error) {
    setTier(tier, {
      status: 'failed',
      progress: 0,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export async function releaseTier(tier: ModelTier): Promise<void> {
  if (states[tier].status !== 'ready') return
  await send<boolean>({ type: 'release', tier }).catch(() => undefined)
  setTier(tier, { status: 'absent', progress: 0 })
}

export function embedImage(bitmap: ImageBitmap): Promise<Float32Array> {
  return send<Float32Array>({ type: 'embedImage', bitmap }, [bitmap])
}

export function embedImageBatch(bitmaps: ImageBitmap[]): Promise<Float32Array[]> {
  return send<Float32Array[]>({ type: 'embedImageBatch', bitmaps }, bitmaps)
}

export function embedText(text: string): Promise<Float32Array> {
  return send<Float32Array>({ type: 'embedText', text })
}

export function estimateDepth(bitmap: ImageBitmap): Promise<DepthMap> {
  return send<DepthMap>({ type: 'depth', bitmap }, [bitmap])
}

export function tierDownloadSize(tier: ModelTier): number {
  return MODEL_SPECS[tier].approximateBytes
}
