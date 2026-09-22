import { describe, expect, it } from 'vitest'

import { WHOLE_FRAME, focusFromGrid, parseFocus, type Grid } from '~/render/focus'

function grid(rows: number[][]): Grid {
  const columns = rows[0]?.length ?? 0
  return {
    values: Float32Array.from(rows.flat()),
    columns,
    rows: rows.length,
  }
}

describe('focusFromGrid', () => {
  it('lands on an isolated peak', () => {
    const region = focusFromGrid(
      grid([
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 9, 0],
        [0, 0, 0, 0],
      ]),
    )

    // Cell (2,2) of four spans 0.5..0.75 in each axis.
    expect(region.x).toBeGreaterThan(0.5)
    expect(region.x).toBeLessThan(0.75)
    expect(region.y).toBeGreaterThan(0.5)
    expect(region.y).toBeLessThan(0.75)
    expect(region.confidence).toBeGreaterThan(0.5)
  })

  it('settles between two adjacent peaks rather than snapping to one', () => {
    const region = focusFromGrid(
      grid([
        [0, 0, 0, 0],
        [0, 8, 8, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
    )

    // The pair spans 0.25..0.75 horizontally, so the centre belongs near 0.5.
    expect(region.x).toBeCloseTo(0.5, 1)
  })

  it('reports no confidence when the field is flat', () => {
    const region = focusFromGrid(
      grid([
        [5, 5, 5],
        [5, 5, 5],
        [5, 5, 5],
      ]),
    )

    expect(region.confidence).toBeLessThan(0.12)
    expect(region.x).toBe(WHOLE_FRAME.x)
    expect(region.radius).toBe(WHOLE_FRAME.radius)
  })

  it('treats near-flat noise as nothing in particular', () => {
    const region = focusFromGrid(
      grid([
        [5.0, 5.1, 4.9],
        [5.1, 5.2, 5.0],
        [4.9, 5.0, 5.1],
      ]),
    )
    expect(region.confidence).toBeLessThan(0.2)
  })

  it('grows the radius for a broad shape', () => {
    const tight = focusFromGrid(
      grid([
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 9, 0, 0],
        [0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0],
      ]),
    )

    const broad = focusFromGrid(
      grid([
        [0, 0, 0, 0, 0],
        [0, 8, 8, 8, 0],
        [0, 8, 9, 8, 0],
        [0, 8, 8, 8, 0],
        [0, 0, 0, 0, 0],
      ]),
    )

    expect(broad.radius).toBeGreaterThan(tight.radius)
  })

  it('never proposes a region beyond the frame or smaller than useful', () => {
    for (const rows of [
      [[9, 0, 0]],
      [[0], [9], [0]],
      [
        [9, 9],
        [9, 0],
      ],
    ]) {
      const region = focusFromGrid(grid(rows))
      expect(region.x).toBeGreaterThanOrEqual(0)
      expect(region.x).toBeLessThanOrEqual(1)
      expect(region.y).toBeGreaterThanOrEqual(0)
      expect(region.y).toBeLessThanOrEqual(1)
      expect(region.radius).toBeGreaterThanOrEqual(0.16)
      expect(region.radius).toBeLessThanOrEqual(0.75)
    }
  })

  it('falls back on an empty or malformed grid', () => {
    expect(focusFromGrid({ values: new Float32Array(0), columns: 0, rows: 0 })).toEqual(WHOLE_FRAME)
    expect(focusFromGrid({ values: new Float32Array(2), columns: 4, rows: 4 })).toEqual(WHOLE_FRAME)
  })

  it('falls back when every cell is zero', () => {
    expect(
      focusFromGrid(
        grid([
          [0, 0],
          [0, 0],
        ]),
      ),
    ).toEqual(WHOLE_FRAME)
  })
})

describe('parseFocus', () => {
  it('round-trips a region', () => {
    const region = { x: 0.3, y: 0.7, radius: 0.4, confidence: 0.8 }
    expect(parseFocus(JSON.stringify(region))).toEqual(region)
  })

  it('clamps values that would put the region outside the frame', () => {
    const region = parseFocus(JSON.stringify({ x: -3, y: 9, radius: 40, confidence: 5 }))
    expect(region).toEqual({ x: 0, y: 1, radius: 1, confidence: 1 })
  })

  it('falls back on anything it cannot read', () => {
    expect(parseFocus(null)).toEqual(WHOLE_FRAME)
    expect(parseFocus('not json')).toEqual(WHOLE_FRAME)
    expect(parseFocus('{"x":"middle"}')).toEqual(WHOLE_FRAME)
  })
})
