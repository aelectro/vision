import { PARAM_COUNT } from '~/ml/params'

export const MLP_INPUT_SIZE = 1024
export const MLP_HIDDEN_1_SIZE = 256
export const MLP_HIDDEN_2_SIZE = 128
export const MLP_OUTPUT_SIZE = PARAM_COUNT

const LEAKY_RELU_SLOPE = 0.01

const W1_OFFSET = 0
const W1_SIZE = MLP_HIDDEN_1_SIZE * MLP_INPUT_SIZE
const B1_OFFSET = W1_OFFSET + W1_SIZE
const B1_SIZE = MLP_HIDDEN_1_SIZE

const W2_OFFSET = B1_OFFSET + B1_SIZE
const W2_SIZE = MLP_HIDDEN_2_SIZE * MLP_HIDDEN_1_SIZE
const B2_OFFSET = W2_OFFSET + W2_SIZE
const B2_SIZE = MLP_HIDDEN_2_SIZE

const W3_OFFSET = B2_OFFSET + B2_SIZE
const W3_SIZE = MLP_OUTPUT_SIZE * MLP_HIDDEN_2_SIZE
const B3_OFFSET = W3_OFFSET + W3_SIZE
const B3_SIZE = MLP_OUTPUT_SIZE

export const MLP_PARAMETER_COUNT = B3_OFFSET + B3_SIZE
export const MLP_SERIALIZED_BYTES = MLP_PARAMETER_COUNT * Float32Array.BYTES_PER_ELEMENT

export type RandomSource = () => number

export type MlpHeadOptions = {
  random?: RandomSource
}

/**
 * The trainable head: CLIP image and text embeddings in, render parameters out.
 *
 * Everything lives in flat Float32Array buffers and nothing is allocated
 * during forward or backward. That is the whole performance story - a phone
 * can afford the arithmetic easily, but not the garbage collection that a
 * per-step allocation pattern would cause.
 */
export class MlpHead {
  private readonly paramsBuffer: Float32Array
  private readonly gradsBuffer: Float32Array
  private readonly hidden1: Float32Array
  private readonly hidden2: Float32Array
  private readonly output: Float32Array
  private readonly delta1: Float32Array
  private readonly delta2: Float32Array
  private readonly delta3: Float32Array
  private lastInput: Float32Array | null

  constructor(options: MlpHeadOptions = {}) {
    this.paramsBuffer = new Float32Array(MLP_PARAMETER_COUNT)
    this.gradsBuffer = new Float32Array(MLP_PARAMETER_COUNT)
    this.hidden1 = new Float32Array(MLP_HIDDEN_1_SIZE)
    this.hidden2 = new Float32Array(MLP_HIDDEN_2_SIZE)
    this.output = new Float32Array(MLP_OUTPUT_SIZE)
    this.delta1 = new Float32Array(MLP_HIDDEN_1_SIZE)
    this.delta2 = new Float32Array(MLP_HIDDEN_2_SIZE)
    this.delta3 = new Float32Array(MLP_OUTPUT_SIZE)
    this.lastInput = null

    this.initialise(options.random ?? Math.random)
  }

  parameters(): Float32Array {
    return this.paramsBuffer
  }

  gradients(): Float32Array {
    return this.gradsBuffer
  }

  forward(input: Float32Array): Float32Array {
    if (input.length !== MLP_INPUT_SIZE) {
      throw new Error(`Expected ${MLP_INPUT_SIZE} inputs, got ${input.length}`)
    }

    // Held by reference rather than copied: backward() must see exactly the
    // vector that produced the activations, so callers must not mutate it in
    // between.
    this.lastInput = input
    denseLeaky(
      input,
      this.paramsBuffer,
      W1_OFFSET,
      B1_OFFSET,
      MLP_INPUT_SIZE,
      MLP_HIDDEN_1_SIZE,
      this.hidden1,
    )
    denseLeaky(
      this.hidden1,
      this.paramsBuffer,
      W2_OFFSET,
      B2_OFFSET,
      MLP_HIDDEN_1_SIZE,
      MLP_HIDDEN_2_SIZE,
      this.hidden2,
    )
    denseSigmoid(
      this.hidden2,
      this.paramsBuffer,
      W3_OFFSET,
      B3_OFFSET,
      MLP_HIDDEN_2_SIZE,
      MLP_OUTPUT_SIZE,
      this.output,
    )

    return this.output
  }

  /**
   * Accumulates gradients and returns the loss. Gradients add to whatever is
   * already there so a mini-batch is just repeated forward/backward pairs
   * followed by one optimiser step; call zeroGrad() to start a new batch.
   */
  backward(target: Float32Array): number {
    if (target.length !== MLP_OUTPUT_SIZE) {
      throw new Error(`Expected ${MLP_OUTPUT_SIZE} targets, got ${target.length}`)
    }
    const input = this.lastInput
    if (input === null) throw new Error('forward() must be called before backward()')

    let loss = 0
    const invOutputSize = 1 / MLP_OUTPUT_SIZE
    for (let o = 0; o < MLP_OUTPUT_SIZE; o++) {
      const y = this.output[o]!
      const diff = y - target[o]!
      loss += diff * diff
      this.delta3[o] = 2 * invOutputSize * diff * y * (1 - y)
    }

    clear(this.delta2)
    backpropDense(
      this.hidden2,
      this.delta3,
      this.paramsBuffer,
      this.gradsBuffer,
      W3_OFFSET,
      B3_OFFSET,
      MLP_HIDDEN_2_SIZE,
      MLP_OUTPUT_SIZE,
      this.delta2,
    )
    applyLeakyDerivative(this.hidden2, this.delta2)

    clear(this.delta1)
    backpropDense(
      this.hidden1,
      this.delta2,
      this.paramsBuffer,
      this.gradsBuffer,
      W2_OFFSET,
      B2_OFFSET,
      MLP_HIDDEN_1_SIZE,
      MLP_HIDDEN_2_SIZE,
      this.delta1,
    )
    applyLeakyDerivative(this.hidden1, this.delta1)

    backpropDenseNoInputDelta(
      input,
      this.delta1,
      this.gradsBuffer,
      W1_OFFSET,
      B1_OFFSET,
      MLP_INPUT_SIZE,
      MLP_HIDDEN_1_SIZE,
    )

    return loss * invOutputSize
  }

