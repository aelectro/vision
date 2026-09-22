import { useCallback, useEffect, useState } from 'react'

import { useT } from '~/core/i18n/useI18n'
import '~/features/diagnostics/Diagnostics.css'
import { reportText, runDiagnostics, type Check } from '~/features/diagnostics/checks'

export function DiagnosticsSection() {
  const t = useT()
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [copied, setCopied] = useState(false)

  const run = useCallback(async () => {
    setChecks(await runDiagnostics())
  }, [])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    void run()
  }, [run])

  const copy = async () => {
    if (!checks) return
    try {
      await navigator.clipboard.writeText(reportText(checks))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access can be refused; the report is on screen regardless.
    }
  }

  return (
    <div className="settings__section">
      <h2 className="settings__heading">{t('diagnostics.title')}</h2>
      <div className="settings__card">
        {checks === null ? (
          <p className="settings__placeholder">…</p>
        ) : (
          checks.map((check) => (
            <div className="diagnostics__item" key={check.key} data-verdict={check.verdict}>
              <div className="diagnostics__line">
                <span>{check.label}</span>
                <span className="diagnostics__value">{check.value}</span>
              </div>
              {check.note && <p className="diagnostics__note">{check.note}</p>}
            </div>
          ))
        )}
      </div>

      {checks && (
        <div className="vision__actions">
          <button
            type="button"
            className="vision__button vision__button--ghost"
            onClick={() => void run()}
          >
            {t('diagnostics.rerun')}
          </button>
          <button
            type="button"
            className="vision__button vision__button--ghost"
            onClick={() => void copy()}
          >
            {t(copied ? 'diagnostics.copied' : 'diagnostics.copy')}
          </button>
        </div>
      )}

      <p className="diagnostics__ua">{navigator.userAgent}</p>
    </div>
  )
}
