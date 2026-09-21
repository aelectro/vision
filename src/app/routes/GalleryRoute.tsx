import { Link } from 'react-router'

import '~/features/gallery/Gallery.css'
import { useT } from '~/core/i18n/useI18n'
import { VisionCard } from '~/features/gallery/VisionCard'
import { useVisions } from '~/features/gallery/useVisions'

export function GalleryRoute() {
  const t = useT()
  const { visions, loading, error } = useVisions()

  if (!loading && visions.length === 0) {
    return (
      <div className="empty">
        <h1 className="empty__title">{error ? t('status.failed') : t('gallery.empty')}</h1>
        <p className="empty__hint">{error ?? t('gallery.emptyHint')}</p>
        <Link className="empty__action" to="/">
          {t('gallery.openCamera')}
        </Link>
      </div>
    )
  }

  return (
    <section className="gallery">
      <h1 className="gallery__title">{t('gallery.title')}</h1>
      <div className="gallery__grid">
        {visions.map((vision) => (
          <VisionCard key={vision.id} vision={vision} />
        ))}
      </div>
    </section>
  )
}
