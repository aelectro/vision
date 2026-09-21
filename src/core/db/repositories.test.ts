import { beforeEach, describe, expect, it } from 'vitest'

import 'fake-indexeddb/auto'

import { db } from '~/core/db/database'
import {
  addFeedback,
  createVision,
  deleteVision,
  getBlob,
  getEmbedding,
  latestArtifact,
  listArtifacts,
  listVisions,
  putEmbedding,
  saveArtifact,
  setVisionStatus,
  totalBlobBytes,
} from '~/core/db/repositories'

function blobOf(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' })
}

async function seedVision(description?: string) {
  return createVision({
    original: blobOf('original-pixels'),
    thumb: blobOf('thumb'),
    width: 4032,
    height: 3024,
    ...(description === undefined ? {} : { description }),
  })
}

beforeEach(async () => {
  await db.delete()
  await db.open()
})

describe('createVision', () => {
  it('stores the vision with both blobs in one go', async () => {
    const vision = await seedVision()

    expect(vision.status).toBe('pending')
    expect(vision.description).toBeNull()
    expect(await getBlob(vision.id, 'original')).toMatchObject({ kind: 'original' })
    expect(await getBlob(vision.id, 'thumb')).toMatchObject({ kind: 'thumb' })
  })

  it('trims a description and treats blank text as absent', async () => {
    expect((await seedVision('  a face in the bark  ')).description).toBe('a face in the bark')
    expect((await seedVision('   ')).description).toBeNull()
  })
})

describe('listVisions', () => {
  it('returns the newest first', async () => {
    const first = await seedVision('first')
    const second = await seedVision('second')
    // Two visions created in the same millisecond would tie; separate them.
    await db.visions.update(second.id, { createdAt: first.createdAt + 1000 })

    const ids = (await listVisions()).map((v) => v.id)
    expect(ids).toEqual([second.id, first.id])
  })
})

describe('artifacts', () => {
  it('keeps every version and reports the most recent one', async () => {
    const vision = await seedVision()

    const older = await saveArtifact({
      visionId: vision.id,
      kind: 'transform',
      blob: blobOf('v1'),
      params: { edgeStrength: 0.2 },
      modelVersion: 1,
    })
    const newer = await saveArtifact({
      visionId: vision.id,
      kind: 'transform',
      blob: blobOf('v2'),
      params: { edgeStrength: 0.8 },
      modelVersion: 2,
    })
    await db.artifacts.update(newer.id, { createdAt: older.createdAt + 1000 })

    const all = await listArtifacts(vision.id, 'transform')
    expect(all).toHaveLength(2)
    expect((await latestArtifact(vision.id, 'transform'))?.id).toBe(newer.id)
  })

  it('separates kinds', async () => {
    const vision = await seedVision()
    await saveArtifact({
      visionId: vision.id,
      kind: 'transform',
      blob: blobOf('image'),
      params: {},
      modelVersion: 1,
    })
    await saveArtifact({
      visionId: vision.id,
      kind: 'video',
      blob: blobOf('movie'),
      params: {},
      modelVersion: 1,
    })

    expect(await listArtifacts(vision.id, 'transform')).toHaveLength(1)
    expect(await listArtifacts(vision.id, 'video')).toHaveLength(1)
    expect(await listArtifacts(vision.id)).toHaveLength(2)
  })
})

describe('putEmbedding', () => {
  it('merges vectors instead of overwriting the other one', async () => {
    const vision = await seedVision()

    await putEmbedding(vision.id, { imageVec: new Float32Array([1, 2, 3]) })
    await putEmbedding(vision.id, { textVec: new Float32Array([4, 5]) })

    const stored = await getEmbedding(vision.id)
    expect(Array.from(stored?.imageVec ?? [])).toEqual([1, 2, 3])
    expect(Array.from(stored?.textVec ?? [])).toEqual([4, 5])
  })

  it('can clear a vector explicitly with null', async () => {
    const vision = await seedVision()
    await putEmbedding(vision.id, { imageVec: new Float32Array([1]) })
    await putEmbedding(vision.id, { imageVec: null })

    expect((await getEmbedding(vision.id))?.imageVec).toBeNull()
  })
})

describe('deleteVision', () => {
  it('removes every dependent record', async () => {
    const vision = await seedVision('gone')
    await saveArtifact({
      visionId: vision.id,
      kind: 'transform',
      blob: blobOf('image'),
      params: {},
      modelVersion: 1,
    })
    await putEmbedding(vision.id, { imageVec: new Float32Array([1]) })
    await addFeedback(vision.id, 'like', {})

    await deleteVision(vision.id)

    expect(await listVisions()).toHaveLength(0)
    expect(await db.blobs.count()).toBe(0)
    expect(await db.artifacts.count()).toBe(0)
    expect(await db.embeddings.count()).toBe(0)
    expect(await db.feedback.count()).toBe(0)
  })

  it('leaves other visions untouched', async () => {
    const keep = await seedVision('keep')
    const drop = await seedVision('drop')
    await deleteVision(drop.id)

    expect((await listVisions()).map((v) => v.id)).toEqual([keep.id])
    expect(await db.blobs.count()).toBe(2)
  })
})

describe('setVisionStatus', () => {
  it('records the failure reason and clears it on recovery', async () => {
    const vision = await seedVision()

    await setVisionStatus(vision.id, 'failed', 'depth model unavailable')
    expect(await db.visions.get(vision.id)).toMatchObject({
      status: 'failed',
      error: 'depth model unavailable',
    })

    await setVisionStatus(vision.id, 'ready')
    expect(await db.visions.get(vision.id)).toMatchObject({ status: 'ready', error: null })
  })
})

describe('totalBlobBytes', () => {
  it('sums every stored payload', async () => {
    const vision = await seedVision()
    await saveArtifact({
      visionId: vision.id,
      kind: 'video',
      blob: blobOf('a much longer payload'),
      params: {},
      modelVersion: 1,
    })

    const expected =
      blobOf('original-pixels').size + blobOf('thumb').size + blobOf('a much longer payload').size
    expect(await totalBlobBytes()).toBe(expected)
  })
})
