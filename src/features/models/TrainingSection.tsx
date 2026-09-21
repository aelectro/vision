import { useCallback, useEffect, useState } from 'react'

import { getModelState } from '~/core/db/repositories'
import { useT } from '~/core/i18n/useI18n'
import { resetHead } from '~/ml/head/store'
import { retrainFromHistory } from '~/ml/head/trainer'

type Stats = { steps: number; examples: number; loss: number }

export function TrainingSection() {
  const t = useT()
  const [stats, setStats] = useState<Stats | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    const state = await getModelState().catch(() => undefined)
    setStats(
      state
        ? { steps: state.steps, examples: state.examples, loss: state.lossEma }
        : { steps: 0, examples: 0, loss: 0 },
    )
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void refresh()
  }, [refresh])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await action()
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const trained = (stats?.examples ?? 0) > 0

  return (
    <div className="settings__section">
      <h2 className="settings__heading">{t('settings.training')}</h2>
      <div className="settings__card">
        <div className="settings__row">
          <span>{t('model.examples')}</span>
          <span className="settings__value">{stats?.examples ?? '…'}</span>
        </div>
        <div className="settings__row">
          <span>{t('model.steps')}</span>
          <span className="settings__value">{stats?.steps ?? '…'}</span>
        </div>
        <div className="settings__row">
          <span>{t('model.loss')}</span>
          <span className="settings__value">
            {stats && stats.loss > 0 ? stats.loss.toFixed(4) : '—'}
          </span>
        </div>
        {trained && (
          <>
            <button
              type="button"
              className="settings__option"
              disabled={busy}
              onClick={() => void run(retrainFromHistory)}
            >
              {t('model.retrain')}
            </button>
            <button
              type="button"
              className="settings__option"
              disabled={busy}
              onClick={() => void run(resetHead)}
            >
              {t('model.reset')}
            </button>
          </>
        )}
      </div>
      {!trained && <p className="settings__hint">{t('model.empty')}</p>}
    </div>
  )
}
