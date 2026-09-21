/**
 * The contract between the neural head, the shaders and the animation.
 *
 * The network never produces pixels. It produces this parameter vector, and
 * the renderer turns it into an image and into video frames. That keeps the
 * learnable part tiny, interpretable and cheap enough to train on a phone,
 * and it means every result can be reproduced from twenty numbers.
 *
 * The head emits values in [0, 1]; `denormalise` maps them onto the ranges
 * below, and `normalise` maps user-adjusted values back into training targets.
 */

export type RenderParams = {
  /** How strongly extracted contours are drawn over the image. */
  edgeStrength: number
  /** XDoG threshold: which gradients count as a line at all. */
  edgeThreshold: number
  /** Line width in pixels at the working resolution. */
  edgeWidth: number
  /** How much lines follow the dominant local orientation rather than raw gradient. */
  coherence: number
  /** Radius of the structure-tensor smoothing, in pixels. */
  structureRadius: number

  /** Global tone controls applied before stylisation. */
  contrast: number
  brightness: number
  saturation: number

  /** Posterisation: 0 keeps continuous tone, 1 collapses to flat bands. */
  posterise: number
  /** Number of tone bands when posterising. */
  levels: number

  /** Hue rotation in turns, and how far the palette is pushed towards it. */
  paletteHue: number
  paletteStrength: number

  /** Lifts the recognised subject out of its background using the depth map. */
  subjectFocus: number
  /** Darkens the frame edges towards the centre of interest. */
  vignette: number
  /** Film-like noise, which hides banding from posterisation. */
  grain: number

  /** Animation: how far near and far planes separate, in pixels. */
  parallax: number
  /** Slow scale drift over the ten seconds. */
  zoom: number
  /** Low-frequency organic warping of the subject. */
  breathing: number
  /** Overall speed multiplier for the motion. */
  motionSpeed: number
  /** How much the contours pulse in brightness over time. */
  contourPulse: number
}

type Range = { min: number; max: number; default: number; step: number }

/**
 * Order matters: it defines the layout of the network's output vector and of
 * the serialised parameters, so entries may be appended but not reordered.
 */
export const PARAM_RANGES = {
  edgeStrength: { min: 0, max: 1, default: 0.55, step: 0.01 },
  edgeThreshold: { min: 0, max: 1, default: 0.35, step: 0.01 },
  edgeWidth: { min: 0.5, max: 4, default: 1.2, step: 0.1 },
  coherence: { min: 0, max: 1, default: 0.65, step: 0.01 },
  structureRadius: { min: 1, max: 8, default: 3, step: 0.5 },

  contrast: { min: 0.5, max: 2.2, default: 1.15, step: 0.01 },
  brightness: { min: -0.3, max: 0.3, default: 0, step: 0.01 },
  saturation: { min: 0, max: 1.8, default: 0.75, step: 0.01 },

  posterise: { min: 0, max: 1, default: 0.3, step: 0.01 },
  levels: { min: 2, max: 12, default: 6, step: 1 },

  paletteHue: { min: 0, max: 1, default: 0.06, step: 0.005 },
  paletteStrength: { min: 0, max: 1, default: 0.25, step: 0.01 },

  subjectFocus: { min: 0, max: 1, default: 0.5, step: 0.01 },
  vignette: { min: 0, max: 1, default: 0.35, step: 0.01 },
  grain: { min: 0, max: 0.5, default: 0.08, step: 0.005 },

  parallax: { min: 0, max: 60, default: 22, step: 1 },
  zoom: { min: 0, max: 0.25, default: 0.08, step: 0.005 },
  breathing: { min: 0, max: 1, default: 0.3, step: 0.01 },
  motionSpeed: { min: 0.25, max: 2, default: 1, step: 0.05 },
  contourPulse: { min: 0, max: 1, default: 0.35, step: 0.01 },
} as const satisfies Record<keyof RenderParams, Range>

export const PARAM_KEYS = Object.keys(PARAM_RANGES) as (keyof RenderParams)[]

/** Width of the neural head's output layer. */
export const PARAM_COUNT = PARAM_KEYS.length

export function defaultParams(): RenderParams {
  const out = {} as RenderParams
  for (const key of PARAM_KEYS) out[key] = PARAM_RANGES[key].default
  return out
}

function clampTo(range: Range, value: number): number {
  if (!Number.isFinite(value)) return range.default
  return Math.min(range.max, Math.max(range.min, value))
}

/** Clamps every field into its range, replacing anything non-finite. */
export function sanitiseParams(params: Partial<RenderParams>): RenderParams {
  const out = {} as RenderParams
  for (const key of PARAM_KEYS) {
    const range = PARAM_RANGES[key]
    const value = params[key]
    out[key] = value === undefined ? range.default : clampTo(range, value)
  }
  return out
}

/** Packs parameters into the [0, 1] vector the network is trained against. */
export function normalise(params: RenderParams): Float32Array {
  const out = new Float32Array(PARAM_COUNT)
  for (let i = 0; i < PARAM_COUNT; i++) {
    const key = PARAM_KEYS[i]!
    const range = PARAM_RANGES[key]
    out[i] = (clampTo(range, params[key]) - range.min) / (range.max - range.min)
  }
  return out
}

/** Expands a network output vector back into usable render parameters. */
export function denormalise(vector: ArrayLike<number>): RenderParams {
  const out = {} as RenderParams
  for (let i = 0; i < PARAM_COUNT; i++) {
    const key = PARAM_KEYS[i]!
    const range = PARAM_RANGES[key]
    const raw = vector[i]
    const t = raw === undefined || !Number.isFinite(raw) ? 0.5 : Math.min(1, Math.max(0, raw))
    const value = range.min + t * (range.max - range.min)
    // Integer-valued controls would otherwise land between bands.
    out[key] = range.step >= 1 ? Math.round(value) : value
  }
  return out
}

/** Parses parameters persisted alongside an artefact. */
export function parseParams(json: string): RenderParams {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return defaultParams()
    return sanitiseParams(parsed as Partial<RenderParams>)
  } catch {
    return defaultParams()
  }
}
