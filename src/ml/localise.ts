import { EMBEDDING_SIZE } from '~/ml/tiers'
import type { Grid } from '~/render/focus'
import { embedImageBatch, ensureTier } from '~/ml/worker/client'

/** Crops overlap so a shape straddling two cells is seen whole by at least one. */
const OVERLAP = 1.6

/** What each crop is scaled to before the encoder sees it. */
const CROP_SIZE = 224

/**
 * Scores every cell of a grid by how much that part of the image looks like
 * the target.
 *
 * Crops are cut with generous overlap: a face spanning the boundary between
 * two cells would score poorly in both if each saw only half of it.
 */
export async function scoreRegions(
  image: ImageBitmap,
  target: Float32Array,
  size: number,
): Promise<Grid | null> {
  if (!(await ensureTier('vision'))) return null

  const cropWidth = (image.width / size) * OVERLAP
  const cropHeight = (image.height / size) * OVERLAP

  const rects: { left: number; top: number; width: number; height: number }[] = []
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const centreX = ((column + 0.5) / size) * image.width
      const centreY = ((row + 0.5) / size) * image.height
      const left = Math.max(0, Math.min(image.width - 1, centreX - cropWidth / 2))
      const top = Math.max(0, Math.min(image.height - 1, centreY - cropHeight / 2))
      rects.push({
        left,
        top,
        width: Math.min(cropWidth, image.width - left),
        height: Math.min(cropHeight, image.height - top),
      })
    }
  }

  const crops = await Promise.all(
    rects.map((rect) =>
      createImageBitmap(image, rect.left, rect.top, rect.width, rect.height, {
        resizeWidth: CROP_SIZE,
        resizeHeight: CROP_SIZE,
        resizeQuality: 'medium',
      }),
    ),
  )

  try {
    const vectors = await embedImageBatch(crops)
    if (!vectors || vectors.length !== crops.length) return null

    const values = new Float32Array(crops.length)
    for (let i = 0; i < vectors.length; i++) {
      values[i] = dot(vectors[i]!, target)
    }

    return { values, columns: size, rows: size }
  } finally {
    // The worker closes the ones it received; anything left here is ours.
    for (const crop of crops) {
      try {
        crop.close()
      } catch {
        // Already transferred and closed by the worker.
      }
    }
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < EMBEDDING_SIZE; i++) sum += (a[i] ?? 0) * (b[i] ?? 0)
  return sum
}
