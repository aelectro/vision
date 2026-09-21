/** Longest edge of the stored thumbnail, enough for a retina gallery card. */
const THUMB_MAX_EDGE = 640

/**
 * Photos are capped before they are stored. iOS kills the tab when a canvas
 * gets too large, and every later stage - shaders, depth, video - works from
 * this image, so an unbounded original would cost us repeatedly.
 */
const ORIGINAL_MAX_EDGE = 2560

export type CapturedImage = {
  original: Blob
  thumb: Blob
  width: number
  height: number
}

function fittedSize(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function drawToCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('2D canvas context unavailable')

  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, width, height)
  return canvas
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image'))),
      'image/jpeg',
      quality,
    )
  })
}

async function fromBitmap(bitmap: ImageBitmap): Promise<CapturedImage> {
  try {
    const full = fittedSize(bitmap.width, bitmap.height, ORIGINAL_MAX_EDGE)
    const thumbSize = fittedSize(bitmap.width, bitmap.height, THUMB_MAX_EDGE)

    const [original, thumb] = await Promise.all([
      toBlob(drawToCanvas(bitmap, full.width, full.height), 0.92),
      toBlob(drawToCanvas(bitmap, thumbSize.width, thumbSize.height), 0.75),
    ])

    return { original, thumb, width: full.width, height: full.height }
  } finally {
    bitmap.close()
  }
}

/** Grabs the current video frame. Used by the live viewfinder's shutter. */
export async function captureFromVideo(video: HTMLVideoElement): Promise<CapturedImage> {
  const width = video.videoWidth
  const height = video.videoHeight
  if (!width || !height) throw new Error('The camera has not produced a frame yet')

  return fromBitmap(await createImageBitmap(video))
}

/**
 * Decodes a file chosen from the native camera or the filesystem.
 *
 * `imageOrientation: 'from-image'` is what stops iPhone photos arriving
 * rotated: the sensor writes landscape pixels plus an EXIF rotation flag.
 */
export async function captureFromFile(file: Blob): Promise<CapturedImage> {
  return fromBitmap(await createImageBitmap(file, { imageOrientation: 'from-image' }))
}

export const CAPTURE_LIMITS = { THUMB_MAX_EDGE, ORIGINAL_MAX_EDGE, fittedSize }
