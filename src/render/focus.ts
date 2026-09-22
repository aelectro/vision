/**
 * Working out where in the frame the image actually is.
 *
 * This is the piece the app was missing. Recognition could say "a bird", but
 * nothing ever said *where*, so the transformation emphasised every contour in
 * the picture equally - which on a textured surface reads as contrast and
 * shadow rather than as a bird.
 *
 * The input is a coarse grid of per-cell scores. Where those scores come from
 * is deliberately not this module's business: CLIP crop similarity when the
 * model is present, plain structural density when it is not.
 */

export type FocusRegion = {
  /** Centre in normalised image coordinates, origin top-left. */
  x: number
  y: number
  /** Radius as a fraction of the shorter side. */
  radius: number
  /**
   * How much the peak stands out from the rest, 0..1.
   *
   * Low means the field is flat and no region is special - a wall of uniform
   * bark. Callers should then treat the whole frame as the subject rather than
   * picking a corner at random.
   */
  confidence: number
}

/** Used when nothing stands out: the whole frame, treated evenly. */
export const WHOLE_FRAME: FocusRegion = { x: 0.5, y: 0.5, radius: 0.75, confidence: 0 }

export type Grid = {
  values: Float32Array
  columns: number
  rows: number
}

function at(grid: Grid, column: number, row: number): number {
  if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return 0
  return grid.values[row * grid.columns + column] ?? 0
}

/**
 * Turns a score grid into a region.
 *
 * The peak cell sets the centre, refined by a weighted average of its
 * neighbours so the result is not quantised to the grid. The radius grows
 * while adjacent cells stay comparably strong, which keeps a large shape large
 * without letting a single hot cell claim the frame.
 */
export function focusFromGrid(grid: Grid): FocusRegion {
  if (grid.columns < 1 || grid.rows < 1 || grid.values.length < grid.columns * grid.rows) {
    return WHOLE_FRAME
  }

  let peak = -Infinity
  let peakColumn = 0
  let peakRow = 0
  let total = 0

  for (let row = 0; row < grid.rows; row++) {
    for (let column = 0; column < grid.columns; column++) {
      const value = at(grid, column, row)
      total += value
      if (value > peak) {
        peak = value
        peakColumn = column
        peakRow = row
      }
    }
  }

  const cells = grid.columns * grid.rows
  const mean = total / cells

  if (!Number.isFinite(peak) || peak <= 0) return WHOLE_FRAME

  // A peak that barely beats the average means nothing stood out.
  const relief = mean > 0 ? (peak - mean) / peak : 1
  const confidence = Math.min(1, Math.max(0, relief * 1.8))

  if (confidence < 0.12) return { ...WHOLE_FRAME, confidence }

  // Sub-cell centre: weight the peak and its immediate neighbours by how much
  // each exceeds the mean, so a shape spanning two cells lands between them.
  let weightSum = 0
  let xSum = 0
  let ySum = 0

  for (let row = peakRow - 1; row <= peakRow + 1; row++) {
    for (let column = peakColumn - 1; column <= peakColumn + 1; column++) {
      const weight = Math.max(0, at(grid, column, row) - mean)
      if (weight <= 0) continue
      weightSum += weight
      xSum += (column + 0.5) * weight
      ySum += (row + 0.5) * weight
    }
  }

  const x = weightSum > 0 ? xSum / weightSum / grid.columns : (peakColumn + 0.5) / grid.columns
  const y = weightSum > 0 ? ySum / weightSum / grid.rows : (peakRow + 0.5) / grid.rows

  // Grow while the surroundings remain at least three quarters as strong.
  const threshold = mean + (peak - mean) * 0.25
  let reach = 1
  while (reach < Math.max(grid.columns, grid.rows)) {
    let strong = 0
    let counted = 0
    for (let row = peakRow - reach; row <= peakRow + reach; row++) {
      for (let column = peakColumn - reach; column <= peakColumn + reach; column++) {
        if (Math.abs(row - peakRow) !== reach && Math.abs(column - peakColumn) !== reach) continue
        if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) continue
        counted += 1
        if (at(grid, column, row) >= threshold) strong += 1
      }
    }
    if (counted === 0 || strong / counted < 0.5) break
    reach += 1
  }

  const cellSize = 1 / Math.min(grid.columns, grid.rows)
  const radius = Math.min(0.75, Math.max(0.16, reach * cellSize * 0.85))

  return { x, y, radius, confidence }
}

/** Serialised alongside the vision, so a re-render need not locate it again. */
export function parseFocus(json: string | null): FocusRegion {
  if (!json) return WHOLE_FRAME
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return WHOLE_FRAME
    const region = parsed as Partial<FocusRegion>
    if (
      typeof region.x !== 'number' ||
      typeof region.y !== 'number' ||
      typeof region.radius !== 'number'
    ) {
      return WHOLE_FRAME
    }
    return {
      x: Math.min(1, Math.max(0, region.x)),
      y: Math.min(1, Math.max(0, region.y)),
      radius: Math.min(1, Math.max(0.05, region.radius)),
      confidence: Math.min(1, Math.max(0, region.confidence ?? 0)),
    }
  } catch {
    return WHOLE_FRAME
  }
}
