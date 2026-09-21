import { getModelState, putModelState } from '~/core/db/repositories'
import { Adam } from '~/ml/head/adam'
import { MLP_INPUT_SIZE, MLP_PARAMETER_COUNT, MlpHead } from '~/ml/head/mlp'
import { EMBEDDING_SIZE } from '~/ml/tiers'

/** Bumped whenever the topology changes, which invalidates stored weights. */
export const HEAD_VERSION = 1

export type HeadState = {
  model: MlpHead
  optimiser: Adam
  steps: number
  lossEma: number
  examples: number
}

let state: HeadState | null = null
let loading: Promise<HeadState> | null = null

function create(): HeadState {
  return {
    model: new MlpHead(),
    optimiser: new Adam(MLP_PARAMETER_COUNT, { learningRate: 0.002, weightDecay: 1e-5 }),
    steps: 0,
    lossEma: 0,
    examples: 0,
  }
}

export function loadHead(): Promise<HeadState> {
  if (state) return Promise.resolve(state)
  if (loading) return loading

  loading = (async () => {
    const fresh = create()

    const stored = await getModelState().catch(() => undefined)
    // A version bump or a resized topology makes old weights meaningless;
    // starting over is correct, and quiet, because the user never chose to
    // have weights in the first place.
    if (stored && stored.version === HEAD_VERSION && fresh.model.deserialize(stored.weights)) {
      fresh.steps = stored.steps
      fresh.lossEma = stored.lossEma
      fresh.examples = stored.examples
    }

    state = fresh
    loading = null
    return fresh
  })()

  return loading
}

export async function persistHead(current: HeadState): Promise<void> {
  await putModelState({
    version: HEAD_VERSION,
    weights: current.model.serialize(),
    steps: current.steps,
    lossEma: current.lossEma,
    examples: current.examples,
    updatedAt: Date.now(),
  })
}

export async function resetHead(): Promise<void> {
  state = create()
  await persistHead(state)
}

/**
 * Packs the two embeddings into the network's input.
 *
 * The text half is zeroed when there is no description. Zero is the right
 * absence here: the embeddings are unit-length, so a zero block contributes
 * nothing to any dot product rather than asserting some particular meaning.
 */
export function buildInput(
  imageVector: Float32Array,
  textVector: Float32Array | null,
  into = new Float32Array(MLP_INPUT_SIZE),
): Float32Array {
  into.fill(0)
  into.set(imageVector.subarray(0, EMBEDDING_SIZE), 0)
  if (textVector) into.set(textVector.subarray(0, EMBEDDING_SIZE), EMBEDDING_SIZE)
  return into
}

/** Current state without triggering a load, for read-only UI. */
export function peekHead(): HeadState | null {
  return state
}
