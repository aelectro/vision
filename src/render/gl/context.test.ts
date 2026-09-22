import { describe, expect, it } from 'vitest'

import { GL_LIMITS, fitWorkingSize } from '~/render/gl/context'

const caps = { maxTextureSize: 16384 }

describe('fitWorkingSize', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWorkingSize(1600, 1200, caps)).toEqual({ width: 1600, height: 1200 })
  })

  it('always returns even dimensions, because H.264 cannot encode odd ones', () => {
    // The case that actually broke: a 9:16 photo capped at 720 lands on 405.
    expect(fitWorkingSize(1080, 1920, { maxTextureSize: 720 })).toEqual({
      width: 404,
      height: 720,
    })

    for (const [w, h] of [
      [1001, 1001],
      [999, 501],
      [3, 7],
      [1920, 1081],
    ] as const) {
      const size = fitWorkingSize(w, h, caps)
      expect(size.width % 2, `${w}x${h} width`).toBe(0)
      expect(size.height % 2, `${w}x${h} height`).toBe(0)
    }
  })

  it('respects the device texture limit', () => {
    const size = fitWorkingSize(40000, 1000, { maxTextureSize: 4096 })
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(4096)
  })

  it('respects the canvas area budget, which is the real iOS limit', () => {
    const size = fitWorkingSize(8000, 8000, caps)
    expect(size.width * size.height).toBeLessThanOrEqual(GL_LIMITS.MAX_CANVAS_AREA)
  })

  it('preserves aspect ratio when it scales down', () => {
    const size = fitWorkingSize(8000, 4000, caps)
    expect(size.width / size.height).toBeCloseTo(2, 2)
  })

  it('never returns a zero dimension', () => {
    expect(fitWorkingSize(0, 0, caps)).toEqual({ width: 2, height: 2 })
    expect(fitWorkingSize(-10, 5, caps)).toEqual({ width: 2, height: 2 })

    const sliver = fitWorkingSize(30000, 1, caps)
    expect(sliver.width).toBeGreaterThan(0)
    expect(sliver.height).toBeGreaterThan(0)
  })

  it('applies both limits together rather than only the tighter one', () => {
    const size = fitWorkingSize(20000, 20000, { maxTextureSize: 8192 })
    expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(8192)
    expect(size.width * size.height).toBeLessThanOrEqual(GL_LIMITS.MAX_CANVAS_AREA)
  })
})
