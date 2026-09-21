import { describe, expect, it } from 'vitest'

import { ARCHETYPES } from '~/ml/archetypes'
import { RECOGNITION_THRESHOLDS } from '~/ml/recognise'
import { EMBEDDING_SIZE } from '~/ml/tiers'
import { rank } from '~/ml/vocabulary'

function unit(seed: number): Float32Array {
  const vector = new Float32Array(EMBEDDING_SIZE)
  for (let i = 0; i < EMBEDDING_SIZE; i++) vector[i] = Math.sin(seed * 0.7 + i * 0.013)
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm
  return vector
}

function vocabularyOf(vectors: Float32Array[]) {
  const matrix = new Float32Array(vectors.length * EMBEDDING_SIZE)
  vectors.forEach((vector, index) => matrix.set(vector, index * EMBEDDING_SIZE))
  return { keys: vectors.map((_, index) => `k${index}`), matrix }
}

describe('archetype vocabulary', () => {
  it('has unique keys and both translations for every entry', () => {
    const keys = new Set(ARCHETYPES.map((item) => item.key))
    expect(keys.size).toBe(ARCHETYPES.length)

    for (const item of ARCHETYPES) {
      expect(item.prompt.length).toBeGreaterThan(3)
      expect(item.uk).toBeTruthy()
      expect(item.en).toBeTruthy()
    }
  })

  it('includes an explicit "nothing in particular" option', () => {
    // Without it the best of thirty confident-sounding guesses always wins,
    // and the app would never admit it does not know.
    expect(ARCHETYPES.some((item) => item.key === 'pattern')).toBe(true)
  })
})

describe('rank', () => {
  it('puts the identical vector first with a similarity of one', () => {
    const target = unit(3)
    const ranked = rank(target, vocabularyOf([unit(1), target, unit(2)]))

    expect(ranked[0]?.key).toBe('k1')
    expect(ranked[0]?.score).toBeCloseTo(1, 5)
  })

  it('returns every entry, ordered by descending score', () => {
    const ranked = rank(unit(5), vocabularyOf([unit(1), unit(2), unit(3)]))

    expect(ranked).toHaveLength(3)
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score)
    }
  })

  it('scores an opposed vector negatively', () => {
    const target = unit(4)
    const opposite = target.map((value) => -value)
    expect(rank(opposite, vocabularyOf([target]))[0]?.score).toBeCloseTo(-1, 5)
  })
})

describe('confidence', () => {
  const { confidenceOf, MIN_MARGIN } = RECOGNITION_THRESHOLDS

  it('is zero when the top two matches are indistinguishable', () => {
    expect(confidenceOf({ key: 'a', score: 0.4 }, { key: 'b', score: 0.4 })).toBe(0)
  })

  it('stays zero until the margin clears the threshold', () => {
    const justUnder = confidenceOf(
      { key: 'a', score: 0.4 },
      { key: 'b', score: 0.4 - MIN_MARGIN / 2 },
    )
    expect(justUnder).toBe(0)
  })

  it('grows with the margin and saturates at one', () => {
    const small = confidenceOf({ key: 'a', score: 0.4 }, { key: 'b', score: 0.36 })
    const large = confidenceOf({ key: 'a', score: 0.4 }, { key: 'b', score: 0.2 })

    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
    expect(large).toBe(1)
  })

  it('never leaves the unit interval', () => {
    expect(confidenceOf({ key: 'a', score: 0.9 }, undefined)).toBeLessThanOrEqual(1)
    expect(confidenceOf({ key: 'a', score: -0.5 }, { key: 'b', score: 0.5 })).toBe(0)
  })
})
