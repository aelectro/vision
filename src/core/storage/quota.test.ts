import { describe, expect, it } from 'vitest'

import { formatBytes, isQuotaExceeded } from '~/core/storage/quota'

describe('formatBytes', () => {
  it('keeps small sizes in bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
  })

  it('steps up through the units', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB')
  })

  it('drops the decimal once the number is large enough to read', () => {
    expect(formatBytes(42 * 1024 * 1024)).toBe('42 MB')
  })

  it('refuses to invent a value for nonsense input', () => {
    expect(formatBytes(Number.NaN)).toBe('—')
    expect(formatBytes(-1)).toBe('—')
  })
})

describe('isQuotaExceeded', () => {
  it('recognises the names used by different engines', () => {
    const chrome = new Error('quota')
    chrome.name = 'QuotaExceededError'
    const firefox = new Error('quota')
    firefox.name = 'NS_ERROR_DOM_QUOTA_REACHED'

    expect(isQuotaExceeded(chrome)).toBe(true)
    expect(isQuotaExceeded(firefox)).toBe(true)
  })

  it('recognises a wrapped Dexie failure by message', () => {
    expect(isQuotaExceeded(new Error('QuotaExceededError while writing'))).toBe(true)
  })

  it('ignores unrelated failures and non-errors', () => {
    expect(isQuotaExceeded(new Error('network down'))).toBe(false)
    expect(isQuotaExceeded('QuotaExceededError')).toBe(false)
    expect(isQuotaExceeded(null)).toBe(false)
  })
})
