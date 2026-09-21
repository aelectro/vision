import { useCallback, useEffect, useState } from 'react'

import { totalBlobBytes } from '~/core/db/repositories'
import {
  estimateStorage,
  requestPersistence,
  type StorageEstimateSummary,
} from '~/core/storage/quota'

export type StorageInfo = StorageEstimateSummary & {
  /** Bytes this app has actually written, as opposed to the origin total. */
  appBytes: number | null
  loading: boolean
}

const initial: StorageInfo = {
  usage: null,
  quota: null,
  persisted: false,
  appBytes: null,
  loading: true,
}

/**
 * Asks for persistent storage once and reports usage.
 *
 * Persistence is requested rather than assumed: on iOS it is what keeps the
 * cached models and saved photos from being evicted after a week of not
 * opening the app.
 */
export function useStorageInfo(): StorageInfo & { refresh: () => void } {
  const [info, setInfo] = useState<StorageInfo>(initial)

  const refresh = useCallback(() => {
    let cancelled = false

    void (async () => {
      await requestPersistence()
      const [estimate, appBytes] = await Promise.all([
        estimateStorage(),
        totalBlobBytes().catch(() => null),
      ])
      if (cancelled) return
      setInfo({ ...estimate, appBytes, loading: false })
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => refresh(), [refresh])

  return { ...info, refresh }
}
