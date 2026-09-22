import analyzeFrag from '~/render/shaders/analyze.frag.glsl?raw'
import blitFrag from '~/render/shaders/blit.frag.glsl?raw'
import blurFrag from '~/render/shaders/blur.frag.glsl?raw'
import composeFrag from '~/render/shaders/compose.frag.glsl?raw'
import edgesFrag from '~/render/shaders/edges.frag.glsl?raw'
import quadVert from '~/render/shaders/quad.vert.glsl?raw'
import tensorFrag from '~/render/shaders/tensor.frag.glsl?raw'

import {
  createGlContext,
  fitWorkingSize,
  probeCapabilities,
  type GlContext,
} from '~/render/gl/context'
import { TargetPool, createTexture, type RenderTarget } from '~/render/gl/framebuffer'
import { createProgram, type Program } from '~/render/gl/program'
import type { RenderParams } from '~/ml/params'
import { WHOLE_FRAME, type FocusRegion, type Grid } from '~/render/focus'

/** Returns a copy of the bitmap with its rows reversed. */
async function flipVertically(image: ImageBitmap): Promise<ImageBitmap> {
  return createImageBitmap(image, { imageOrientation: 'flipY' })
}

export type RenderFrameOptions = {
  /** 0 for the still image, 0..1 through the clip for video frames. */
  time?: number
  /** Scales every animated term; 0 renders the image as a still. */
  motion?: number
  /** Shows an intermediate pass instead of the composite, for diagnosis. */
  debug?: 'analysis' | 'tensor' | 'edges'
  /** Where the recognised image sits. Defaults to the whole frame. */
  focus?: FocusRegion
}

/**
 * The shader pipeline.
 *
 * Passes, in order:
 *   1. analyse  - luminance and Sobel gradient
 *   2. tensor   - outer product of the gradient
 *   3. blur x2  - separable smoothing of the tensor, which is what makes the
 *                 dominant orientation stable along an edge
 *   4. edges    - eigen-analysis, then a difference-of-Gaussians taken across
 *                 the edge rather than along the pixel grid
 *   5. compose  - tone, palette, depth-driven displacement and the overlay
 *
 * The context and every intermediate target are created once and reused for
 * all 300 frames of a video. Allocating per frame is what gets a tab killed on
 * iOS.
 */
export class VisionRenderer {
  private readonly context: GlContext
  private readonly pool: TargetPool
  private readonly programs: {
    analyze: Program
    tensor: Program
    blur: Program
    edges: Program
    compose: Program
    blit: Program
  }
  private readonly vao: WebGLVertexArrayObject
  private sourceTexture: WebGLTexture | null = null
  private depthTexture: WebGLTexture | null = null
  private readonly neutralDepth: WebGLTexture

  readonly width: number
  readonly height: number

