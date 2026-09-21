import { useCallback, useEffect, useState } from 'react'

import { getVision } from '~/core/db/repositories'
import type { VisionRecord } from '~/core/db/types'
import { onPipelineEvent } from '~/core/jobs/pipeline'

/** Loads one vision and reloads it whenever the pipeline touches it. */
export function useVision(id: string | undefined) {
  const [vision, setVision] = useState<VisionRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!id) return
    const record = await getVision(id)
    setVision(record ?? null)
    setLoading(false)
  }, [id])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

  useEffect(() => {
    if (!id) return
    return onPipelineEvent((event) => {
      if (event.visionId === id) void reload()
    })
  }, [id, reload])

  return { vision, loading, reload }
}
