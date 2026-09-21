import { describe, expect, it } from 'vitest'

import { clamp, lerp, smoothstep } from '~/core/math'

describe('clamp', () => {
  it('keeps values inside the range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-3, 0, 10)).toBe(0)
    expect(clamp(42, 0, 10)).toBe(10)
  })
})

describe('lerp', () => {
  it('interpolates between the endpoints', () => {
    expect(lerp(0, 10, 0)).toBe(0)
    expect(lerp(0, 10, 1)).toBe(10)
    expect(lerp(0, 10, 0.25)).toBe(2.5)
  })
})

describe('smoothstep', () => {
  it('is flat outside the edges and centred in between', () => {
    expect(smoothstep(0, 1, -1)).toBe(0)
    expect(smoothstep(0, 1, 2)).toBe(1)
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5, 10)
  })

  it('collapses to a step when the edges coincide', () => {
    expect(smoothstep(1, 1, 0.5)).toBe(0)
    expect(smoothstep(1, 1, 1.5)).toBe(1)
  })
})
