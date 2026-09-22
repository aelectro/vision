import { db } from '~/core/db/database'
import { ARCHETYPES, VOCABULARY_VERSION } from '~/ml/archetypes'
import { EMBEDDING_SIZE } from '~/ml/tiers'
import { embedText, ensureTier } from '~/ml/worker/client'

const CACHE_KEY = 'vocabulary' as const

/**
 * Text embeddings for the archetype vocabulary.
 *
 * Three ways to get them, in order of preference:
 *
 *  1. `public/vocabulary.bin`, produced at build time. Half a megabyte, and it
 *     means recognition works without the 41 MB text model.
 *  2. The cached result of having encoded them once on this device.
 *  3. Encoding them now, which requires the text tier.
 *
 * The file is the design intent, but the fallbacks exist so a build that never
 * ran the generation step still produces a working app rather than one whose
 * recognition silently does nothing.
 */

type Vocabulary = {
  keys: string[]
  /** Row-major, one unit-length embedding per archetype. */
  matrix: Float32Array
}

let cached: Vocabulary | null = null
let inFlight: Promise<Vocabulary | null> | null = null

function decode(buffer: ArrayBuffer): Vocabulary | null {
  const view = new DataView(buffer)
  if (buffer.byteLength < 12) return null

  const version = view.getUint32(0, true)
  const count = view.getUint32(4, true)
  const dimension = view.getUint32(8, true)

  if (version !== VOCABULARY_VERSION) return null
  if (dimension !== EMBEDDING_SIZE) return null
  if (count !== ARCHETYPES.length) return null
  if (buffer.byteLength !== 12 + count * dimension * 4) return null

  return {
    keys: ARCHETYPES.map((item) => item.key),
    matrix: new Float32Array(buffer.slice(12)),
  }
}

export function encodeVocabulary(matrix: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(12 + matrix.byteLength)
  const view = new DataView(buffer)
  view.setUint32(0, VOCABULARY_VERSION, true)
  view.setUint32(4, ARCHETYPES.length, true)
  view.setUint32(8, EMBEDDING_SIZE, true)
  new Float32Array(buffer, 12).set(matrix)
  return buffer
}

async function fromFile(): Promise<Vocabulary | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}vocabulary.bin`)
    if (!response.ok) return null
    return decode(await response.arrayBuffer())
  } catch {
    return null
  }
}

async function fromCache(): Promise<Vocabulary | null> {
  try {
    const row = await db.modelState.get('vocabulary')
    if (!row || row.version !== VOCABULARY_VERSION) return null
    return decode(row.weights)
  } catch {
    return null
  }
}

async function encodeNow(): Promise<Vocabulary | null> {
  if (!(await ensureTier('text'))) return null

  const matrix = new Float32Array(ARCHETYPES.length * EMBEDDING_SIZE)
  for (let i = 0; i < ARCHETYPES.length; i++) {
    // Sequential: thirty short prompts through one session, and running them
    // concurrently would only queue them inside the worker anyway.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const vector = await embedText(ARCHETYPES[i]!.prompt)
    matrix.set(vector.subarray(0, EMBEDDING_SIZE), i * EMBEDDING_SIZE)
  }

  const vocabulary: Vocabulary = { keys: ARCHETYPES.map((item) => item.key), matrix }

  await db.modelState
    .put({
      id: CACHE_KEY,
      version: VOCABULARY_VERSION,
      weights: encodeVocabulary(matrix),
      steps: 0,
      lossEma: 0,
      examples: ARCHETYPES.length,
      updatedAt: Date.now(),
    })
    .catch(() => undefined)

  return vocabulary
}

export function loadVocabulary(): Promise<Vocabulary | null> {
  if (cached) return Promise.resolve(cached)
  if (inFlight) return inFlight

  inFlight = (async () => {
    const vocabulary = (await fromFile()) ?? (await fromCache()) ?? (await encodeNow())
    cached = vocabulary
    inFlight = null
    return vocabulary
  })()

  return inFlight
}

/** The embedding of one archetype, for asking where in a frame it appears. */
export async function archetypeVector(key: string): Promise<Float32Array | null> {
  const vocabulary = await loadVocabulary()
  if (!vocabulary) return null

  const index = vocabulary.keys.indexOf(key)
  if (index < 0) return null

  return vocabulary.matrix.slice(index * EMBEDDING_SIZE, (index + 1) * EMBEDDING_SIZE)
}

export type Match = {
  key: string
  /** Cosine similarity; both sides are unit length so this is a dot product. */
  score: number
}

/** Ranks the vocabulary against an image embedding, best first. */
export function rank(imageVector: Float32Array, vocabulary: Vocabulary): Match[] {
  const matches: Match[] = []

  for (let i = 0; i < vocabulary.keys.length; i++) {
    let score = 0
    const offset = i * EMBEDDING_SIZE
    for (let d = 0; d < EMBEDDING_SIZE; d++) {
      score += imageVector[d]! * vocabulary.matrix[offset + d]!
    }
    matches.push({ key: vocabulary.keys[i]!, score })
  }

  return matches.sort((a, b) => b.score - a.score)
}
