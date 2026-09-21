/**
 * Storage quota helpers.
 *
 * WebKit treats the reported quota as an upper bound with no guarantee, and
 * `estimate()` only exists from Safari 17, so every call here is defensive.
 * Persistence matters more than it looks: on iOS, ITP wipes script-writable
 * storage for sites that have not been interacted with for seven days, and a
 * home-screen web app with persistence granted is exempt.
 */

export type StorageEstimateSummary = {
  usage: number | null
  quota: number | null
  persisted: boolean
}

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function estimateStorage(): Promise<StorageEstimateSummary> {
  let usage: number | null = null
  let quota: number | null = null
  let persisted = false

  if (navigator.storage?.estimate) {
    try {
      const estimate = await navigator.storage.estimate()
      usage = estimate.usage ?? null
      quota = estimate.quota ?? null
    } catch {
      // Safari can reject the call; treat it as simply unknown.
    }
  }

  if (navigator.storage?.persisted) {
    try {
      persisted = await navigator.storage.persisted()
    } catch {
      persisted = false
    }
  }

  return { usage, quota, persisted }
}

export function isQuotaExceeded(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  // Chrome and Safari disagree on the name; both appear in the wild.
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    // Dexie wraps the underlying DOMException.
    error.message.includes('QuotaExceeded')
  )
}

/** Human-readable size, used by the settings screen. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}
