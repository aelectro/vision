import { getBlob, putBlob, putEmbedding } from '~/core/db/repositories'
import { recognise, type Recognition } from '~/ml/recognise'
import { embedImage, ensureTier, estimateDepth, releaseTier } from '~/ml/worker/client'

/** Longest edge fed to the models; both were trained on far smaller inputs. */
const ANALYSIS_MAX_EDGE = 768

async function bitmapFor(visionId: string, maxEdge: number): Promise<ImageBitmap | null> {
  const original = await getBlob(visionId, 'original')
  if (!original) return null

  const probe = await createImageBitmap(original.blob)
  const longest = Math.max(probe.width, probe.height)
  if (longest <= maxEdge) return probe

  const scale = maxEdge / longest
  const resized = await createImageBitmap(probe, {
    resizeWidth: Math.round(probe.width * scale),
    resizeHeight: Math.round(probe.height * scale),
    resizeQuality: 'high',
  })
  probe.close()
  return resized
}

export type AnalysisResult = {
  embedding: Float32Array | null
  recognition: Recognition | null
}

/**
 * Tier 1: encode the photo and work out what it looks like.
 *
 * Returns nulls rather than throwing when the model is unavailable. Every
 * caller already has a usable vision without this - the point of the tier
 * design is that recognition is an enhancement, not a prerequisite.
 */
export async function analyseVision(visionId: string): Promise<AnalysisResult> {
  const empty: AnalysisResult = { embedding: null, recognition: null }

  if (!(await ensureTier('vision'))) return empty

  const bitmap = await bitmapFor(visionId, ANALYSIS_MAX_EDGE)
  if (!bitmap) return empty

  try {
    const embedding = await embedImage(bitmap)
    await putEmbedding(visionId, { imageVec: embedding })
    return { embedding, recognition: await recognise(embedding) }
  } catch {
    return empty
  }
}

/**
 * Tier 2: depth, stored as an image so the renderer can upload it directly.
 *
 * The model is released afterwards. Keeping 18 MB of weights resident between
 * clips buys nothing - they are cached on disk and reload quickly - and on iOS
 * unnecessary residency is what turns a busy moment into a killed tab.
 */
export async function computeDepth(visionId: string): Promise<boolean> {
  if (await getBlob(visionId, 'depth')) return true
  if (!(await ensureTier('depth'))) return false

  const bitmap = await bitmapFor(visionId, ANALYSIS_MAX_EDGE)
  if (!bitmap) return false

  try {
    const map = await estimateDepth(bitmap)
    const canvas = document.createElement('canvas')
    canvas.width = map.width
    canvas.height = map.height

    const context = canvas.getContext('2d')
    if (!context) return false
    context.putImageData(new ImageData(map.data, map.width, map.height), 0, 0)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return false

    await putBlob(visionId, 'depth', blob)
    return true
  } catch {
    return false
  } finally {
    await releaseTier('depth')
  }
}
