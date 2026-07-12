import { zipSync } from 'fflate'
import { layoutSceneForRender } from './document'
import { computeSceneTiming, renderScene } from './render'
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

export function exportDocumentAsGif(doc: AnimatedDocument, fps = 12): Promise<Blob> {
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

    worker.onmessage = (e: MessageEvent<{ type: string; blob?: Blob; message?: string }>) => {
      finish()
      if (e.data.type === 'done' && e.data.blob) resolve(e.data.blob)
      else reject(new Error(e.data.message ?? 'GIF export failed'))
    }
    worker.onerror = (err) => {
      finish()
      reject(new Error(err.message))
    }
    worker.postMessage({ doc, fps })
  })
}

async function renderSceneSettled(doc: AnimatedDocument, scene: Scene): Promise<OffscreenCanvas> {
  const layout = await layoutSceneForRender(doc, scene)
  const timing = computeSceneTiming(layout, scene.entrance)
  const canvas = new OffscreenCanvas(doc.width, doc.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  renderScene(ctx, doc, layout, scene.entrance, timing.totalMs, timing)
  return canvas
}

export async function exportSceneAsPng(doc: AnimatedDocument, scene: Scene): Promise<Blob> {
  const canvas = await renderSceneSettled(doc, scene)
  return canvas.convertToBlob({ type: 'image/png' })
}

/** All scenes' settled frames as PNGs, bundled into a single ZIP (not N separate downloads). */
export async function exportScenesAsZip(doc: AnimatedDocument): Promise<Blob> {
  const entries: Record<string, Uint8Array> = {}
  for (let i = 0; i < doc.scenes.length; i++) {
    const canvas = await renderSceneSettled(doc, doc.scenes[i])
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    const bytes = new Uint8Array(await blob.arrayBuffer())
    entries[`scene-${String(i + 1).padStart(2, '0')}.png`] = bytes
  }
  const zipped = zipSync(entries, { level: 0 }) // PNG is already compressed; STORED-equivalent is fine and fast
  return new Blob([zipped], { type: 'application/zip' })
}
