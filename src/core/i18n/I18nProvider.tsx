import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { I18nContext, type I18nValue } from '~/core/i18n/context'
import {
  detectLocale,
  isLocale,
  messages,
  type Locale,
  type MessageKey,
} from '~/core/i18n/messages'

const STORAGE_KEY = 'vision.locale'

function readStoredLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored && isLocale(stored) ? stored : null
  } catch {
    // Private mode and locked-down iframes can throw on access.
    return null
  }
}

function initialLocale(): Locale {
  return readStoredLocale() ?? detectLocale(navigator.languages ?? [navigator.language])
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    document.documentElement.lang = next
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // A rejected write only costs us persistence, not correctness.
    }
  }, [])

  const value = useMemo<I18nValue>(() => {
    const table = messages[locale]
    return { locale, setLocale, t: (key: MessageKey) => table[key] }
  }, [locale, setLocale])

  return <I18nContext value={value}>{children}</I18nContext>
}