  private constructor(context: GlContext, width: number, height: number) {
    this.context = context
    this.width = width
    this.height = height

    const { gl } = context
    this.pool = new TargetPool(gl, width, height)

    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Unable to allocate a vertex array')
    this.vao = vao

    this.programs = {
      analyze: createProgram(gl, quadVert, analyzeFrag),
      tensor: createProgram(gl, quadVert, tensorFrag),
      blur: createProgram(gl, quadVert, blurFrag),
      edges: createProgram(gl, quadVert, edgesFrag),
      compose: createProgram(gl, quadVert, composeFrag),
      blit: createProgram(gl, quadVert, blitFrag),
    }

    // Stands in for a real depth map until that model tier is downloaded:
    // a constant mid-depth disables the displacement rather than distorting it.
    this.neutralDepth = createTexture(gl, 1, 1)
    gl.bindTexture(gl.TEXTURE_2D, this.neutralDepth)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([128, 128, 128, 255]),
    )
  }

  static create(sourceWidth: number, sourceHeight: number, maxEdge?: number): VisionRenderer {
    const capabilities = probeCapabilities()
    const limit = maxEdge
      ? { maxTextureSize: Math.min(capabilities.maxTextureSize, maxEdge) }
      : capabilities
    const size = fitWorkingSize(sourceWidth, sourceHeight, limit)
    const context = createGlContext(size.width, size.height)
    return new VisionRenderer(context, size.width, size.height)
  }

  /**
   * Uploads the photo.
   *
   * Textures rendered into a framebuffer have their first row at the bottom,
   * because that is where OpenGL puts it, and every pass here reads and writes
   * with that convention. An image arrives the other way up, so it has to be
   * flipped once on the way in to match.
   *
   * Done explicitly rather than with UNPACK_FLIP_Y_WEBGL, which browsers do
   * not apply consistently to ImageBitmap sources - it was silently ignored
   * here, and the result was every transformation coming out upside down.
   */
  async setSource(image: ImageBitmap): Promise<void> {
    const { gl } = this.context
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture)

    const flipped = await flipVertically(image)
    try {
      this.sourceTexture = createTexture(gl, this.width, this.height)
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, flipped)
    } finally {
      flipped.close()
    }
  }

  async setDepth(map: ImageBitmap | null): Promise<void> {
    const { gl } = this.context
    if (this.depthTexture) {
      gl.deleteTexture(this.depthTexture)
      this.depthTexture = null
    }
    if (!map) return

    const flipped = await flipVertically(map)
    try {
      this.depthTexture = createTexture(gl, flipped.width, flipped.height)
      gl.bindTexture(gl.TEXTURE_2D, this.depthTexture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, flipped)
    } finally {
      flipped.close()
    }
  }

  private draw(program: Program, target: RenderTarget | null): void {
    const { gl } = this.context
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null)
    gl.viewport(0, 0, this.width, this.height)
    gl.useProgram(program.handle)
    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bind(program: Program, name: string, texture: WebGLTexture, unit: number): void {
    const { gl } = this.context
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.uniform1i(program.uniform(name), unit)
  }

  private get texel(): [number, number] {
    return [1 / this.width, 1 / this.height]
  }

  /** Runs the whole chain and leaves the result in the canvas. */
  render(
    params: RenderParams,
    options: RenderFrameOptions = {},
  ): HTMLCanvasElement | OffscreenCanvas {
    const source = this.sourceTexture
    if (!source) throw new Error('No source image has been set')

    const { gl } = this.context
    const [tx, ty] = this.texel

    const analysis = this.pool.acquire(0)
    const tensorRaw = this.pool.acquire(1)
    const tensorH = this.pool.acquire(2)
    const tensorV = this.pool.acquire(3)
    const edges = this.pool.acquire(4)
    const softH = this.pool.acquire(5)
    const soft = this.pool.acquire(6)

    const analyze = this.programs.analyze
    gl.useProgram(analyze.handle)
    this.bind(analyze, 'uSrc', source, 0)
    gl.uniform2f(analyze.uniform('uTexel'), tx, ty)
    this.draw(analyze, analysis)

    const tensor = this.programs.tensor
    gl.useProgram(tensor.handle)
    this.bind(tensor, 'uAnalysis', analysis.texture, 0)
    this.draw(tensor, tensorRaw)

    const blur = this.programs.blur
    gl.useProgram(blur.handle)
    gl.uniform2f(blur.uniform('uTexel'), tx, ty)
    gl.uniform1f(blur.uniform('uSigma'), params.structureRadius)
    this.bind(blur, 'uSrc', tensorRaw.texture, 0)
    gl.uniform2f(blur.uniform('uDirection'), 1, 0)
    this.draw(blur, tensorH)

    gl.useProgram(blur.handle)
    this.bind(blur, 'uSrc', tensorH.texture, 0)
    gl.uniform2f(blur.uniform('uDirection'), 0, 1)
    this.draw(blur, tensorV)

    const edgeProgram = this.programs.edges
    gl.useProgram(edgeProgram.handle)
    this.bind(edgeProgram, 'uAnalysis', analysis.texture, 0)
    this.bind(edgeProgram, 'uTensor', tensorV.texture, 1)
    gl.uniform2f(edgeProgram.uniform('uTexel'), tx, ty)
    // Squared so the slider has fine control over faint structure, where the
    // interesting lines are, rather than spending half its travel on edges
    // that were never in doubt.
    const edgeThreshold = 0.003 + 0.06 * params.edgeThreshold * params.edgeThreshold
    gl.uniform1f(edgeProgram.uniform('uThreshold'), edgeThreshold)
    gl.uniform1f(edgeProgram.uniform('uWidth'), params.edgeWidth)
    gl.uniform1f(edgeProgram.uniform('uCoherence'), params.coherence)
    this.draw(edgeProgram, edges)

    // A softened copy of the photo, so the surroundings have somewhere to
    // recede to rather than just going dark.
    gl.useProgram(blur.handle)
    gl.uniform1f(blur.uniform('uSigma'), 3.5)
    this.bind(blur, 'uSrc', source, 0)
    gl.uniform2f(blur.uniform('uDirection'), 1, 0)
    this.draw(blur, softH)

    gl.useProgram(blur.handle)
    this.bind(blur, 'uSrc', softH.texture, 0)
    gl.uniform2f(blur.uniform('uDirection'), 0, 1)
    this.draw(blur, soft)

    if (options.debug) {
      const blit = this.programs.blit
      const texture =
        options.debug === 'analysis'
          ? analysis.texture
          : options.debug === 'tensor'
            ? tensorV.texture
            : edges.texture
      gl.useProgram(blit.handle)
      this.bind(blit, 'uSrc', texture, 0)
      this.draw(blit, null)
      return this.context.canvas
    }

    const compose = this.programs.compose
    gl.useProgram(compose.handle)
    this.bind(compose, 'uSrc', source, 0)
    this.bind(compose, 'uEdges', edges.texture, 1)
    this.bind(compose, 'uDepth', this.depthTexture ?? this.neutralDepth, 2)
    this.bind(compose, 'uSoft', soft.texture, 3)
    gl.uniform1f(compose.uniform('uHasDepth'), this.depthTexture ? 1 : 0)
    gl.uniform2f(compose.uniform('uTexel'), tx, ty)

    const focus = options.focus ?? WHOLE_FRAME
    gl.uniform2f(compose.uniform('uFocusCentre'), focus.x, focus.y)
    gl.uniform1f(compose.uniform('uFocusRadius'), focus.radius)
    // A flat score field means nothing stood out, so nothing gets singled out.
    gl.uniform1f(compose.uniform('uFocusStrength'), params.focusStrength * focus.confidence)
    gl.uniform1f(compose.uniform('uSurroundFade'), params.surroundFade)
    // Keeps the region round rather than stretched on a portrait frame.
    const aspect = this.width / this.height
    gl.uniform2f(
      compose.uniform('uFocusScale'),
      aspect >= 1 ? aspect : 1,
      aspect >= 1 ? 1 : 1 / aspect,
    )

    gl.uniform1f(compose.uniform('uEdgeStrength'), params.edgeStrength)
    gl.uniform1f(compose.uniform('uContrast'), params.contrast)
    gl.uniform1f(compose.uniform('uBrightness'), params.brightness)
    gl.uniform1f(compose.uniform('uSaturation'), params.saturation)
    gl.uniform1f(compose.uniform('uPosterise'), params.posterise)
    gl.uniform1f(compose.uniform('uLevels'), params.levels)
    gl.uniform1f(compose.uniform('uPaletteHue'), params.paletteHue)
    gl.uniform1f(compose.uniform('uPaletteStrength'), params.paletteStrength)
    gl.uniform1f(compose.uniform('uSubjectFocus'), params.subjectFocus)
    gl.uniform1f(compose.uniform('uVignette'), params.vignette)
    gl.uniform1f(compose.uniform('uGrain'), params.grain)

    gl.uniform1f(compose.uniform('uTime'), options.time ?? 0)
    gl.uniform1f(compose.uniform('uMotion'), options.motion ?? 0)
    gl.uniform1f(compose.uniform('uParallax'), params.parallax)
    gl.uniform1f(compose.uniform('uZoom'), params.zoom)
    gl.uniform1f(compose.uniform('uBreathing'), params.breathing)
    gl.uniform1f(compose.uniform('uMotionSpeed'), params.motionSpeed)
    gl.uniform1f(compose.uniform('uContourPulse'), params.contourPulse)

    // The contours draw themselves in over the opening seconds of a clip; a
    // still simply starts finished.
    const elapsed = (options.time ?? 0) * 10
    const reveal =
      (options.motion ?? 0) < 0.001 || params.reveal <= 0 ? 1 : Math.min(1, elapsed / params.reveal)
    gl.uniform1f(compose.uniform('uReveal'), reveal)

    this.draw(compose, null)
    return this.context.canvas
  }

  /**
   * Coarse map of where the coherent structure is.
   *
   * This is localisation without any model at all: it cannot say the shape is
   * a bird, but it can say which part of the frame carries the lines that
   * might form one. Used directly when the vision model is absent, and as the
   * fallback when it is present but unsure.
   */
  edgeGrid(params: RenderParams, columns = 6, rows = 6): Grid {
    this.render(params)

    const { gl } = this.context
    const edges = this.pool.acquire(4)

    // Read the edge pass at full size once, then average into cells. A GPU
    // downsample would need another target and another pass for a map this
    // small.
    const pixels = new Uint8Array(this.width * this.height * 4)
    gl.bindFramebuffer(gl.FRAMEBUFFER, edges.framebuffer)
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    const values = new Float32Array(columns * rows)
    const counts = new Uint32Array(columns * rows)

    for (let y = 0; y < this.height; y++) {
      // Framebuffer rows run bottom-up; the grid is addressed top-down.
      const row = Math.min(rows - 1, Math.floor(((this.height - 1 - y) / this.height) * rows))
      for (let x = 0; x < this.width; x++) {
        const column = Math.min(columns - 1, Math.floor((x / this.width) * columns))
        const cell = row * columns + column
        const i = (y * this.width + x) * 4
        // Line strength weighted by how certain the orientation was, so noise
        // scattered across a texture counts for less than a coherent edge.
        values[cell]! += (pixels[i]! / 255) * (0.35 + 0.65 * (pixels[i + 1]! / 255))
        counts[cell]! += 1
      }
    }

    for (let cell = 0; cell < values.length; cell++) {
      values[cell] = counts[cell]! > 0 ? values[cell]! / counts[cell]! : 0
    }

    return { values, columns, rows }
  }

  dispose(): void {
    const { gl } = this.context
    for (const program of Object.values(this.programs)) program.dispose()
    this.pool.dispose()
    gl.deleteVertexArray(this.vao)
    gl.deleteTexture(this.neutralDepth)
    if (this.sourceTexture) gl.deleteTexture(this.sourceTexture)
    if (this.depthTexture) gl.deleteTexture(this.depthTexture)
    this.context.dispose()
  }
}
