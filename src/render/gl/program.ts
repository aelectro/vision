export class ShaderCompileError extends Error {
  constructor(stage: string, log: string, source: string) {
    // The log alone is useless without the line it refers to.
    const numbered = source
      .split('\n')
      .map((line, index) => `${String(index + 1).padStart(3)} | ${line}`)
      .join('\n')
    super(`${stage} shader failed to compile:\n${log}\n\n${numbered}`)
    this.name = 'ShaderCompileError'
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to allocate a shader')

  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'no log'
    gl.deleteShader(shader)
    throw new ShaderCompileError(type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment', log, source)
  }

  return shader
}

export type Program = {
  handle: WebGLProgram
  /** Uniform locations, resolved once. Missing names resolve to null. */
  uniform: (name: string) => WebGLUniformLocation | null
  dispose: () => void
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): Program {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)

  const handle = gl.createProgram()
  if (!handle) throw new Error('Unable to allocate a program')

  gl.attachShader(handle, vertex)
  gl.attachShader(handle, fragment)
  gl.linkProgram(handle)

  // The shaders are no longer needed once linked, whatever the outcome.
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)

  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle) ?? 'no log'
    gl.deleteProgram(handle)
    throw new Error(`Program failed to link: ${log}`)
  }

  const cache = new Map<string, WebGLUniformLocation | null>()

  return {
    handle,
    uniform: (name) => {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(handle, name))
      return cache.get(name) ?? null
    },
    dispose: () => gl.deleteProgram(handle),
  }
}
