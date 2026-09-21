import { useState } from 'react'

import { useT } from '~/core/i18n/useI18n'
import type { MessageKey } from '~/core/i18n/messages'
import '~/features/feedback/Tuner.css'
import { PARAM_RANGES, type RenderParams } from '~/ml/params'

/**
 * The handful of controls worth exposing.
 *
 * All twenty parameters are learnable, but most of them - structure radius,
 * palette hue, breathing - are not things anyone wants to reason about. These
 * six are the ones with an obvious visual meaning, and adjusting any of them
 * teaches the network about all twenty for images like this one.
 */
const EXPOSED = [
  ['edgeStrength', 'tune.edgeStrength'],
  ['edgeThreshold', 'tune.edgeThreshold'],
  ['contrast', 'tune.contrast'],
  ['saturation', 'tune.saturation'],
  ['posterise', 'tune.posterise'],
  ['parallax', 'tune.parallax'],
] as const satisfies readonly (readonly [keyof RenderParams, MessageKey])[]

export type TunerProps = {
  params: RenderParams
  busy: boolean
  onChange: (params: RenderParams) => void
  onApply: () => void
  onRate: (signal: 'like' | 'dislike') => void
  rating: 'like' | 'dislike' | null
}

export function Tuner({ params, busy, onChange, onApply, onRate, rating }: TunerProps) {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <section className="tuner">
      <div className="tuner__header">
        <h2 className="tuner__title">{t('tune.title')}</h2>
        <button type="button" className="tuner__toggle" onClick={() => setOpen(!open)}>
          {t(open ? 'tune.hide' : 'tune.adjust')}
        </button>
      </div>

      <div className="tuner__rate">
        <button
          type="button"
          className="tuner__vote"
          aria-pressed={rating === 'like'}
          disabled={busy}
          onClick={() => onRate('like')}
        >
          {t('tune.like')}
        </button>
        <button
          type="button"
          className="tuner__vote"
          aria-pressed={rating === 'dislike'}
          disabled={busy}
          onClick={() => onRate('dislike')}
        >
          {t('tune.dislike')}
        </button>
      </div>

      {open && (
        <>
          <div className="tuner__sliders">
            {EXPOSED.map(([key, label]) => {
              const range = PARAM_RANGES[key]
              return (
                <div className="tuner__row" key={key}>
                  <span className="tuner__label">{t(label)}</span>
                  <span className="tuner__number">{params[key].toFixed(2)}</span>
                  <input
                    className="tuner__slider"
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={range.step}
                    value={params[key]}
                    disabled={busy}
                    onChange={(event) => onChange({ ...params, [key]: Number(event.target.value) })}
                  />
                </div>
              )
            })}
          </div>

          <button
            type="button"
            className="vision__button"
            style={{ marginTop: 12, width: '100%' }}
            disabled={busy}
            onClick={onApply}
          >
            {t('tune.applyAndLearn')}
          </button>
          <p className="tuner__note">{t('tune.note')}</p>
        </>
      )}
    </section>
  )
}
