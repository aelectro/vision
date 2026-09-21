import { Dexie, type EntityTable } from 'dexie'

import type {
  ArtifactRecord,
  BlobRecord,
  EmbeddingRecord,
  FeedbackRecord,
  ModelStateRecord,
  VisionRecord,
} from '~/core/db/types'

/**
 * Only fields used in queries are indexed. Blobs, typed arrays and serialised
 * parameters are stored but never indexed, which keeps writes cheap.
 */
export class VisionDatabase extends Dexie {
  visions!: EntityTable<VisionRecord, 'id'>
  blobs!: EntityTable<BlobRecord, 'id'>
  artifacts!: EntityTable<ArtifactRecord, 'id'>
  embeddings!: EntityTable<EmbeddingRecord, 'visionId'>
  feedback!: EntityTable<FeedbackRecord, 'id'>
  modelState!: EntityTable<ModelStateRecord, 'id'>

  constructor(name = 'vision') {
    super(name)

    this.version(1).stores({
      visions: 'id, createdAt, status',
      blobs: 'id, visionId, [visionId+kind]',
      artifacts: 'id, visionId, [visionId+kind], createdAt',
      embeddings: 'visionId, updatedAt',
      feedback: 'id, visionId, createdAt',
      modelState: 'id',
    })
  }
}

export const db = new VisionDatabase()
