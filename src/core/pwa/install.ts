/**
 * Detects whether the app is running as an installed web app, and whether we
 * can offer to install it.
 *
 * Two very different worlds:
 *  - Chromium fires `beforeinstallprompt`, which we can defer and replay.
 *  - iOS Safari has no such event. Installing is a manual Share -> Add to Home
 *    Screen gesture, so all we can do is explain it.
 */

export type InstallState = {
  installed: boolean
  /** Chromium only: a deferred prompt is ready to be shown. */
  canPrompt: boolean
  /** iOS Safari, not yet installed: show the manual instructions instead. */
  needsManualInstall: boolean
}

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function isStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true
  // iOS predates the display-mode media query for home-screen apps.
  const legacy = navigator as Navigator & { standalone?: boolean }
  return legacy.standalone === true
}

export function isIos(): boolean {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

let deferredPrompt: BeforeInstallPromptEvent | null = null

/** Starts capturing the install prompt and reports the resulting state. */
export function watchInstallPrompt(onChange: (state: InstallState) => void): () => void {
  const emit = () => {
    const installed = isStandalone()
    onChange({
      installed,
      canPrompt: !installed && deferredPrompt !== null,
      needsManualInstall: !installed && deferredPrompt === null && isIos(),
    })
  }

  const onBeforeInstallPrompt = (event: Event) => {
    event.preventDefault()
    deferredPrompt = event as BeforeInstallPromptEvent
    emit()
  }

  const onInstalled = () => {
    deferredPrompt = null
    emit()
  }

  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onInstalled)
  emit()

  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  }
}

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false
  const prompt = deferredPrompt
  // The event can only be used once, whatever the outcome.
  deferredPrompt = null
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  return outcome === 'accepted'
}
