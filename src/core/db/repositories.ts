import { db } from '~/core/db/database'
import { newId } from '~/core/db/ids'
import type {
  ArtifactKind,
  ArtifactRecord,
  BlobKind,
  BlobRecord,
  EmbeddingRecord,
  FeedbackRecord,
  FeedbackSignal,
  ModelStateRecord,
  VisionRecord,
  VisionStatus,
} from '~/core/db/types'

export type CreateVisionInput = {
  original: Blob
  thumb: Blob
  width: number
  height: number
  description?: string | null
}

/**
 * Creates the vision row together with its original and thumbnail in one
 * transaction, so a failed write can never leave a vision without pixels.
 */
export async function createVision(input: CreateVisionInput): Promise<VisionRecord> {
  const now = Date.now()
  const vision: VisionRecord = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    description: input.description?.trim() ? input.description.trim() : null,
    autoLabel: null,
    autoConfidence: null,
    width: input.width,
    height: input.height,
    status: 'pending',
    error: null,
  }

  await db.transaction('rw', db.visions, db.blobs, async () => {
    await db.visions.add(vision)
    await db.blobs.bulkAdd([
      makeBlobRecord(vision.id, 'original', input.original, now),
      makeBlobRecord(vision.id, 'thumb', input.thumb, now),
    ])
  })

  return vision
}

function makeBlobRecord(
  visionId: string,
  kind: BlobKind,
  blob: Blob,
  createdAt: number,
): BlobRecord {
  return { id: newId(), visionId, kind, blob, byteSize: blob.size, createdAt }
}

export function listVisions(): Promise<VisionRecord[]> {
  return db.visions.orderBy('createdAt').reverse().toArray()
}

export function getVision(id: string): Promise<VisionRecord | undefined> {
  return db.visions.get(id)
}

export async function updateVision(
  id: string,
  changes: Partial<Omit<VisionRecord, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.visions.update(id, { ...changes, updatedAt: Date.now() })
}

export async function setVisionStatus(
  id: string,
  status: VisionStatus,
  error: string | null = null,
): Promise<void> {
  await updateVision(id, { status, error })
}

/** Removes a vision and every artefact, blob, embedding and rating tied to it. */
export async function deleteVision(id: string): Promise<void> {
  await db.transaction(
    'rw',
    db.visions,
    db.blobs,
    db.artifacts,
    db.embeddings,
    db.feedback,
    async () => {
      await db.blobs.where('visionId').equals(id).delete()
      await db.artifacts.where('visionId').equals(id).delete()
      await db.embeddings.delete(id)
      await db.feedback.where('visionId').equals(id).delete()
      await db.visions.delete(id)
    },
  )
}

export async function getBlob(visionId: string, kind: BlobKind): Promise<BlobRecord | undefined> {
  return db.blobs.where('[visionId+kind]').equals([visionId, kind]).last()
}

export async function putBlob(visionId: string, kind: BlobKind, blob: Blob): Promise<BlobRecord> {
  const record = makeBlobRecord(visionId, kind, blob, Date.now())
  await db.blobs.put(record)
  return record
}

export type SaveArtifactInput = {
  visionId: string
  kind: ArtifactKind
  blob: Blob
  params: unknown
  modelVersion: number
}

/**
 * Artefacts are append-only: regenerating a transformation keeps the previous
 * version so the detail screen can show a history.
 */
export async function saveArtifact(input: SaveArtifactInput): Promise<ArtifactRecord> {
  const now = Date.now()
  const blobRecord = makeBlobRecord(input.visionId, input.kind, input.blob, now)
  const artifact: ArtifactRecord = {
    id: newId(),
    visionId: input.visionId,
    kind: input.kind,
    blobId: blobRecord.id,
    paramsJson: JSON.stringify(input.params),
    modelVersion: input.modelVersion,
    createdAt: now,
  }

  await db.transaction('rw', db.blobs, db.artifacts, async () => {
    await db.blobs.add(blobRecord)
    await db.artifacts.add(artifact)
  })

  return artifact
}

export async function listArtifacts(
  visionId: string,
  kind?: ArtifactKind,
): Promise<ArtifactRecord[]> {
  const rows = kind
    ? await db.artifacts.where('[visionId+kind]').equals([visionId, kind]).toArray()
    : await db.artifacts.where('visionId').equals(visionId).toArray()
  return rows.sort((a, b) => b.createdAt - a.createdAt)
}

/** The artefact currently shown for a vision: the most recent of its kind. */
export async function latestArtifact(
  visionId: string,
  kind: ArtifactKind,
): Promise<ArtifactRecord | undefined> {
  const rows = await listArtifacts(visionId, kind)
  return rows[0]
}

export async function putEmbedding(
  visionId: string,
  vectors: { imageVec?: Float32Array | null; textVec?: Float32Array | null },
): Promise<void> {
  const existing = await db.embeddings.get(visionId)
  const record: EmbeddingRecord = {
    visionId,
    imageVec: vectors.imageVec !== undefined ? vectors.imageVec : (existing?.imageVec ?? null),
    textVec: vectors.textVec !== undefined ? vectors.textVec : (existing?.textVec ?? null),
    updatedAt: Date.now(),
  }
  await db.embeddings.put(record)
}

export function getEmbedding(visionId: string): Promise<EmbeddingRecord | undefined> {
  return db.embeddings.get(visionId)
}

export function listEmbeddings(): Promise<EmbeddingRecord[]> {
  return db.embeddings.toArray()
}

export async function addFeedback(
  visionId: string,
  signal: FeedbackSignal,
  params: unknown,
): Promise<FeedbackRecord> {
  const record: FeedbackRecord = {
    id: newId(),
    visionId,
    signal,
    paramsJson: JSON.stringify(params),
    createdAt: Date.now(),
  }
  await db.feedback.add(record)
  return record
}

export function listFeedback(): Promise<FeedbackRecord[]> {
  return db.feedback.orderBy('createdAt').toArray()
}

export function getModelState(): Promise<ModelStateRecord | undefined> {
  return db.modelState.get('head')
}

export async function putModelState(state: Omit<ModelStateRecord, 'id'>): Promise<void> {
  await db.modelState.put({ ...state, id: 'head' })
}

export async function clearModelState(): Promise<void> {
  await db.modelState.delete('head')
}

/** Total bytes held in the blob store, for the storage section of settings. */
export async function totalBlobBytes(): Promise<number> {
  let total = 0
  await db.blobs.each((row) => {
    total += row.byteSize
  })
  return total
}
