import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny'

import { getBlob, saveArtifact } from '~/core/db/repositories'
import type { RenderParams } from '~/ml/params'
import { VisionRenderer } from '~/render/gl/renderer'

export const CLIP_SECONDS = 10
const FRAME_RATE = 30

/**
 * Video is rendered smaller than the still, and at a modest bitrate.
 *
 * Three hundred frames at photo resolution produce a file several times the
 * size of the photo they came from, and storage is the scarcest resource here:
 * iOS evicts an origin wholesale when it runs out, taking every saved photo
 * with it. The clip is something to watch, not something to zoom into, and its
 * content - slow drifts of a mostly static image - is exactly what a low
 * bitrate handles well.
 */
const VIDEO_MAX_EDGE = 720

export const VIDEO_SETTINGS = { MAX_EDGE: VIDEO_MAX_EDGE, FRAME_RATE: 30 }

/**
 * H.264 first, always. It is hardware-encoded on iPhones and it is the only
 * codec whose output the Photos app will accept - a WebM would be neither
 * playable nor saveable there, which makes it useless as a share target.
 */
const CODEC_PREFERENCE: VideoCodec[] = ['avc', 'hevc', 'vp9', 'av1']

export type VideoProgress = (fraction: number) => void

export type ExportVideoOptions = {
  params: RenderParams
  modelVersion: number
  onProgress?: VideoProgress
  signal?: AbortSignal
}

export class VideoUnsupportedError extends Error {
  constructor() {
    super('This browser cannot encode video')
    this.name = 'VideoUnsupportedError'
  }
}

async function pickCodec(width: number, height: number): Promise<VideoCodec> {
  for (const codec of CODEC_PREFERENCE) {
    // Sequential on purpose: this is a preference order, and the first codec
    // the device accepts is the one we want. Probing before committing matters
    // on Android, where hardware encoders reject plenty of nominally valid
    // configurations.
    // oxlint-disable-next-line eslint/no-await-in-loop
    if (await canEncodeVideo(codec, { width, height })) return codec
  }
  throw new VideoUnsupportedError()
}

/** Even dimensions: H.264 chroma subsampling cannot represent odd ones. */
function evenSize(value: number): number {
  return Math.max(2, value - (value % 2))
}

/**
 * Renders the ten-second clip frame by frame and muxes it into an MP4.
 *
 * Frames are generated rather than captured, so this runs as fast as the GPU
 * and encoder allow instead of in real time, and the timeline is exact.
 */
export async function exportVideo(visionId: string, options: ExportVideoOptions): Promise<Blob> {
  const original = await getBlob(visionId, 'original')
  if (!original) throw new Error(`Vision ${visionId} has no original image`)

  const bitmap = await createImageBitmap(original.blob)
  const renderer = VisionRenderer.create(bitmap.width, bitmap.height, VIDEO_MAX_EDGE)

  try {
    renderer.setSource(bitmap)

    const depth = await getBlob(visionId, 'depth')
    if (depth) {
      const depthMap = await createImageBitmap(depth.blob)
      renderer.setDepth(depthMap)
      depthMap.close()
    }

    const width = evenSize(renderer.width)
    const height = evenSize(renderer.height)
    const codec = await pickCodec(width, height)

    const canvas = renderer.render(options.params, { time: 0, motion: 1 })

    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() })
    const source = new CanvasSource(canvas, {
      codec,
      quality: QUALITY_MEDIUM,
      keyFrameInterval: 2,
      // The canvas is a fixed size, but a clamped working resolution can make
      // it differ by a pixel from the even dimensions above.
      sizeChangeBehavior: 'contain',
    })
    output.addVideoTrack(source)
    await output.start()

    const frames = CLIP_SECONDS * FRAME_RATE
    const frameDuration = 1 / FRAME_RATE

    for (let frame = 0; frame < frames; frame++) {
      if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

      // Time runs 0..1 across the clip so the shader's periodic terms line up
      // with its length regardless of frame rate.
      renderer.render(options.params, { time: frame / frames, motion: 1 })
      // Awaiting each frame is the backpressure. Queueing all 300 at once
      // would hold every one of them in memory and is exactly how iOS decides
      // to kill the tab.
      // oxlint-disable-next-line eslint/no-await-in-loop
      await source.add(frame * frameDuration, frameDuration)

      options.onProgress?.((frame + 1) / frames)
    }

    await output.finalize()

    const buffer = output.target.buffer
    if (!buffer) throw new Error('The muxer produced no output')

    const blob = new Blob([buffer], { type: 'video/mp4' })

    await saveArtifact({
      visionId,
      kind: 'video',
      blob,
      params: options.params,
      modelVersion: options.modelVersion,
    })

    return blob
  } finally {
    bitmap.close()
    renderer.dispose()
  }
}
