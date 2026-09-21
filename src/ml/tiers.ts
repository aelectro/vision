/**
 * Model tiers.
 *
 * Nothing is fetched speculatively. Each tier is downloaded the first time the
 * user reaches a feature that genuinely needs it, and every feature degrades
 * rather than breaks when its tier is absent. Tier 0 - capture, the shader
 * transformation, the clip - needs no weights at all, so a first visit is
 * useful before a single byte arrives.
 */

export const MODEL_TIERS = ['vision', 'depth', 'text'] as const

export type ModelTier = (typeof MODEL_TIERS)[number]

export type ModelSpec = {
  tier: ModelTier
  /** Hugging Face repository, resolved by Transformers.js. */
  repo: string
  /** Quantisation to request; smaller is the point of the whole design. */
  dtype: 'int8' | 'q4f16' | 'fp16' | 'fp32'
  /** Roughly what the download costs, so the UI can say so before starting. */
  approximateBytes: number
}

export const MODEL_SPECS: Record<ModelTier, ModelSpec> = {
  vision: {
    tier: 'vision',
    repo: 'Xenova/mobileclip_s0',
    dtype: 'int8',
    approximateBytes: 11 * 1024 * 1024,
  },
  depth: {
    tier: 'depth',
    repo: 'onnx-community/depth-anything-v2-small',
    dtype: 'q4f16',
    approximateBytes: 18 * 1024 * 1024,
  },
  text: {
    tier: 'text',
    repo: 'Xenova/mobileclip_s0',
    dtype: 'int8',
    approximateBytes: 41 * 1024 * 1024,
  },
}

/**
 * The inference runtime itself, paid once alongside whichever tier is needed
 * first.
 *
 * Counted separately and stated honestly rather than folded into a model's
 * size: it is the single largest download in the app, and a progress bar that
 * claimed eleven megabytes and then spent most of its time elsewhere would be
 * a lie. Compressed it is closer to seven megabytes on the wire, and it is
 * cached permanently afterwards.
 */
export const RUNTIME_BYTES = 27 * 1024 * 1024

/** Dimensionality of a MobileCLIP embedding, in either tower. */
export const EMBEDDING_SIZE = 512

export type TierStatus = 'absent' | 'downloading' | 'ready' | 'failed'

export type TierState = {
  tier: ModelTier
  status: TierStatus
  /** 0..1 while downloading. */
  progress: number
  error: string | null
}

export function initialTierState(tier: ModelTier): TierState {
  return { tier, status: 'absent', progress: 0, error: null }
}
