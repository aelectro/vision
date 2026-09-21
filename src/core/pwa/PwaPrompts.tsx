import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

import '~/core/pwa/PwaPrompts.css'
import { useT } from '~/core/i18n/useI18n'
import { promptInstall, watchInstallPrompt, type InstallState } from '~/core/pwa/install'

const INSTALL_DISMISSED_KEY = 'vision.installDismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Two thin banners: one offering the new version, one offering installation.
 *
 * Installing matters more here than it does for most apps - it is what keeps
 * iOS from evicting the cached models and saved photos after a week.
 */
export function PwaPrompts() {
  const t = useT()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  const [install, setInstall] = useState<InstallState>({
    installed: false,
    canPrompt: false,
    needsManualInstall: false,
  })
  const [dismissed, setDismissed] = useState(readDismissed)

  useEffect(() => watchInstallPrompt(setInstall), [])

  const dismissInstall = () => {
    setDismissed(true)
    try {
      localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
    } catch {
      // Losing the preference only means we ask again later.
    }
  }

  if (needRefresh) {
    return (
      <div className="toast" role="status">
        <span className="toast__text">{t('pwa.updateReady')}</span>
        <button
          type="button"
          className="toast__action"
          onClick={() => void updateServiceWorker(true)}
        >
          {t('pwa.reload')}
        </button>
        <button
          type="button"
          className="toast__dismiss"
          aria-label={t('common.dismiss')}
          onClick={() => setNeedRefresh(false)}
        >
          <CloseIcon />
        </button>
      </div>
    )
  }

  const showInstall =
    !dismissed && !install.installed && (install.canPrompt || install.needsManualInstall)
  if (!showInstall) return null

  return (
    <div className="toast" role="status">
      <span className="toast__text">
        {install.canPrompt ? t('pwa.installOffer') : t('pwa.installIos')}
      </span>
      {install.canPrompt && (
        <button
          type="button"
          className="toast__action"
          onClick={() => {
            void (async () => {
              const accepted = await promptInstall()
              // A refusal is an answer: stop asking.
              if (!accepted) dismissInstall()
            })()
          }}
        >
          {t('pwa.install')}
        </button>
      )}
      <button
        type="button"
        className="toast__dismiss"
        aria-label={t('common.dismiss')}
        onClick={dismissInstall}
      >
        <CloseIcon />
      </button>
    </div>
  )
}
