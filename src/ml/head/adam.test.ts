import { describe, expect, it } from 'vitest'

import { Adam } from '~/ml/head/adam'

function writeQuadraticGradient(
  params: Float32Array,
  target: Float32Array,
  grads: Float32Array,
): number {
  let loss = 0
  const scale = 2 / params.length
  for (let i = 0; i < params.length; i++) {
    const diff = params[i]! - target[i]!
    loss += diff * diff
    grads[i] = scale * diff
  }
  return loss / params.length
}

describe('Adam', () => {
  it('applies bias correction and decoupled weight decay', () => {
    const params = new Float32Array([1])
    const grads = new Float32Array([0.5])
    const optimiser = new Adam(1, { learningRate: 0.1, weightDecay: 0.2 })

    optimiser.step(params, grads)

    expect(params[0]).toBeCloseTo(0.88, 6)
  })

  it('converges faster than plain gradient descent on a convex objective', () => {
    const target = new Float32Array([0.5, -1, 2, -3, 1.5, -0.25])
    const adamParams = new Float32Array([5, 5, 5, 5, 5, 5])
    const gdParams = new Float32Array(adamParams)
    const adamGrads = new Float32Array(adamParams.length)
    const gdGrads = new Float32Array(gdParams.length)
    const optimiser = new Adam(adamParams.length, { learningRate: 0.2 })
    const gdLearningRate = 0.03

    let adamLoss = Number.POSITIVE_INFINITY
    let gdLoss = Number.POSITIVE_INFINITY
    for (let step = 0; step < 80; step++) {
      adamLoss = writeQuadraticGradient(adamParams, target, adamGrads)
      optimiser.step(adamParams, adamGrads)

      gdLoss = writeQuadraticGradient(gdParams, target, gdGrads)
      for (let i = 0; i < gdParams.length; i++) {
        gdParams[i] = gdParams[i]! - gdLearningRate * gdGrads[i]!
      }
    }

    adamLoss = writeQuadraticGradient(adamParams, target, adamGrads)
    gdLoss = writeQuadraticGradient(gdParams, target, gdGrads)
    expect(adamLoss).toBeLessThan(gdLoss * 0.1)
  })

  it('serialises moments and resumes the same next update', () => {
    const paramsA = new Float32Array([1, -2, 3])
    const paramsB = new Float32Array(paramsA)
    const grads = new Float32Array([0.1, -0.2, 0.3])
    const a = new Adam(paramsA.length, { learningRate: 0.01 })
    const b = new Adam(paramsB.length, { learningRate: 0.01 })

    a.step(paramsA, grads)
    paramsB.set(paramsA)
    expect(b.deserialize(a.serialize())).toBe(true)
    expect(Array.from(b.moment1())).toEqual(Array.from(a.moment1()))
    expect(Array.from(b.moment2())).toEqual(Array.from(a.moment2()))
    expect(b.timestep()).toBe(a.timestep())

    a.step(paramsA, grads)
    b.step(paramsB, grads)
    expect(Array.from(paramsB)).toEqual(Array.from(paramsA))
  })

  it('rejects invalid moment snapshots cleanly', () => {
    const optimiser = new Adam(3)
    const params = new Float32Array([1, 2, 3])
    const grads = new Float32Array([0.1, 0.2, 0.3])
    optimiser.step(params, grads)
    const before = optimiser.serialize()

    expect(optimiser.deserialize(new ArrayBuffer(before.byteLength - 4))).toBe(false)
    expect(Array.from(new Uint8Array(optimiser.serialize()))).toEqual(
      Array.from(new Uint8Array(before)),
    )
  })

  it('reuses moment buffers across steps and reset', () => {
    const optimiser = new Adam(2)
    const first = optimiser.moment1()
    const second = optimiser.moment2()
    const params = new Float32Array([1, 2])
    const grads = new Float32Array([0.1, -0.1])

    optimiser.step(params, grads)
    optimiser.reset()

    expect(optimiser.moment1()).toBe(first)
    expect(optimiser.moment2()).toBe(second)
    expect(first[0]).toBe(0)
    expect(second[0]).toBe(0)
    expect(optimiser.timestep()).toBe(0)
  })
})
