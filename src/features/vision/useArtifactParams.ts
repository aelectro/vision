import { useEffect, useState } from 'react'

import { latestArtifact } from '~/core/db/repositories'
import { onPipelineEvent } from '~/core/jobs/pipeline'
import { defaultParams, parseParams, type RenderParams } from '~/ml/params'

/**
 * The parameters the visible transformation was actually rendered with.
 *
 * Read from the stored artefact rather than recomputed, so the sliders start
 * where the image is instead of where the model would put it now - otherwise
 * opening the panel would silently propose a different picture.
 */
export function useArtifactParams(visionId: string | undefined) {
  const [params, setParams] = useState<RenderParams>(defaultParams)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  useEffect(() => {
    if (!visionId) return

    let cancelled = false

    const load = async () => {
      const artifact = await latestArtifact(visionId, 'transform')
      if (cancelled) return
      setParams(artifact ? parseParams(artifact.paramsJson) : defaultParams())
      setLoadedFor(visionId)
    }

    // oxlint-disable-next-line react/set-state-in-effect
    void load()

    const stop = onPipelineEvent((event) => {
      if (event.visionId === visionId && event.type === 'transformed') void load()
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [visionId])

  return { params, setParams, ready: loadedFor === visionId }
}
