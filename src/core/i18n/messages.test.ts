import { describe, expect, it } from 'vitest'

import { detectLocale, isLocale, locales, messages } from '~/core/i18n/messages'

describe('locale detection', () => {
  it('matches a regional tag to its base language', () => {
    expect(detectLocale(['uk-UA', 'en-US'])).toBe('uk')
    expect(detectLocale(['en-GB'])).toBe('en')
  })

  it('skips unsupported languages and keeps looking', () => {
    expect(detectLocale(['de-DE', 'fr', 'uk'])).toBe('uk')
  })

  it('falls back to English when nothing matches', () => {
    expect(detectLocale(['de', 'fr'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
})

describe('isLocale', () => {
  it('accepts only supported locales', () => {
    expect(isLocale('uk')).toBe(true)
    expect(isLocale('en')).toBe(true)
    expect(isLocale('de')).toBe(false)
  })
})

describe('message catalogues', () => {
  it('defines every key in every locale with a non-empty string', () => {
    const keys = Object.keys(messages.uk)
    expect(keys.length).toBeGreaterThan(0)

    for (const locale of locales) {
      const table = messages[locale]
      expect(Object.keys(table).sort()).toEqual(keys.sort())
      for (const key of keys) {
        expect(table[key as keyof typeof table]).toBeTruthy()
      }
    }
  })
})
