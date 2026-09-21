/**
 * Working resolution limits.
 *
 * On iOS the binding constraint is not `MAX_TEXTURE_SIZE` - which reports
 * 16384 on A15-class devices - but the total canvas area, which the system
 * silently refuses to render beyond. iOS 18 raised that ceiling to 67 million
 * pixels; we stay well inside it because every intermediate pass allocates a
 * full RGBA target and a ping-pong pair at 8192x8192 alone is half a gigabyte.
 */
const MAX_CANVAS_AREA = 16_777_216

export type GlCapabilities = {
  maxTextureSize: number
  /** Whether half-float render targets are available for the blur chain. */
  floatRenderable: boolean
}

export type GlContext = {
  gl: WebGL2RenderingContext
  canvas: HTMLCanvasElement | OffscreenCanvas
  capabilities: GlCapabilities
  dispose: () => void
}

export class GlUnavailableError extends Error {
  constructor() {
    super('WebGL2 is not available in this browser')
    this.name = 'GlUnavailableError'
  }
}

/**
 * Largest size that fits both the device's texture limit and the area budget,
 * preserving aspect ratio.
 */
export function fitWorkingSize(
  width: number,
  height: number,
  capabilities: Pick<GlCapabilities, 'maxTextureSize'>,
  maxArea = MAX_CANVAS_AREA,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 }

  let scale = 1

  const longest = Math.max(width, height)
  if (longest > capabilities.maxTextureSize) {
    scale = capabilities.maxTextureSize / longest
  }

  const area = width * scale * (height * scale)
  if (area > maxArea) {
    scale *= Math.sqrt(maxArea / area)
  }

  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

export function createGlContext(width: number, height: number): GlContext {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    // We read the result back with toBlob, which needs the buffer intact.
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  })

  if (!gl) throw new GlUnavailableError()

  const capabilities = readCapabilities(gl)
  cachedCapabilities = capabilities

  return {
    gl,
    canvas,
    capabilities,
    dispose: () => {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.width = 0
      canvas.height = 0
    },
  }
}

function readCapabilities(gl: WebGL2RenderingContext): GlCapabilities {
  return {
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    floatRenderable: gl.getExtension('EXT_color_buffer_half_float') !== null,
  }
}

let cachedCapabilities: GlCapabilities | null = null

/**
 * Capabilities are read once and remembered. Browsers cap the number of live
 * WebGL contexts, so probing on every render would eventually start losing
 * them - and the limits do not change between contexts anyway.
 */
export function probeCapabilities(): GlCapabilities {
  if (cachedCapabilities) return cachedCapabilities

  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const gl = canvas.getContext('webgl2')
  if (!gl) throw new GlUnavailableError()

  cachedCapabilities = readCapabilities(gl)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return cachedCapabilities
}

export const GL_LIMITS = { MAX_CANVAS_AREA }
