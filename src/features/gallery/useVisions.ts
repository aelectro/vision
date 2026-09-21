import { useCallback, useEffect, useState } from 'react'

import { listVisions } from '~/core/db/repositories'
import type { VisionRecord } from '~/core/db/types'

type State = {
  visions: VisionRecord[]
  loading: boolean
  error: string | null
}

/**
 * Reads the gallery from IndexedDB and refreshes it on demand.
 *
 * Deliberately not a live query: the background job queue writes frequently
 * while it processes a photo, and re-rendering the whole feed on every write
 * would be wasteful. Callers refresh at meaningful points instead.
 */
export function useVisions() {
  const [state, setState] = useState<State>({ visions: [], loading: true, error: null })

  const refresh = useCallback(async () => {
    try {
      const visions = await listVisions()
      setState({ visions, loading: false, error: null })
    } catch (error) {
      setState({
        visions: [],
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  useEffect(() => {
    // Loading from IndexedDB is exactly the "synchronise with an external
    // system" case the rule carves out; it cannot see through the await.
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
