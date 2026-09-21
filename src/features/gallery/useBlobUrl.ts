import { useEffect, useState } from 'react'

import { getBlob } from '~/core/db/repositories'
import type { BlobKind } from '~/core/db/types'

type Loaded = { key: string; url: string }

/**
 * Turns a stored blob into an object URL and revokes it on unmount.
 *
 * Blobs stay on disk rather than in the JS heap, so an object URL is the cheap
 * way to hand one to an <img> or <video>. Failing to revoke leaks the whole
 * payload, which matters once those payloads are videos.
 *
 * The loaded entry is keyed so a stale URL is discarded during render rather
 * than by a second state update.
 */
export function useBlobUrl(visionId: string | undefined, kind: BlobKind): string | null {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const key = visionId ? `${visionId}:${kind}` : ''

  useEffect(() => {
    if (!visionId) return

    let cancelled = false
    let created: string | null = null

    void (async () => {
      const record = await getBlob(visionId, kind)
      if (cancelled || !record) return
      created = URL.createObjectURL(record.blob)
      setLoaded({ key: `${visionId}:${kind}`, url: created })
    })()

    return () => {
      cancelled = true
      if (created) URL.revokeObjectURL(created)
    }
  }, [visionId, kind])

  return loaded?.key === key ? loaded.url : null
}
