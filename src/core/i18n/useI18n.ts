import { use } from 'react'

import { I18nContext, type I18nValue } from '~/core/i18n/context'
import type { MessageKey } from '~/core/i18n/messages'

export function useI18n(): I18nValue {
  const value = use(I18nContext)
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>')
  return value
}

/** Shorthand for components that only need to translate. */
export function useT(): (key: MessageKey) => string {
  return useI18n().t
}
