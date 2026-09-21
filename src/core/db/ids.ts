/** Stable identifiers that work without a server. */
export function newId(): string {
  // Typed as possibly absent so neither branch narrows the other away:
  // very old WebViews expose no crypto at all.
  const webCrypto: Crypto | undefined = globalThis.crypto

  if (webCrypto && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID()
  }

  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16))
    let out = ''
    for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
    return out
  }

  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`
}
