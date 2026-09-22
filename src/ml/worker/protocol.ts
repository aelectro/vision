import type { ModelTier } from '~/ml/tiers'

/** Messages the main thread sends to the ML worker. */
export type MlRequest =
  | { id: number; type: 'ensure'; tier: ModelTier }
  | { id: number; type: 'release'; tier: ModelTier }
  | { id: number; type: 'embedImage'; bitmap: ImageBitmap }
  | { id: number; type: 'embedImageBatch'; bitmaps: ImageBitmap[] }
  | { id: number; type: 'embedText'; text: string }
  | { id: number; type: 'depth'; bitmap: ImageBitmap }

export type DepthMap = {
  /** Typed as backed by a plain ArrayBuffer so it can become ImageData. */
  data: Uint8ClampedArray<ArrayBuffer>
  width: number
  height: number
}

export type MlResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string }
  | { type: 'progress'; tier: ModelTier; progress: number }

export type MlRequestType = MlRequest['type']

// Omit over a union collapses it to the shared keys, which would erase every
// request-specific field. Distributing it preserves the variants.
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** A request with the correlation id left for the transport to fill in. */
export type MlRequestBody = DistributiveOmit<MlRequest, 'id'>
