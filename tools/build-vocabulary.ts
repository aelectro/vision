/**
 * Precomputes the archetype vocabulary into `public/vocabulary.bin`.
 *
 * This is what lets recognition work without the 41 MB text model: the thirty
 * prompts are encoded once here, at build time, and shipped as half a megabyte
 * of vectors.
 *
 * Running it needs network access to Hugging Face. The app does not depend on
 * it having been run - it falls back to encoding the vocabulary on device the
 * first time the text tier is present, and caching the result - so a build
 * without this step still works, just with a heavier path to recognition.
 *
 *   npm run build:vocabulary
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AutoTokenizer, CLIPTextModelWithProjection } from '@huggingface/transformers'

import { ARCHETYPES, VOCABULARY_VERSION } from '../src/ml/archetypes.ts'
import { EMBEDDING_SIZE, MODEL_SPECS } from '../src/ml/tiers.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outputPath = join(here, '..', 'public', 'vocabulary.bin')

function normalise(vector: Float32Array): Float32Array {
  let sum = 0
  for (const value of vector) sum += value * value
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] = vector[i]! / norm
  }
  return vector
}

async function main(): Promise<void> {
  const spec = MODEL_SPECS.text
  console.log(`Loading ${spec.repo} (${spec.dtype})...`)

  const [model, tokenizer] = await Promise.all([
    CLIPTextModelWithProjection.from_pretrained(spec.repo, { dtype: spec.dtype }),
    AutoTokenizer.from_pretrained(spec.repo),
  ])

  const matrix = new Float32Array(ARCHETYPES.length * EMBEDDING_SIZE)

  for (let i = 0; i < ARCHETYPES.length; i++) {
    const archetype = ARCHETYPES[i]!
    const inputs = tokenizer([archetype.prompt], { padding: true, truncation: true })
    // Sequential so the progress log is readable and one session handles all
    // thirty; this runs once at build time, not on anyone's phone.
    // oxlint-disable-next-line eslint/no-await-in-loop
    const output = (await model(inputs)) as { text_embeds?: { data?: unknown } }
    const data = output.text_embeds?.data

    if (!(data instanceof Float32Array) || data.length < EMBEDDING_SIZE) {
      throw new Error(`No embedding for "${archetype.key}"`)
    }

    matrix.set(normalise(data.slice(0, EMBEDDING_SIZE)), i * EMBEDDING_SIZE)
    console.log(`  ${String(i + 1).padStart(2)}/${ARCHETYPES.length}  ${archetype.key}`)
  }

  const buffer = new ArrayBuffer(12 + matrix.byteLength)
  const view = new DataView(buffer)
  view.setUint32(0, VOCABULARY_VERSION, true)
  view.setUint32(4, ARCHETYPES.length, true)
  view.setUint32(8, EMBEDDING_SIZE, true)
  new Float32Array(buffer, 12).set(matrix)

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, Buffer.from(buffer))

  console.log(`\nWrote ${outputPath} (${(buffer.byteLength / 1024).toFixed(0)} KB)`)
}

await main()
