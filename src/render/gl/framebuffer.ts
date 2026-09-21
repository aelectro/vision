export type RenderTarget = {
  framebuffer: WebGLFramebuffer
  texture: WebGLTexture
  width: number
  height: number
  dispose: () => void
}

export function createTexture(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Unable to allocate a texture')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
  // Clamping matters: the blur and edge passes sample outside the image at the
  // borders, and repeating would wrap a face round to the opposite edge.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  return texture
}

export function createRenderTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): RenderTarget {
  const texture = createTexture(gl, width, height)
  const framebuffer = gl.createFramebuffer()
  if (!framebuffer) throw new Error('Unable to allocate a framebuffer')

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
    throw new Error(`Incomplete framebuffer (status 0x${status.toString(16)})`)
  }

  return {
    framebuffer,
    texture,
    width,
    height,
    dispose: () => {
      gl.deleteFramebuffer(framebuffer)
      gl.deleteTexture(texture)
    },
  }
}

/**
 * A small pool of identically sized targets.
 *
 * The pass chain needs several intermediates and a ping-pong pair; allocating
 * them per render would be the single biggest source of memory churn, and on
 * iOS that is what gets the tab killed.
 */
export class TargetPool {
  private readonly targets: RenderTarget[] = []
  private readonly gl: WebGL2RenderingContext
  private readonly width: number
  private readonly height: number

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = width
    this.height = height
  }

  acquire(index: number): RenderTarget {
    let target = this.targets[index]
    if (!target) {
      target = createRenderTarget(this.gl, this.width, this.height)
      this.targets[index] = target
    }
    return target
  }

  dispose(): void {
    for (const target of this.targets) target.dispose()
    this.targets.length = 0
  }
}
