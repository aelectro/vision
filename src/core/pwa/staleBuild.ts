/**
 * Recovers from a deploy landing underneath a running page.
 *
 * Chunk filenames carry a content hash, so a new build replaces them all. A
 * tab that was opened before the deploy is still running the old bundle and
 * still asking for the old names, which are no longer on the server. The first
 * lazily-loaded piece it reaches - the muxer, the model code - fails with
 * "Importing a module script failed", and nothing about the page recovers on
 * its own.
 *
 * An installed web app makes this worse rather than better: it can sit unused
 * for days and then be opened against a server that has moved on twice.
 *
 * Two measures, in order of when they act:
 *
 *  1. When a new service worker takes control, reload, so the page is running
 *     the build the server actually has.
 *  2. If a chunk fails to load anyway, reload once and let the fresh HTML
 *     bring in the current filenames.
 *
 * Both are guarded against loops: a genuinely broken deploy must surface as an
 * error, not as a page that refreshes for ever.
 */

const RELOAD_FLAG = 'vision.staleReload'

function reloadOnce(reason: string): void {
  try {
    if (sessionStorage.getItem(RELOAD_FLAG)) {
      // Already tried. Reloading again would just hide a real failure behind
      // an endless refresh.
      console.error(`Reload did not resolve ${reason}`)
      return
    }
    sessionStorage.setItem(RELOAD_FLAG, '1')
  } catch {
    // Without session storage there is no way to detect a loop, so do nothing
    // rather than risk one.
    return
  }

  window.location.reload()
}

/** Clears the guard once the page has proved it can run. */
function markHealthy(): void {
  try {
    sessionStorage.removeItem(RELOAD_FLAG)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export function watchForStaleBuild(): void {
  // Vite raises this when a dynamically imported chunk cannot be fetched.
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    reloadOnce('a missing chunk')
  })

  const container = navigator.serviceWorker
  if (container) {
    // Only when one was already in charge: with clientsClaim the first
    // controller arrives on the very first visit, and reloading then would
    // restart the app for no reason.
    const hadController = container.controller !== null
    container.addEventListener('controllerchange', () => {
      if (hadController) reloadOnce('a new version taking over')
    })
  }

  // Give the app a moment to render before declaring it healthy, so a failure
  // during start-up still counts as the one permitted retry.
  window.setTimeout(markHealthy, 5000)
}
