import { getVision, setVisionStatus, updateVision } from '~/core/db/repositories'
import { analyseVision, computeDepth } from '~/ml/analyse'
import { defaultParams, parseParams, type RenderParams } from '~/ml/params'
import { renderTransform } from '~/render/transform'

export type PipelineEvent =
  | { type: 'started'; visionId: string }
  | { type: 'transformed'; visionId: string }
  | { type: 'recognised'; visionId: string }
  | { type: 'videoProgress'; visionId: string; fraction: number }
  | { type: 'finished'; visionId: string }
  | { type: 'failed'; visionId: string; message: string }

type Listener = (event: PipelineEvent) => void

const listeners = new Set<Listener>()

export function onPipelineEvent(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event: PipelineEvent): void {
  for (const listener of listeners) listener(event)
}

/**
 * Work is serialised deliberately. Rendering, inference and video encoding all
 * compete for the same GPU; running two visions at once is the quickest way to
 * have iOS kill the tab.
 */
let queue: Promise<void> = Promise.resolve()

export function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task)
  return queue
}

/**
 * Brings a vision up to date.
 *
 * Ordered so the user sees something as early as possible: the shader
 * transformation needs no model at all and lands within a second, recognition
 * and personalised parameters refine it afterwards, and the clip - by far the
 * most expensive step - comes last.
 *
 * Every step is idempotent and the status is written as it goes, so closing
 * the tab midway leaves a record that can simply be processed again.
 */
export async function processVision(visionId: string, override?: RenderParams): Promise<void> {
  return enqueue(async () => {
    const vision = await getVision(visionId)
    if (!vision) return

    emit({ type: 'started', visionId })
    await setVisionStatus(visionId, 'working')

    try {
      const baseline = override ?? defaultParams()
      await renderTransform(visionId, { params: baseline, modelVersion: 0 })
      emit({ type: 'transformed', visionId })

      let params = baseline
      if (!override) {
        const refined = await refine(visionId)
        if (refined) {
          params = refined
          await renderTransform(visionId, { params, modelVersion: 1 })
          emit({ type: 'transformed', visionId })
        }
      }

      await computeDepth(visionId)
      await makeVideo(visionId, params)

      await setVisionStatus(visionId, 'ready')
      emit({ type: 'finished', visionId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await setVisionStatus(visionId, 'failed', message)
      emit({ type: 'failed', visionId, message })
    }
  })
}

/**
 * Recognises the subject and asks the trained head for parameters suited to it.
 *
 * Returns null when the model tier is unavailable, in which case the baseline
 * render already on screen simply stands.
 */
async function refine(visionId: string): Promise<RenderParams | null> {
  const { embedding, recognition } = await analyseVision(visionId)
  if (!embedding) return null

  if (recognition) {
    await updateVision(visionId, {
      autoLabel: recognition.confident ? recognition.key : null,
      autoConfidence: recognition.confidence,
    })
    emit({ type: 'recognised', visionId })
  }

  const { predictParams } = await import('~/ml/head/predict')
  return predictParams(visionId, embedding)
}

async function makeVideo(visionId: string, params: RenderParams): Promise<void> {
  // Loaded on demand: the muxer and its codec tables are a sizeable chunk, and
  // nothing about capture or the still transformation needs them.
  const video = await import('~/render/video')
  try {
    await video.exportVideo(visionId, {
      params,
      modelVersion: 1,
      onProgress: (fraction) => emit({ type: 'videoProgress', visionId, fraction }),
    })
  } catch (error) {
    // The still is already saved and useful, so a browser that cannot encode
    // video is a missing feature rather than a failed vision.
    if (!(error instanceof video.VideoUnsupportedError)) throw error
  }
}

export async function reprocessWithParams(visionId: string, paramsJson: string): Promise<void> {
  await processVision(visionId, parseParams(paramsJson))
}
