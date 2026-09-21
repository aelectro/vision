import { getEmbedding, getVision, listFeedback } from '~/core/db/repositories'
import { buildInput, loadHead } from '~/ml/head/store'
import {
  defaultParams,
  denormalise,
  parseParams,
  sanitiseParams,
  type RenderParams,
} from '~/ml/params'
import { EMBEDDING_SIZE } from '~/ml/tiers'
import { embedText, ensureTier } from '~/ml/worker/client'

/**
 * Below this many accepted examples the network has not seen enough to be
 * trusted on its own, so its output is blended with a nearest-neighbour
 * average over what the user has already approved.
 */
const TRUST_AT = 8

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < EMBEDDING_SIZE; i++) sum += a[i]! * b[i]!
  return sum
}

function blend(a: RenderParams, b: RenderParams, t: number): RenderParams {
  const out = {} as RenderParams
  for (const key of Object.keys(a) as (keyof RenderParams)[]) {
    out[key] = a[key] + (b[key] - a[key]) * t
  }
  return sanitiseParams(out)
}

/**
 * Parameters from the user's own history, weighted by how similar each past
 * photo looked.
 *
 * This is what makes the app feel personalised from the third photo rather
 * than the thirtieth: a network trained on a handful of examples is still
 * mostly noise, but "what did you choose last time you saw something like
 * this" is useful immediately.
 */
async function neighbourParams(imageVector: Float32Array): Promise<RenderParams | null> {
  const feedback = await listFeedback()
  if (feedback.length === 0) return null

  // A dislike says the parameters were wrong but not what would have been
  // right, so there is nothing to average towards.
  const usable = feedback.filter((entry) => entry.signal !== 'dislike')
  const embeddings = await Promise.all(usable.map((entry) => getEmbedding(entry.visionId)))

  const scored: { params: RenderParams; weight: number }[] = []

  for (let i = 0; i < usable.length; i++) {
    const entry = usable[i]!
    const vector = embeddings[i]?.imageVec
    if (!vector) continue

    const similarity = dot(imageVector, vector)
    if (similarity <= 0) continue

    const emphasis = entry.signal === 'edit' ? 2 : entry.signal === 'like' ? 1.5 : 1
    scored.push({ params: parseParams(entry.paramsJson), weight: similarity ** 4 * emphasis })
  }

  if (scored.length === 0) return null

  scored.sort((a, b) => b.weight - a.weight)
  const nearest = scored.slice(0, 5)
  const total = nearest.reduce((sum, item) => sum + item.weight, 0)
  if (total <= 0) return null

  const out = { ...defaultParams() }
  for (const key of Object.keys(out) as (keyof RenderParams)[]) {
    let value = 0
    for (const item of nearest) value += item.params[key] * item.weight
    out[key] = value / total
  }

  return sanitiseParams(out)
}

/**
 * Chooses render parameters for a vision.
 *
 * Falls back cleanly at every level: no head, no neighbours and no description
 * still yields the defaults, which is exactly the tier-0 behaviour.
 */
export async function predictParams(
  visionId: string,
  imageVector: Float32Array,
): Promise<RenderParams> {
  const vision = await getVision(visionId)
  const description = vision?.description?.trim()

  let textVector: Float32Array | null = null
  if (description) {
    // The text tier is only worth its 41 MB once the user actually writes
    // something, which is precisely when this runs.
    if (await ensureTier('text')) {
      textVector = await embedText(description).catch(() => null)
    }
  }

  const head = await loadHead()
  const input = buildInput(imageVector, textVector)
  const predicted = denormalise(head.model.forward(input))

  const neighbours = await neighbourParams(imageVector)
  if (!neighbours) return head.examples > 0 ? predicted : defaultParams()

  const trust = Math.min(1, head.examples / TRUST_AT)
  return blend(neighbours, predicted, trust)
}

export const PREDICT_INTERNALS = { blend, neighbourParams, TRUST_AT }
