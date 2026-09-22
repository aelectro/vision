import { isIos, isStandalone } from '~/core/pwa/install'
import { estimateStorage, formatBytes } from '~/core/storage/quota'

export type Check = {
  key: string
  label: string
  /** Short answer, shown in the list. */
  value: string
  verdict: 'ok' | 'warn' | 'fail' | 'info'
  /** Why it matters. Present when the answer is not simply fine. */
  note?: string
}

async function cameraCheck(): Promise<Check> {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      key: 'camera',
      label: 'Camera',
      value: 'getUserMedia missing',
      verdict: 'fail',
      note: 'Capture falls back to the native camera button.',
    }
  }

  if (!window.isSecureContext) {
    return {
      key: 'camera',
      label: 'Camera',
      value: 'insecure context',
      verdict: 'fail',
      note: 'The camera needs HTTPS. A LAN address over plain http will never work.',
    }
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 } },
    })
    const track = stream.getVideoTracks()[0]
    const settings = track?.getSettings()
    for (const open of stream.getTracks()) open.stop()

    const resolution =
      settings?.width && settings.height ? `${settings.width}x${settings.height}` : 'unknown size'

    return {
      key: 'camera',
      label: 'Camera',
      value: `${resolution}${settings?.facingMode ? `, ${settings.facingMode}` : ''}`,
      verdict: 'ok',
      ...(isStandalone()
        ? {
            note: 'Granted inside an installed web app, so the long-standing WebKit permission problem does not bite here.',
          }
        : {}),
    }
  } catch (error) {
    const denied = error instanceof DOMException && error.name === 'NotAllowedError'
    return {
      key: 'camera',
      label: 'Camera',
      value: denied ? 'permission denied' : 'unavailable',
      verdict: 'fail',
      note:
        denied && isStandalone()
          ? 'Installed web apps have their own permission silo on iOS and do not always keep a camera grant. Reload and allow, or use the file button.'
          : 'The native camera button still works.',
    }
  }
}

async function webgpuCheck(): Promise<Check> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
  if (!gpu) {
    return {
      key: 'webgpu',
      label: 'WebGPU',
      value: 'not available',
      verdict: 'info',
      note: 'Inference will run on wasm instead. Slower, but it works everywhere.',
    }
  }

  try {
    const adapter = await gpu.requestAdapter()
    return adapter
      ? { key: 'webgpu', label: 'WebGPU', value: 'available', verdict: 'ok' }
      : {
          key: 'webgpu',
          label: 'WebGPU',
          value: 'no adapter',
          verdict: 'info',
          note: 'Inference will run on wasm instead.',
        }
  } catch {
    return { key: 'webgpu', label: 'WebGPU', value: 'failed to probe', verdict: 'info' }
  }
}

function webglCheck(): Check {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2')
  if (!gl) {
    return {
      key: 'webgl',
      label: 'WebGL2',
      value: 'missing',
      verdict: 'fail',
      note: 'Without it there is no transformation and no clip.',
    }
  }

  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
  gl.getExtension('WEBGL_lose_context')?.loseContext()

  return {
    key: 'webgl',
    label: 'WebGL2',
    value: `max texture ${maxTexture}`,
    verdict: 'ok',
  }
}

type EncoderProbe = {
  isConfigSupported: (config: unknown) => Promise<{ supported?: boolean }>
}

async function videoCheck(): Promise<Check> {
  const encoder = (globalThis as { VideoEncoder?: EncoderProbe }).VideoEncoder

  if (!encoder) {
    return {
      key: 'video',
      label: 'Video encoding',
      value: 'WebCodecs missing',
      verdict: 'warn',
      note: 'Visions will have a still but no clip.',
    }
  }

  try {
    const result = await encoder.isConfigSupported({
      codec: 'avc1.42001f',
      width: 720,
      height: 540,
      bitrate: 2_000_000,
      framerate: 30,
      hardwareAcceleration: 'prefer-hardware',
    })
    return result.supported
      ? { key: 'video', label: 'Video encoding', value: 'H.264, hardware', verdict: 'ok' }
      : {
          key: 'video',
          label: 'Video encoding',
          value: 'H.264 refused',
          verdict: 'warn',
          note: 'Another codec may work, but the result would not save to Photos on iOS.',
        }
  } catch {
    return {
      key: 'video',
      label: 'Video encoding',
      value: 'probe threw',
      verdict: 'warn',
      note: 'Safari has not always implemented isConfigSupported; encoding may still succeed.',
    }
  }
}

async function storageCheck(): Promise<Check> {
  const { usage, quota, persisted } = await estimateStorage()

  const parts: string[] = []
  if (quota !== null) parts.push(`${formatBytes(usage ?? 0)} of ${formatBytes(quota)}`)
  parts.push(persisted ? 'protected' : 'evictable')

  return {
    key: 'storage',
    label: 'Storage',
    value: parts.join(', '),
    verdict: persisted ? 'ok' : 'warn',
    ...(persisted
      ? {}
      : {
          note: 'Not protected from eviction. On iOS a site left unopened for a week loses everything; installing to the home screen is what prevents that.',
        }),
  }
}

function installCheck(): Check {
  const standalone = isStandalone()
  return {
    key: 'install',
    label: 'Installed',
    value: standalone ? 'yes, running standalone' : 'no, running in the browser',
    verdict: standalone ? 'ok' : 'warn',
    ...(standalone
      ? {}
      : {
          note: isIos()
            ? 'Share, then Add to Home Screen. That is what keeps saved photos and cached models from being deleted.'
            : 'Install from the browser menu to keep the app and its data available offline.',
        }),
  }
}

function platformCheck(): Check {
  const features = [
    ['OffscreenCanvas', 'OffscreenCanvas' in globalThis],
    ['createImageBitmap', typeof createImageBitmap === 'function'],
    ['Worker', typeof Worker === 'function'],
    ['Service worker', 'serviceWorker' in navigator],
  ] as const

  const missing = features.filter(([, present]) => !present).map(([name]) => name)

  return {
    key: 'platform',
    label: 'Platform features',
    value: missing.length === 0 ? 'all present' : `missing ${missing.join(', ')}`,
    verdict: missing.length === 0 ? 'ok' : 'warn',
  }
}

/**
 * Everything the iOS investigation needed to establish, asked of the device
 * itself.
 *
 * Whether the camera survives being installed, whether WebGPU is real here,
 * whether this phone will encode H.264, how much storage is on offer - none of
 * it can be answered anywhere but on the device. Asking directly turns that
 * into one tap.
 */
export async function runDiagnostics(): Promise<Check[]> {
  const [camera, webgpu, video, storage] = await Promise.all([
    cameraCheck(),
    webgpuCheck(),
    videoCheck(),
    storageCheck(),
  ])

  return [installCheck(), camera, webglCheck(), webgpu, video, storage, platformCheck()]
}

export function reportText(checks: Check[]): string {
  return [
    'Vision diagnostics',
    new Date().toISOString(),
    navigator.userAgent,
    '',
    ...checks.map(
      (check) => `${check.verdict.toUpperCase().padEnd(5)} ${check.label}: ${check.value}`,
    ),
  ].join('\n')
}
