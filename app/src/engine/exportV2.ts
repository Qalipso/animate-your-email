import { layoutSceneForRender } from './document'
import { GIF_FPS, SUPERSAMPLE } from './quality'
import { renderScene, sceneTimingFor } from './render'
import type { GifWorkerResponse } from './gifWorker'
import type { AnimatedDocument, Scene } from './model'

export class ExportCancelledError extends Error {
  constructor() {
    super('Export cancelled')
    this.name = 'ExportCancelledError'
  }
}

// Module-level singleton: only one GIF export (the expensive, worker-based one) may be
// in flight at a time. A second call while one is active is rejected outright rather
// than silently queued or allowed to race a second worker against the first.
let activeWorker: Worker | null = null
let activeReject: ((reason: unknown) => void) | null = null

export function isExportInProgress(): boolean {
  return activeWorker !== null
}

export function cancelExport(): void {
  if (!activeWorker) return
  activeWorker.terminate()
  activeReject?.(new ExportCancelledError())
  activeWorker = null
  activeReject = null
}

export function exportDocumentAsGif(
  doc: AnimatedDocument,
  fps = GIF_FPS,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  if (activeWorker) {
    return Promise.reject(new Error('An export is already in progress — cancel it first.'))
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' })
    activeWorker = worker
    activeReject = reject

    const finish = () => {
      if (activeWorker === worker) {
        activeWorker = null
        activeReject = null
      }
      worker.terminate()
    }

    worker.onmessage = (e: MessageEvent<GifWorkerResponse>) => {
      if (e.data.type === 'progress') {
        onProgress?.(e.data.value)
        return
      }
      finish()
      if (e.data.type === 'done') resolve(e.data.blob)
      else reject(new Error(e.data.message ?? 'GIF export failed'))
    }
    worker.onerror = (err) => {
      finish()
      reject(new Error(err.message))
    }
    worker.postMessage({ doc, fps })
  })
}

/**
 * A scene's final settled frame, supersampled and filtered down to the output size — the
 * same fidelity the GIF path uses, so a copied still and a copied animation never differ
 * in sharpness.
 */
async function renderSceneSettled(doc: AnimatedDocument, scene: Scene): Promise<OffscreenCanvas> {
  const layout = await layoutSceneForRender(doc, scene)
  const timing = sceneTimingFor(doc, layout)

  const hiCanvas = new OffscreenCanvas(doc.width * SUPERSAMPLE, doc.height * SUPERSAMPLE)
  const hiCtx = hiCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  hiCtx.scale(SUPERSAMPLE, SUPERSAMPLE)
  renderScene(hiCtx, doc, layout, timing.totalMs, timing, 0, 0, SUPERSAMPLE)

  const canvas = new OffscreenCanvas(doc.width, doc.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(hiCanvas, 0, 0, doc.width, doc.height)
  return canvas
}

export async function exportSceneAsPng(doc: AnimatedDocument, scene: Scene): Promise<Blob> {
  const canvas = await renderSceneSettled(doc, scene)
  return canvas.convertToBlob({ type: 'image/png' })
}
