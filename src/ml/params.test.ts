import { describe, expect, it } from 'vitest'

import {
  PARAM_COUNT,
  PARAM_KEYS,
  PARAM_RANGES,
  defaultParams,
  denormalise,
  normalise,
  parseParams,
  sanitiseParams,
} from '~/ml/params'

describe('parameter ranges', () => {
  it('has a default inside every range', () => {
    for (const key of PARAM_KEYS) {
      const range = PARAM_RANGES[key]
      expect(range.min).toBeLessThan(range.max)
      expect(range.default).toBeGreaterThanOrEqual(range.min)
      expect(range.default).toBeLessThanOrEqual(range.max)
    }
  })

  it('reports a count matching the key list', () => {
    expect(PARAM_COUNT).toBe(PARAM_KEYS.length)
    expect(PARAM_COUNT).toBeGreaterThan(0)
  })
})

describe('normalise / denormalise', () => {
  it('round-trips the defaults', () => {
    const before = defaultParams()
    const after = denormalise(normalise(before))

    for (const key of PARAM_KEYS) {
      expect(after[key]).toBeCloseTo(before[key], 5)
    }
  })

  it('maps the extremes to 0 and 1', () => {
    const low = sanitiseParams(
      Object.fromEntries(PARAM_KEYS.map((k) => [k, PARAM_RANGES[k].min])) as never,
    )
    const high = sanitiseParams(
      Object.fromEntries(PARAM_KEYS.map((k) => [k, PARAM_RANGES[k].max])) as never,
    )

    for (const value of normalise(low)) expect(value).toBeCloseTo(0, 6)
    for (const value of normalise(high)) expect(value).toBeCloseTo(1, 6)
  })

  it('clamps network output that escapes [0, 1]', () => {
    const params = denormalise(new Float32Array(PARAM_COUNT).fill(5))
    for (const key of PARAM_KEYS) {
      expect(params[key]).toBeLessThanOrEqual(PARAM_RANGES[key].max)
      expect(params[key]).toBeGreaterThanOrEqual(PARAM_RANGES[key].min)
    }
  })

  it('rounds controls that only make sense as integers', () => {
    const vector = new Float32Array(PARAM_COUNT).fill(0.5)
    expect(Number.isInteger(denormalise(vector).levels)).toBe(true)
  })

  it('falls back to the middle of the range for missing or broken values', () => {
    const params = denormalise([Number.NaN])
    const contrast = PARAM_RANGES.contrast
    expect(params.edgeStrength).toBeCloseTo(0.5, 6)
    expect(params.contrast).toBeCloseTo(contrast.min + 0.5 * (contrast.max - contrast.min), 6)
  })
})

describe('sanitiseParams', () => {
  it('fills gaps with defaults and clamps the rest', () => {
    const params = sanitiseParams({ edgeStrength: 99, contrast: -99 })
    expect(params.edgeStrength).toBe(PARAM_RANGES.edgeStrength.max)
    expect(params.contrast).toBe(PARAM_RANGES.contrast.min)
    expect(params.grain).toBe(PARAM_RANGES.grain.default)
  })

  it('treats non-finite values as broken input rather than extremes', () => {
    const params = sanitiseParams({ vignette: Number.NaN, zoom: Number.POSITIVE_INFINITY })
    expect(params.vignette).toBe(PARAM_RANGES.vignette.default)
    expect(params.zoom).toBe(PARAM_RANGES.zoom.default)
  })
})

describe('parseParams', () => {
  it('reads back what was written', () => {
    const params = defaultParams()
    params.edgeStrength = 0.9
    expect(parseParams(JSON.stringify(params)).edgeStrength).toBeCloseTo(0.9, 6)
  })

  it('survives corrupt or unexpected payloads', () => {
    expect(parseParams('not json')).toEqual(defaultParams())
    expect(parseParams('null')).toEqual(defaultParams())
    expect(parseParams('[1,2,3]').edgeStrength).toBe(PARAM_RANGES.edgeStrength.default)
  })
})
