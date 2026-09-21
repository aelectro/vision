import { useEffect, useState } from 'react'

import { formatBytes } from '~/core/storage/quota'
import { useT } from '~/core/i18n/useI18n'
import type { MessageKey } from '~/core/i18n/messages'
import { MODEL_SPECS, MODEL_TIERS, RUNTIME_BYTES, type ModelTier, type TierState } from '~/ml/tiers'
import { onTierChange, releaseTier, tierStates } from '~/ml/worker/client'

const tierLabel: Record<ModelTier, MessageKey> = {
  vision: 'models.vision',
  depth: 'models.depth',
  text: 'models.text',
}

const statusLabel: Record<TierState['status'], MessageKey> = {
  absent: 'models.absent',
  downloading: 'models.downloading',
  ready: 'models.ready',
  failed: 'models.failed',
}

export function ModelsSection() {
  const t = useT()
  const [states, setStates] = useState(tierStates)

  useEffect(() => onTierChange(setStates), [])

  // The runtime is paid once, with whichever tier arrives first, so it is only
  // quoted while nothing has been downloaded yet.
  const anyReady = MODEL_TIERS.some((tier) => states[tier].status === 'ready')

  return (
    <div className="settings__section">
      <h2 className="settings__heading">{t('models.title')}</h2>
      <div className="settings__card">
        {MODEL_TIERS.map((tier) => {
          const state = states[tier]
          const size = MODEL_SPECS[tier].approximateBytes + (anyReady ? 0 : RUNTIME_BYTES)

          return (
            <div className="settings__row" key={tier}>
              <span>
                {t(tierLabel[tier])}
                <span className="settings__value"> · {formatBytes(size)}</span>
              </span>
              {state.status === 'ready' ? (
                <button
                  type="button"
                  className="settings__value"
                  onClick={() => void releaseTier(tier)}
                >
                  {t('models.delete')}
                </button>
              ) : (
                <span className="settings__value">
                  {state.status === 'downloading'
                    ? `${Math.round(state.progress * 100)}%`
                    : t(statusLabel[state.status])}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <p className="settings__hint">{t('models.runtimeNote')}</p>
    </div>
  )
}
