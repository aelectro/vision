import { describe, expect, it } from 'vitest'

import {
  MLP_HIDDEN_1_SIZE,
  MLP_HIDDEN_2_SIZE,
  MLP_INPUT_SIZE,
  MLP_OUTPUT_SIZE,
  MLP_PARAMETER_COUNT,
  MlpHead,
} from '~/ml/head/mlp'

function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function makeInput(): Float32Array {
  const input = new Float32Array(MLP_INPUT_SIZE)
  for (let i = 0; i < input.length; i++) {
    input[i] = 0.6 * Math.sin(i * 0.013) + 0.4 * Math.cos(i * 0.031)
  }
  return input
}

function makeTarget(): Float32Array {
  const target = new Float32Array(MLP_OUTPUT_SIZE)
  for (let i = 0; i < target.length; i++) target[i] = (i + 1) / (MLP_OUTPUT_SIZE + 1)
  return target
}

function mse(output: Float32Array, target: Float32Array): number {
  let loss = 0
  for (let i = 0; i < output.length; i++) {
    const diff = output[i]! - target[i]!
    loss += diff * diff
  }
  return loss / output.length
}

describe('MlpHead', () => {
  it('keeps outputs inside the parameter range', () => {
    const model = new MlpHead({ random: lcg(1) })
    const output = model.forward(makeInput())

    expect(output.length).toBe(MLP_OUTPUT_SIZE)
    for (const value of output) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('matches finite-difference gradients for weights and biases in every layer', () => {
    const model = new MlpHead({ random: lcg(2) })
    const input = makeInput()
    const target = makeTarget()
    const params = model.parameters()
    const grads = model.gradients()

    const w1 = 0
    const b1 = w1 + MLP_HIDDEN_1_SIZE * MLP_INPUT_SIZE
    const w2 = b1 + MLP_HIDDEN_1_SIZE
    const b2 = w2 + MLP_HIDDEN_2_SIZE * MLP_HIDDEN_1_SIZE
    const w3 = b2 + MLP_HIDDEN_2_SIZE
    const b3 = w3 + MLP_OUTPUT_SIZE * MLP_HIDDEN_2_SIZE

    const slices = [
      ['w1', w1, b1],
      ['b1', b1, w2],
      ['w2', w2, b2],
      ['b2', b2, w3],
      ['w3', w3, b3],
      ['b3', b3, MLP_PARAMETER_COUNT],
    ] as const

    model.zeroGrad()
    model.forward(input)
    model.backward(target)

    // Directional derivatives rather than one weight at a time.
    //
    // A single first-layer weight has a gradient around 7e-4, because it is
    // one of 262144 sharing the same output - far too small to distinguish
    // from float32 noise, so a per-weight check there proves nothing. Stepping
    // along the whole slice's gradient direction accumulates the contribution
    // of every weight in the layer into one well-conditioned number, and the
    // expected answer is simply the gradient's norm.
    const epsilon = 0.01
    const saved = Float32Array.from(params)

    for (const [name, start, end] of slices) {
      let norm = 0
      for (let i = start; i < end; i++) norm += grads[i]! * grads[i]!
      norm = Math.sqrt(norm)
      expect(norm, `${name} has a non-zero gradient`).toBeGreaterThan(1e-6)

      const stepAlong = (sign: number) => {
        for (let i = start; i < end; i++) {
          params[i] = saved[i]! + (sign * epsilon * grads[i]!) / norm
        }
        const loss = mse(model.forward(input), target)
        params.set(saved)
        return loss
      }

      const numerical = (stepAlong(1) - stepAlong(-1)) / (2 * epsilon)
      // Along its own normalised direction the derivative is the norm itself.
      expect(Math.abs(numerical - norm), name).toBeLessThanOrEqual(1e-5 + norm * 0.02)
    }
  })

  it('reduces loss monotonically for one training example', () => {
    const model = new MlpHead({ random: lcg(3) })
    const input = makeInput()
    const target = makeTarget()
    let previous = Number.POSITIVE_INFINITY
    const learningRate = 0.005

    for (let step = 0; step < 80; step++) {
      model.zeroGrad()
      model.forward(input)
      const loss = model.backward(target)

      expect(loss).toBeLessThanOrEqual(previous + 1e-6)
      const params = model.parameters()
      const grads = model.gradients()
      for (let i = 0; i < MLP_PARAMETER_COUNT; i++)
        params[i] = params[i]! - learningRate * grads[i]!
      previous = loss
    }
  })

  it('serialises parameters exactly and preserves predictions', () => {
    const input = makeInput()
    const before = new MlpHead({ random: lcg(4) })
    const prediction = before.forward(input).slice()
    const serialized = before.serialize()
    const after = new MlpHead({ random: lcg(5) })

    expect(after.deserialize(serialized)).toBe(true)
    expect(Array.from(after.parameters())).toEqual(Array.from(before.parameters()))
    expect(Array.from(after.forward(input))).toEqual(Array.from(prediction))
  })

  it('rejects wrong-sized serialised parameters without changing the model', () => {
    const model = new MlpHead({ random: lcg(6) })
    const before = model.serialize()

    expect(model.deserialize(new ArrayBuffer(before.byteLength - 4))).toBe(false)
    expect(Array.from(model.parameters())).toEqual(Array.from(new Float32Array(before)))
  })

  it('reuses its training buffers across calls', () => {
    const model = new MlpHead({ random: lcg(7) })
    const input = makeInput()
    const target = makeTarget()
    const params = model.parameters()
    const grads = model.gradients()
    const firstOutput = model.forward(input)

    model.zeroGrad()
    model.backward(target)
    const secondOutput = model.forward(input)

    expect(model.parameters()).toBe(params)
    expect(model.gradients()).toBe(grads)
    expect(secondOutput).toBe(firstOutput)
  })
})
