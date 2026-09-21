const DEFAULT_LEARNING_RATE = 0.001
const DEFAULT_BETA_1 = 0.9
const DEFAULT_BETA_2 = 0.999
const DEFAULT_EPSILON = 1e-8
const DEFAULT_WEIGHT_DECAY = 0

const SERIAL_MAGIC = 0x5648414d
const SERIAL_VERSION = 1
const SERIAL_HEADER_BYTES = 16

export type AdamOptions = {
  learningRate?: number
  beta1?: number
  beta2?: number
  epsilon?: number
  weightDecay?: number
}

export class Adam {
  private readonly size: number
  private readonly learningRate: number
  private readonly beta1: number
  private readonly beta2: number
  private readonly epsilon: number
  private readonly weightDecay: number
  private readonly firstMoment: Float32Array
  private readonly secondMoment: Float32Array
  private stepCount: number

  constructor(size: number, options: AdamOptions = {}) {
    if (!Number.isInteger(size) || size <= 0) throw new Error('Adam size must be positive')

    this.size = size
    this.learningRate = options.learningRate ?? DEFAULT_LEARNING_RATE
    this.beta1 = options.beta1 ?? DEFAULT_BETA_1
    this.beta2 = options.beta2 ?? DEFAULT_BETA_2
    this.epsilon = options.epsilon ?? DEFAULT_EPSILON
    this.weightDecay = options.weightDecay ?? DEFAULT_WEIGHT_DECAY
    this.firstMoment = new Float32Array(size)
    this.secondMoment = new Float32Array(size)
    this.stepCount = 0
  }

  step(params: Float32Array, grads: Float32Array): void {
    if (params.length !== this.size || grads.length !== this.size) {
      throw new Error(`Expected parameter and gradient buffers of length ${this.size}`)
    }

    this.stepCount += 1
    const biasCorrection1 = 1 - this.beta1 ** this.stepCount
    const biasCorrection2 = 1 - this.beta2 ** this.stepCount
    const stepSize = this.learningRate / biasCorrection1
    const secondScale = Math.sqrt(biasCorrection2)
    const decayScale = 1 - this.learningRate * this.weightDecay

    for (let i = 0; i < this.size; i++) {
      const grad = grads[i]!
      const m = this.beta1 * this.firstMoment[i]! + (1 - this.beta1) * grad
      const v = this.beta2 * this.secondMoment[i]! + (1 - this.beta2) * grad * grad
      this.firstMoment[i] = m
      this.secondMoment[i] = v
      params[i] =
        params[i]! * decayScale - (stepSize * m * secondScale) / (Math.sqrt(v) + this.epsilon)
    }
  }

  reset(): void {
    this.firstMoment.fill(0)
    this.secondMoment.fill(0)
    this.stepCount = 0
  }

  moment1(): Float32Array {
    return this.firstMoment
  }

  moment2(): Float32Array {
    return this.secondMoment
  }

  timestep(): number {
    return this.stepCount
  }

  serializedBytes(): number {
    return SERIAL_HEADER_BYTES + 2 * this.size * Float32Array.BYTES_PER_ELEMENT
  }

  serialize(): ArrayBuffer {
    const buffer = new ArrayBuffer(this.serializedBytes())
    const view = new DataView(buffer)
    view.setUint32(0, SERIAL_MAGIC, true)
    view.setUint32(4, SERIAL_VERSION, true)
    view.setUint32(8, this.size, true)
    view.setUint32(12, this.stepCount, true)
    new Float32Array(buffer, SERIAL_HEADER_BYTES, this.size).set(this.firstMoment)
    new Float32Array(
      buffer,
      SERIAL_HEADER_BYTES + this.size * Float32Array.BYTES_PER_ELEMENT,
      this.size,
    ).set(this.secondMoment)
    return buffer
  }

  deserialize(buffer: ArrayBuffer): boolean {
    if (buffer.byteLength !== this.serializedBytes()) return false

    const view = new DataView(buffer)
    if (view.getUint32(0, true) !== SERIAL_MAGIC) return false
    if (view.getUint32(4, true) !== SERIAL_VERSION) return false
    if (view.getUint32(8, true) !== this.size) return false

    this.stepCount = view.getUint32(12, true)
    this.firstMoment.set(new Float32Array(buffer, SERIAL_HEADER_BYTES, this.size))
    this.secondMoment.set(
      new Float32Array(
        buffer,
        SERIAL_HEADER_BYTES + this.size * Float32Array.BYTES_PER_ELEMENT,
        this.size,
      ),
    )
    return true
  }
}
