import { Link } from 'react-router'

import type { VisionRecord } from '~/core/db/types'
import { useBlobUrl } from '~/features/gallery/useBlobUrl'
import { useT } from '~/core/i18n/useI18n'
import type { MessageKey } from '~/core/i18n/messages'

const statusKey: Record<VisionRecord['status'], MessageKey> = {
  pending: 'status.pending',
  working: 'status.working',
  ready: 'status.ready',
  failed: 'status.failed',
}

export function VisionCard({ vision }: { vision: VisionRecord }) {
  const t = useT()
  // Prefer the transformed image; the original stands in until it exists.
  const transformUrl = useBlobUrl(vision.id, 'transform')
  const thumbUrl = useBlobUrl(vision.id, 'thumb')
  const url = transformUrl ?? thumbUrl

  const caption = vision.description ?? vision.autoLabel
  const aspect = vision.height > 0 ? vision.width / vision.height : 0.75

  return (
    <Link className="card" to={`/vision/${vision.id}`}>
      {url ? (
        <img
          className="card__image"
          src={url}
          alt={caption ?? ''}
          loading="lazy"
          decoding="async"
          style={{ aspectRatio: aspect }}
        />
      ) : (
        <div className="card__placeholder" style={{ aspectRatio: aspect }} />
      )}

      {vision.status !== 'ready' && (
        <span className="card__badge" data-status={vision.status}>
          {t(statusKey[vision.status])}
        </span>
      )}

      {caption && (
        <div className="card__meta">
          <span className="card__label">{caption}</span>
        </div>
      )}
    </Link>
  )
}
