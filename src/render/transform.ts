import { getBlob, saveArtifact } from '~/core/db/repositories'
import type { RenderParams } from '~/ml/params'
import { VisionRenderer } from '~/render/gl/renderer'

/** Model version 0 means the parameters came from defaults, not the network. */
export type TransformOptions = {
  params: RenderParams
  modelVersion: number
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas produced no image'))),
        'image/jpeg',
        0.92,
      )
    })
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
}

/**
 * Renders the transformation for a vision and stores it as a new artefact.
 *
 * Needs no model of any kind, which is what lets the app do something useful
 * on a first visit before a single byte of weights has been downloaded.
 */
export async function renderTransform(visionId: string, options: TransformOptions): Promise<Blob> {
  const original = await getBlob(visionId, 'original')
  if (!original) throw new Error(`Vision ${visionId} has no original image`)

  const bitmap = await createImageBitmap(original.blob)
  const renderer = VisionRenderer.create(bitmap.width, bitmap.height)

  try {
    renderer.setSource(bitmap)

    const depth = await getBlob(visionId, 'depth')
    if (depth) {
      const depthMap = await createImageBitmap(depth.blob)
      renderer.setDepth(depthMap)
      depthMap.close()
    }

    const blob = await canvasToBlob(renderer.render(options.params))

    await saveArtifact({
      visionId,
      kind: 'transform',
      blob,
      params: options.params,
      modelVersion: options.modelVersion,
    })

    return blob
  } finally {
    bitmap.close()
    // The GPU resources must go back even if the render threw, or a handful of
    // failures will exhaust the browser's context limit.
    renderer.dispose()
  }
}
