import { createContext } from 'react'

import type { Locale, MessageKey } from '~/core/i18n/messages'

export type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (key: MessageKey) => string
}

export const I18nContext = createContext<I18nValue | null>(null)
