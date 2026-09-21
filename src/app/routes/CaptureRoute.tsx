import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { Link } from 'react-router'

import { createVision } from '~/core/db/repositories'
import { processVision } from '~/core/jobs/pipeline'
import { useT } from '~/core/i18n/useI18n'
import '~/features/capture/Capture.css'
import { captureFromFile, captureFromVideo } from '~/features/capture/captureImage'
import { useCamera } from '~/features/capture/useCamera'

function GalleryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="14" rx="2.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="m5 16 4.2-4.2 3 3 2.6-2.6L19 16" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="9.4" r="1.3" fill="currentColor" />
    </svg>
  )
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12a8 8 0 0 1 13.3-6M20 12a8 8 0 0 1-13.3 6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M17 3v3.5h-3.5M7 21v-3.5h3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V5m0 0L8.2 8.8M12 5l3.8 3.8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 15v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function CaptureRoute() {
  const t = useT()
  const navigate = useNavigate()
  const { videoRef, status, settings, facing, flip } = useCamera(true)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (captured: Awaited<ReturnType<typeof captureFromVideo>>) => {
    const vision = await createVision({ ...captured, description })
    setDescription('')
    // Transformation runs in the background; the detail screen shows progress.
    void processVision(vision.id)
    await navigate(`/vision/${vision.id}`)
  }

  const onShutter = async () => {
    const video = videoRef.current
    if (!video || saving) return

    setSaving(true)
    setError(null)
    try {
      await save(await captureFromVideo(video))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file || saving) return

    setSaving(true)
    setError(null)
    try {
      await save(await captureFromFile(file))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const live = status === 'live'
  const blocked = status === 'denied' || status === 'unavailable'

  return (
    <section className="capture">
      <div className="capture__stage">
        <video
          ref={videoRef}
          className="capture__video"
          style={{ '--mirror': facing === 'user' ? -1 : 1 } as React.CSSProperties}
          playsInline
          muted
          autoPlay
        />

        {status === 'starting' && (
          <div className="capture__message">
            <p className="capture__messageHint">{t('capture.starting')}</p>
          </div>
        )}

        {blocked && (
          <div className="capture__message">
            <h2 className="capture__messageTitle">
              {t(status === 'denied' ? 'capture.permissionDenied' : 'capture.unavailable')}
            </h2>
            <p className="capture__messageHint">{t('capture.permissionHint')}</p>
          </div>
        )}

        <div className="capture__top">
          <Link className="capture__chip" to="/gallery">
            <GalleryIcon />
            {t('nav.gallery')}
          </Link>
          {live && settings && (
            <span className="capture__chip">
              {settings.width}×{settings.height}
            </span>
          )}
        </div>
      </div>

      <div className="capture__controls">
        <input
          className="capture__describe"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={t('capture.describePlaceholder')}
          enterKeyHint="done"
        />

        <div className="capture__row">
          <button
            type="button"
            className="capture__side"
            onClick={() => fileInputRef.current?.click()}
          >
            <FileIcon />
            {t('capture.fromFile')}
          </button>

          <button
            type="button"
            className="capture__shutter"
            aria-label={t('capture.shutter')}
            disabled={!live || saving}
            onClick={() => void onShutter()}
          >
            <span className="capture__shutterInner" />
          </button>

          <button type="button" className="capture__side" onClick={flip} disabled={!live}>
            <FlipIcon />
            {t('capture.switchCamera')}
          </button>
        </div>

        {error && <p className="capture__error">{error}</p>}

        {/* Always present: it is the fallback when getUserMedia is blocked,
            and on iOS it returns a full-sensor-resolution still. */}
        <input
          ref={fileInputRef}
          className="capture__fileInput"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(event) => {
            void onFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
      </div>
    </section>
  )
}
