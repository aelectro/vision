import { getBlob, updateVision } from '~/core/db/repositories'
import type { RenderParams } from '~/ml/params'
import { archetypeVector } from '~/ml/vocabulary'
import { WHOLE_FRAME, focusFromGrid, type FocusRegion, type Grid } from '~/render/focus'
import { VisionRenderer } from '~/render/gl/renderer'

/** Small enough to stay cheap, large enough to say which third of the frame. */
const GRID = 6

/** Localisation runs on a small copy; the region is normalised anyway. */
const LOCATE_MAX_EDGE = 512

/**
 * Finds where in the frame the image is.
 *
 * Two sources, in order of how much they know:
 *
 *  1. CLIP scores a grid of crops against the archetype that was recognised.
 *     This actually knows it is looking for a bird, so it can tell a bird-like
 *     patch of bark from a merely busy one.
 *  2. Failing that, the density of coherent structure from the shader chain.
 *     It does not know what the shape is, only where the lines that could form
 *     one are - but that is still far better than treating the frame evenly.
 *
 * Returns a region with zero confidence rather than throwing when neither
 * works, which the renderer reads as "emphasise nothing in particular".
 */
export async function locateImage(
  visionId: string,
  params: RenderParams,
  archetypeKey: string | null,
): Promise<FocusRegion> {
  const structural = await structuralGrid(visionId, params)
  if (!structural) return WHOLE_FRAME

  const semantic = archetypeKey ? await semanticGrid(visionId, archetypeKey) : null

  // Both together beat either alone: CLIP knows what to look for but is coarse
  // and noisy at this crop size, while structure is precise about where the
  // lines are without knowing what they mean.
  const grid = semantic ? combine(semantic, structural) : structural
  const region = focusFromGrid(grid)

  await updateVision(visionId, { focusJson: JSON.stringify(region) })
  return region
}

function combine(semantic: Grid, structural: Grid): Grid {
  if (semantic.columns !== structural.columns || semantic.rows !== structural.rows) {
    return semantic
  }

  const values = new Float32Array(semantic.values.length)
  for (let i = 0; i < values.length; i++) {
    values[i] = normalisedAt(semantic, i) * 0.7 + normalisedAt(structural, i) * 0.3
  }
  return { values, columns: semantic.columns, rows: semantic.rows }
}

/** Rescales a grid to 0..1 so two different score scales can be mixed. */
function normalisedAt(grid: Grid, index: number): number {
  let min = Infinity
  let max = -Infinity
  for (const value of grid.values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  if (!Number.isFinite(min) || max <= min) return 0
  return ((grid.values[index] ?? min) - min) / (max - min)
}

async function structuralGrid(visionId: string, params: RenderParams): Promise<Grid | null> {
  const original = await getBlob(visionId, 'original')
  if (!original) return null

  const bitmap = await createImageBitmap(original.blob)
  const renderer = VisionRenderer.create(bitmap.width, bitmap.height, LOCATE_MAX_EDGE)

  try {
    await renderer.setSource(bitmap)
    return renderer.edgeGrid(params, GRID, GRID)
  } catch {
    return null
  } finally {
    bitmap.close()
    renderer.dispose()
  }
}

/**
 * Scores a grid of crops against the recognised archetype.
 *
 * Reuses the vision tower that tier 1 already downloaded - asking it "how much
 * does this patch look like a bird" is the same question as before, only asked
 * of pieces of the frame instead of the whole thing.
 */
async function semanticGrid(visionId: string, archetypeKey: string): Promise<Grid | null> {
  const original = await getBlob(visionId, 'original')
  if (!original) return null

  try {
    const { scoreRegions } = await import('~/ml/localise')
    const target = await archetypeVector(archetypeKey)
    if (!target) return null

    const bitmap = await createImageBitmap(original.blob)
    try {
      return await scoreRegions(bitmap, target, GRID)
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}