  zeroGrad(): void {
    this.gradsBuffer.fill(0)
  }
  serialize(): ArrayBuffer {
    const buffer = new ArrayBuffer(MLP_SERIALIZED_BYTES)
    new Float32Array(buffer).set(this.paramsBuffer)
    return buffer
  }

  deserialize(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength !== MLP_SERIALIZED_BYTES) return false
    this.paramsBuffer.set(new Float32Array(buffer))
    return true
  }

  private initialise(random: RandomSource): void {
    fillUniform(this.paramsBuffer, W1_OFFSET, W1_SIZE, heUniformLimit(MLP_INPUT_SIZE), random)
    fillUniform(this.paramsBuffer, W2_OFFSET, W2_SIZE, heUniformLimit(MLP_HIDDEN_1_SIZE), random)
    fillUniform(
      this.paramsBuffer,
      W3_OFFSET,
      W3_SIZE,
      xavierUniformLimit(MLP_HIDDEN_2_SIZE, MLP_OUTPUT_SIZE),
      random,
    )
  }
}

function denseLeaky(
  input: Float32Array,
  params: Float32Array,
  weightOffset: number,
  biasOffset: number,
  inputSize: number,
  outputSize: number,
  output: Float32Array,
): void {
  for (let o = 0; o < outputSize; o++) {
    let sum = params[biasOffset + o]!
    const row = weightOffset + o * inputSize
    for (let i = 0; i < inputSize; i++) sum += params[row + i]! * input[i]!
    output[o] = sum >= 0 ? sum : LEAKY_RELU_SLOPE * sum
  }
}

function denseSigmoid(
  input: Float32Array,
  params: Float32Array,
  weightOffset: number,
  biasOffset: number,
  inputSize: number,
  outputSize: number,
  output: Float32Array,
): void {
  for (let o = 0; o < outputSize; o++) {
    let sum = params[biasOffset + o]!
    const row = weightOffset + o * inputSize
    for (let i = 0; i < inputSize; i++) sum += params[row + i]! * input[i]!
    output[o] = sigmoid(sum)
  }
}

function backpropDense(
  input: Float32Array,
  deltaOut: Float32Array,
  params: Float32Array,
  grads: Float32Array,
  weightOffset: number,
  biasOffset: number,
  inputSize: number,
  outputSize: number,
  deltaInput: Float32Array,
): void {
  for (let o = 0; o < outputSize; o++) {
    const delta = deltaOut[o]!
    const row = weightOffset + o * inputSize
    grads[biasOffset + o] = grads[biasOffset + o]! + delta
    for (let i = 0; i < inputSize; i++) {
      grads[row + i] = grads[row + i]! + delta * input[i]!
      deltaInput[i] = deltaInput[i]! + params[row + i]! * delta
    }
  }
}

function backpropDenseNoInputDelta(
  input: Float32Array,
  deltaOut: Float32Array,
  grads: Float32Array,
  weightOffset: number,
  biasOffset: number,
  inputSize: number,
  outputSize: number,
): void {
  for (let o = 0; o < outputSize; o++) {
    const delta = deltaOut[o]!
    const row = weightOffset + o * inputSize
    grads[biasOffset + o] = grads[biasOffset + o]! + delta
    for (let i = 0; i < inputSize; i++) {
      grads[row + i] = grads[row + i]! + delta * input[i]!
    }
  }
}

function applyLeakyDerivative(activation: Float32Array, delta: Float32Array): void {
  // Works on the post-activation value because leaky ReLU preserves sign: the
  // output is negative exactly when the pre-activation was.
  for (let i = 0; i < activation.length; i++) {
    if (activation[i]! < 0) delta[i] = delta[i]! * LEAKY_RELU_SLOPE
  }
}

function clear(buffer: Float32Array): void {
  buffer.fill(0)
}

function fillUniform(
  buffer: Float32Array,
  offset: number,
  size: number,
  limit: number,
  random: RandomSource,
): void {
  const scale = 2 * limit
  for (let i = 0; i < size; i++) buffer[offset + i] = random() * scale - limit
}

function heUniformLimit(fanIn: number): number {
  return Math.sqrt(6 / fanIn)
}

function xavierUniformLimit(fanIn: number, fanOut: number): number {
  return Math.sqrt(6 / (fanIn + fanOut))
}

function sigmoid(x: number): number {
  if (x >= 0) {
    const z = Math.exp(-x)
    return 1 / (1 + z)
  }
  const z = Math.exp(x)
  return z / (1 + z)
}
