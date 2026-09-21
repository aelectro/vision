import '~/app/routes/SettingsRoute.css'
import { useI18n } from '~/core/i18n/useI18n'
import { locales, localeNames } from '~/core/i18n/messages'

export function SettingsRoute() {
  const { locale, setLocale, t } = useI18n()

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
          <p className="settings__placeholder">—</p>
        </div>
      </div>
    </section>
  )
}
