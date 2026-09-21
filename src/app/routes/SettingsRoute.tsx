import '~/app/routes/SettingsRoute.css'
import { useI18n } from '~/core/i18n/useI18n'
import { locales, localeNames } from '~/core/i18n/messages'
import { formatBytes } from '~/core/storage/quota'
import { useStorageInfo } from '~/core/storage/useStorageInfo'

export function SettingsRoute() {
  const { locale, setLocale, t } = useI18n()
  const storage = useStorageInfo()

  return (
    <section className="settings">
      <h1 className="settings__title">{t('settings.title')}</h1>

      <div className="settings__section">
        <h2 className="settings__heading">{t('settings.language')}</h2>
        <div className="settings__card">
          {locales.map((code) => (
            <button
              key={code}
              type="button"
              className="settings__option"
              aria-pressed={code === locale}
              onClick={() => setLocale(code)}
            >
              <span>{localeNames[code]}</span>
              {code === locale && (
                <svg className="settings__check" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="m5 12.5 4.5 4.5L19 7.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="settings__section">
        <h2 className="settings__heading">{t('settings.models')}</h2>
        <div className="settings__card">
          <p className="settings__placeholder">—</p>
        </div>
      </div>

      <div className="settings__section">
        <h2 className="settings__heading">{t('settings.training')}</h2>
        <div className="settings__card">
          <p className="settings__placeholder">—</p>
        </div>
      </div>

      <div className="settings__section">
        <h2 className="settings__heading">{t('settings.storage')}</h2>
        <div className="settings__card">
          <div className="settings__row">
            <span>{t('storage.used')}</span>
            <span className="settings__value">
              {storage.loading ? '…' : formatBytes(storage.appBytes ?? 0)}
            </span>
          </div>
          <div className="settings__row">
            <span>{t('storage.available')}</span>
            <span className="settings__value">
              {storage.quota === null ? '—' : formatBytes(storage.quota - (storage.usage ?? 0))}
            </span>
          </div>
          <div className="settings__row">
            <span>{t('storage.persisted')}</span>
            <span className="settings__value">
              {storage.persisted ? t('storage.persistedYes') : t('storage.persistedNo')}
            </span>
          </div>
        </div>
        {!storage.persisted && !storage.loading && (
          <p className="settings__hint">{t('storage.persistHint')}</p>
        )}
      </div>
    </section>
  )
}
