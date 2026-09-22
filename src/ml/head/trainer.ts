import { addFeedback, getEmbedding, listFeedback } from '~/core/db/repositories'
import type { FeedbackSignal } from '~/core/db/types'
import { yieldToBrowser } from '~/core/scheduling'
import { buildInput, loadHead, persistHead, resetHead } from '~/ml/head/store'
import { MLP_INPUT_SIZE } from '~/ml/head/mlp'
import { normalise, parseParams, type RenderParams } from '~/ml/params'

/** Steps taken per feedback event. Roughly 30 ms on a phone. */
const STEPS = 40

/**
 * Old examples replayed alongside each new one.
 *
 * Without this the head would chase the most recent photo and forget
 * everything before it - the classic failure of training online on a stream of
 * one. Mixing in a random sample of history costs almost nothing at this size
 * and is what makes "gets better" mean better overall rather than better at
 * the last thing you did.
 */
const REPLAY = 15

type Example = { input: Float32Array; target: Float32Array }

async function buildExample(visionId: string, params: RenderParams): Promise<Example | null> {
  const embedding = await getEmbedding(visionId)
  if (!embedding?.imageVec) return null

  return {
    input: buildInput(embedding.imageVec, embedding.textVec, new Float32Array(MLP_INPUT_SIZE)),
    target: normalise(params),
  }
}

async function replayBuffer(excludeVisionId: string): Promise<Example[]> {
  const history = (await listFeedback()).filter(
    (entry) => entry.visionId !== excludeVisionId && entry.signal !== 'dislike',
  )

  // Sample rather than take the most recent, so the buffer stays a picture of
  // the user's taste overall instead of the last few minutes of it.
  const pool = [...history]
  const picked: typeof history = []
  while (picked.length < REPLAY && pool.length > 0) {
    const [entry] = pool.splice(Math.floor(Math.random() * pool.length), 1)
    if (entry) picked.push(entry)
  }

  const built = await Promise.all(
    picked.map((entry) => buildExample(entry.visionId, parseParams(entry.paramsJson))),
  )

  return built.filter((example): example is Example => example !== null)
}

export type TrainingOutcome = {
  trained: boolean
  steps: number
  loss: number
}

/**
 * Records a piece of feedback and learns from it immediately.
 *
 * The user's accepted parameters are the target: whatever they settled on for
 * this image is, by definition, the right answer for it.
 */
export async function learnFrom(
  visionId: string,
  signal: FeedbackSignal,
  params: RenderParams,
): Promise<TrainingOutcome> {
  await addFeedback(visionId, signal, params)

  const head = await loadHead()

  // A dislike says the parameters were wrong but not what would have been
  // right, so there is nothing to regress towards. It is kept as history for
  // the neighbour search to avoid, and that is all.
  if (signal === 'dislike') {
    return { trained: false, steps: head.steps, loss: head.lossEma }
  }

  const example = await buildExample(visionId, params)
  if (!example) return { trained: false, steps: head.steps, loss: head.lossEma }

  const batch = [example, ...(await replayBuffer(visionId))]

  let lastLoss = 0
  for (let step = 0; step < STEPS; step++) {
    head.model.zeroGrad()

    let loss = 0
    for (const item of batch) {
      head.model.forward(item.input)
      loss += head.model.backward(item.target)
    }

    head.optimiser.step(head.model.parameters(), head.model.gradients())
    lastLoss = loss / batch.length

    // Roughly every 50 ms on a phone. Long enough to make progress, short
    // enough that a tap still lands.
    // oxlint-disable-next-line eslint/no-await-in-loop
    if (step % 8 === 7) await yieldToBrowser()
  }

  head.steps += STEPS
  head.examples += 1
  // Smoothed so the settings screen shows a trend rather than the noise of
  // whichever photo happened to come last.
  head.lossEma = head.lossEma === 0 ? lastLoss : head.lossEma * 0.9 + lastLoss * 0.1

  await persistHead(head)

  return { trained: true, steps: head.steps, loss: head.lossEma }
}

/**
 * Retrains from scratch over everything the user has ever approved.
 *
 * Offered because online training is order-dependent: a model that learned
 * from a hundred photos in sequence is not the same as one that learned from
 * all hundred at once, and occasionally the second is noticeably better.
 */
export async function retrainFromHistory(epochs = 30): Promise<TrainingOutcome> {
  await resetHead()

  const head = await loadHead()
  const history = (await listFeedback()).filter((entry) => entry.signal !== 'dislike')

  const built = await Promise.all(
    history.map((entry) => buildExample(entry.visionId, parseParams(entry.paramsJson))),
  )
  const examples = built.filter((example): example is Example => example !== null)

  if (examples.length === 0) return { trained: false, steps: 0, loss: 0 }

  let lastLoss = 0
  for (let epoch = 0; epoch < epochs; epoch++) {
    head.model.zeroGrad()

    let loss = 0
    for (const item of examples) {
      head.model.forward(item.input)
      loss += head.model.backward(item.target)
    }

    head.optimiser.step(head.model.parameters(), head.model.gradients())
    lastLoss = loss / examples.length

    // oxlint-disable-next-line eslint/no-await-in-loop
    if (epoch % 8 === 7) await yieldToBrowser()
  }

  head.steps = epochs
  head.examples = examples.length
  head.lossEma = lastLoss
  await persistHead(head)

  return { trained: true, steps: head.steps, loss: head.lossEma }
}
