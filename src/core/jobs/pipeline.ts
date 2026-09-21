import { getVision, setVisionStatus, updateVision } from '~/core/db/repositories'
import { defaultParams, parseParams, type RenderParams } from '~/ml/params'
import { renderTransform } from '~/render/transform'

export type PipelineEvent =
  | { type: 'started'; visionId: string }
  | { type: 'transformed'; visionId: string }
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
 * Work is serialised deliberately. Rendering, and later inference and video
 * encoding, all compete for the same GPU; running two visions at once is the
 * quickest way to have iOS kill the tab.
 */
let queue: Promise<void> = Promise.resolve()

export function enqueue(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task, task)
  return queue
}

/**
 * Brings a vision up to date.
 *
 * Each step is idempotent and the status is written as it goes, so closing the
 * tab mid-way leaves a record that can simply be processed again.
 */
export async function processVision(visionId: string, override?: RenderParams): Promise<void> {
  return enqueue(async () => {
    const vision = await getVision(visionId)
    if (!vision) return

    emit({ type: 'started', visionId })
    await setVisionStatus(visionId, 'working')

    try {
      const params = override ?? (await resolveParams())
      await renderTransform(visionId, { params, modelVersion: 0 })
      emit({ type: 'transformed', visionId })

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
 * Until the trained head exists, every vision gets the same starting point.
 * Personalised parameters replace this once tier 1 is in place.
 */
async function resolveParams(): Promise<RenderParams> {
  return defaultParams()
}

export async function reprocessWithParams(visionId: string, paramsJson: string): Promise<void> {
  await updateVision(visionId, {})
  await processVision(visionId, parseParams(paramsJson))
}
