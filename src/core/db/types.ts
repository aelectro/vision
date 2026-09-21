/** Shapes persisted in IndexedDB. Kept free of Dexie types so tests can use them. */

export type VisionStatus = 'pending' | 'working' | 'ready' | 'failed'

export type BlobKind = 'original' | 'thumb' | 'transform' | 'video' | 'depth'

export type ArtifactKind = 'transform' | 'video'

export type FeedbackSignal = 'accept' | 'like' | 'dislike' | 'edit'

export type VisionRecord = {
  id: string
  createdAt: number
  updatedAt: number
  /** What the user says they saw. Drives the transformation when present. */
  description: string | null
  /** Best zero-shot guess from the vocabulary, once tier 1 has run. */
  autoLabel: string | null
  autoConfidence: number | null
  width: number
  height: number
  status: VisionStatus
  /** Set when status is 'failed', to show something actionable. */
  error: string | null
}

/**
 * Binary payloads live in their own store so that listing the gallery never
 * materialises megabytes of image and video data.
 */
export type BlobRecord = {
  id: string
  visionId: string
  kind: BlobKind
  blob: Blob
  byteSize: number
  createdAt: number
}

export type ArtifactRecord = {
  id: string
  visionId: string
  kind: ArtifactKind
  blobId: string
  /** Serialised render parameters, so a result can always be reproduced. */
  paramsJson: string
  modelVersion: number
  createdAt: number
}

export type EmbeddingRecord = {
  visionId: string
  imageVec: Float32Array | null
  textVec: Float32Array | null
  updatedAt: number
}

export type FeedbackRecord = {
  id: string
  visionId: string
  paramsJson: string
  signal: FeedbackSignal
  createdAt: number
}

export type ModelStateRecord = {
  /** 'head' is the trainable network; 'vocabulary' caches archetype embeddings. */
  id: 'head' | 'vocabulary'
  version: number
  weights: ArrayBuffer
  steps: number
  lossEma: number
  examples: number
  updatedAt: number
}
