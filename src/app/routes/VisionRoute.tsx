import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { deleteVision, updateVision } from '~/core/db/repositories'
import type { BlobKind } from '~/core/db/types'
import { processVision } from '~/core/jobs/pipeline'
import { useT } from '~/core/i18n/useI18n'
import { Tuner } from '~/features/feedback/Tuner'
import { useBlobUrl } from '~/features/gallery/useBlobUrl'
import '~/features/vision/Vision.css'
import { useArtifactParams } from '~/features/vision/useArtifactParams'
import { useVision } from '~/features/vision/useVision'
import { learnFrom } from '~/ml/head/trainer'

type Tab = 'original' | 'transform' | 'video'

const tabToKind: Record<Tab, BlobKind> = {
  original: 'original',
  transform: 'transform',
  video: 'video',
}

function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M14.5 6 9 12l5.5 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function VisionRoute() {
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams()
  const { vision, loading, reload } = useVision(id)

  const [tab, setTab] = useState<Tab>('transform')
  const [draft, setDraft] = useState('')
  const [draftKey, setDraftKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [rating, setRating] = useState<'like' | 'dislike' | null>(null)
  const { params, setParams } = useArtifactParams(id)

  const transformUrl = useBlobUrl(id, 'transform')

  // Adjusting state during render rather than in an effect: this reseeds the
  // editor when a different vision loads, without a second commit.
  const loadedKey = vision ? `${vision.id}:${vision.description ?? ''}` : null
  if (loadedKey !== draftKey) {
    setDraftKey(loadedKey)
    setDraft(vision?.description ?? '')
  }

  // A failed render leaves no transformation to show, so fall back rather than
  // storing a corrected tab.
  const activeTab: Tab =
    tab === 'transform' && !transformUrl && vision?.status === 'failed' ? 'original' : tab

  const mediaUrl = useBlobUrl(id, tabToKind[activeTab])

  if (loading) return <div className="vision" />

  if (!vision) {
    return (
      <div className="empty">
        <h1 className="empty__title">{t('vision.notFound')}</h1>
        <Link className="empty__action" to="/gallery">
          {t('nav.gallery')}
        </Link>
      </div>
    )
  }

  const saveDescription = async () => {
    setBusy(true)
    try {
      await updateVision(vision.id, { description: draft.trim() || null })
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const recreate = async () => {
    setBusy(true)
    try {
      await updateVision(vision.id, { description: draft.trim() || null })
      await processVision(vision.id)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    await deleteVision(vision.id)
    await navigate('/gallery', { replace: true })
  }

  const rate = async (signal: 'like' | 'dislike') => {
    setRating(signal)
    setBusy(true)
    try {
      await learnFrom(vision.id, signal, params)
    } finally {
      setBusy(false)
    }
  }

  const applyAndLearn = async () => {
    setBusy(true)
    try {
      // The edit is the lesson: whatever the user settled on is, for this
      // image, the right answer. Re-rendering with it also proves the point.
      await learnFrom(vision.id, 'edit', params)
      await processVision(vision.id, params)
    } finally {
      setBusy(false)
    }
  }

  const descriptionChanged = draft.trim() !== (vision.description ?? '')

  return (
    <section className="vision">
      <div className="vision__stage">
        {mediaUrl ? (
          activeTab === 'video' ? (
            <video className="vision__media" src={mediaUrl} controls playsInline loop />
          ) : (
            <img className="vision__media" src={mediaUrl} alt={vision.description ?? ''} />
          )
        ) : (
          <div className="vision__pending">
            {t(vision.status === 'failed' ? 'status.failed' : 'status.working')}
          </div>
        )}

        <Link className="vision__back" to="/gallery">
          <BackIcon />
          {t('common.back')}
        </Link>
      </div>

      <div className="vision__tabs" role="tablist">
        {(['original', 'transform', 'video'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            className="vision__tab"
            aria-selected={activeTab === value}
            onClick={() => setTab(value)}
          >
            {t(`vision.${value}` as const)}
          </button>
        ))}
      </div>

      <div className="vision__body">
        <label className="vision__label" htmlFor="vision-description">
          {t('vision.description')}
        </label>
        <textarea
          id="vision-description"
          className="vision__description"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('vision.descriptionPlaceholder')}
        />

        <div className="vision__actions">
          <button
            type="button"
            className="vision__button"
            disabled={busy}
            onClick={() => void recreate()}
          >
            {t('vision.createTransform')}
          </button>
          {descriptionChanged && (
            <button
              type="button"
              className="vision__button vision__button--ghost"
              disabled={busy}
              onClick={() => void saveDescription()}
            >
              {t('vision.save')}
            </button>
          )}
          <button
            type="button"
            className="vision__button vision__button--danger"
            onClick={() => void remove()}
          >
            {t('vision.delete')}
          </button>
        </div>

        {vision.autoLabel && (
          <p className="vision__meta">
            {vision.autoLabel}
            {vision.autoConfidence !== null && ` · ${Math.round(vision.autoConfidence * 100)}%`}
          </p>
        )}

        {vision.error && <p className="vision__error">{vision.error}</p>}

        <Tuner
          params={params}
          busy={busy}
          rating={rating}
          onChange={setParams}
          onApply={() => void applyAndLearn()}
          onRate={(signal) => void rate(signal)}
        />
      </div>
    </section>
  )
}
