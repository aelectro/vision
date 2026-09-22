/* oxlint-disable eslint/no-await-in-loop --
   Training is sequential by definition: each round has to see the weights the
   previous one produced. Running these in parallel would not test anything. */
import { beforeEach, describe, expect, it } from 'vitest'

import 'fake-indexeddb/auto'

import { db } from '~/core/db/database'
import { createVision, getModelState, putEmbedding } from '~/core/db/repositories'
import { buildInput, loadHead, resetHead } from '~/ml/head/store'
import { learnFrom, retrainFromHistory } from '~/ml/head/trainer'
import { defaultParams, denormalise, normalise, type RenderParams } from '~/ml/params'
import { EMBEDDING_SIZE } from '~/ml/tiers'

function unitVector(index: number): Float32Array {
  const vector = new Float32Array(EMBEDDING_SIZE)
  for (let i = 0; i < EMBEDDING_SIZE; i++) vector[i] = Math.sin(index * 1.7 + i * 0.021)
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm
  return vector
}

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

async function seed(seedValue: number): Promise<string> {
  const vision = await createVision({
    original: blobOf('pixels'),
    thumb: blobOf('thumb'),
    width: 100,
    height: 100,
  })
  await putEmbedding(vision.id, { imageVec: unitVector(seedValue) })
  return vision.id
}

/** Distance between what the head predicts and what the user asked for. */
async function errorFor(visionId: string, target: RenderParams): Promise<number> {
  const head = await loadHead()
  const embedding = await db.embeddings.get(visionId)
  const input = buildInput(embedding!.imageVec!, null)
  const predicted = head.model.forward(input)
  const wanted = normalise(target)

  let sum = 0
  for (let i = 0; i < wanted.length; i++) {
    const diff = predicted[i]! - wanted[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum / wanted.length)
}

beforeEach(async () => {
  await db.delete()
  await db.open()
  await resetHead()
})

describe('learnFrom', () => {
  it('moves the prediction towards what the user chose', async () => {
    const visionId = await seed(1)
    const target: RenderParams = { ...defaultParams(), edgeStrength: 0.95, contrast: 2 }

    const before = await errorFor(visionId, target)
    await learnFrom(visionId, 'edit', target)
    const after = await errorFor(visionId, target)

    expect(after).toBeLessThan(before)
  })

  it('keeps improving as the same correction is repeated', async () => {
    const visionId = await seed(2)
    const target: RenderParams = { ...defaultParams(), saturation: 1.7, posterise: 0.9 }

    const errors: number[] = [await errorFor(visionId, target)]
    for (let round = 0; round < 3; round++) {
      await learnFrom(visionId, 'edit', target)
      errors.push(await errorFor(visionId, target))
    }

    for (let i = 1; i < errors.length; i++) {
      expect(errors[i]!).toBeLessThanOrEqual(errors[i - 1]!)
    }
    expect(errors.at(-1)!).toBeLessThan(errors[0]! * 0.7)
  })

  it('records the example and persists the weights', async () => {
    const visionId = await seed(3)
    const outcome = await learnFrom(visionId, 'edit', defaultParams())

    expect(outcome.trained).toBe(true)
    expect(outcome.steps).toBeGreaterThan(0)

    const stored = await getModelState()
    expect(stored?.examples).toBe(1)
    expect(stored?.steps).toBe(outcome.steps)
  })

  it('records a dislike without training on it', async () => {
    const visionId = await seed(4)

    // There is no target to regress towards: the user said these settings were
    // wrong, not what would have been right.
    const outcome = await learnFrom(visionId, 'dislike', defaultParams())

    expect(outcome.trained).toBe(false)
    expect(await db.feedback.count()).toBe(1)
    expect((await getModelState())?.examples ?? 0).toBe(0)
  })

  it('cannot learn from a vision with no embedding', async () => {
    const vision = await createVision({
      original: blobOf('pixels'),
      thumb: blobOf('thumb'),
      width: 10,
      height: 10,
    })

    const outcome = await learnFrom(vision.id, 'edit', defaultParams())
    expect(outcome.trained).toBe(false)
  })

  it('does not forget an earlier photo while learning a new one', async () => {
    const first = await seed(10)
    const second = await seed(99)

    const firstTarget: RenderParams = { ...defaultParams(), edgeStrength: 0.95 }
    const secondTarget: RenderParams = { ...defaultParams(), edgeStrength: 0.05 }

    for (let round = 0; round < 4; round++) await learnFrom(first, 'edit', firstTarget)
    const afterFirst = await errorFor(first, firstTarget)

    for (let round = 0; round < 4; round++) await learnFrom(second, 'edit', secondTarget)
    const afterSecond = await errorFor(first, firstTarget)

    // The replay buffer exists precisely so this does not regress badly.
    expect(afterSecond).toBeLessThan(afterFirst * 2.5)
  })
})

describe('retrainFromHistory', () => {
  it('reports nothing to do when there is no history', async () => {
    expect(await retrainFromHistory(5)).toMatchObject({ trained: false, steps: 0 })
  })

  it('rebuilds a model that fits everything it has been told', async () => {
    const first = await seed(21)
    const second = await seed(42)
    const firstTarget: RenderParams = { ...defaultParams(), contrast: 2 }
    const secondTarget: RenderParams = { ...defaultParams(), contrast: 0.6 }

    await learnFrom(first, 'edit', firstTarget)
    await learnFrom(second, 'edit', secondTarget)

    await resetHead()
    const freshError = await errorFor(first, firstTarget)

    const outcome = await retrainFromHistory(120)
    expect(outcome.trained).toBe(true)
    expect(outcome.steps).toBe(120)

    expect(await errorFor(first, firstTarget)).toBeLessThan(freshError)
  })
})

describe('denormalise', () => {
  it('turns a trained prediction back into usable parameters', async () => {
    const visionId = await seed(7)
    const target: RenderParams = { ...defaultParams(), edgeStrength: 0.9 }

    for (let round = 0; round < 6; round++) await learnFrom(visionId, 'edit', target)

    const head = await loadHead()
    const embedding = await db.embeddings.get(visionId)
    const params = denormalise(head.model.forward(buildInput(embedding!.imageVec!, null)))

    expect(params.edgeStrength).toBeGreaterThan(0.6)
  })
})
