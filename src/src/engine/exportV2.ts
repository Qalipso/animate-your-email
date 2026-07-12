import { layoutSceneForRender } from './document'
import { computeSceneTiming, renderScene } from './render'
import type { AnimatedDocument, Scene } from './model'

export function exportDocumentAsGif(doc: AnimatedDocument, fps = 12): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gifWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ type: string; blob?: Blob; message?: string }>) => {
      worker.terminate()
      if (e.data.type === 'done' && e.data.blob) resolve(e.data.blob)
      else reject(new Error(e.data.message ?? 'GIF export failed'))
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(new Error(err.message))
    }
    worker.postMessage({ doc, fps })
  })
}

function renderSceneSettled(doc: AnimatedDocument, scene: Scene): OffscreenCanvas {
  const layout = layoutSceneForRender(doc, scene)
  const timing = computeSceneTiming(layout, scene.entrance)
  const canvas = new OffscreenCanvas(doc.width, doc.height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  renderScene(ctx, doc, layout, scene.entrance, timing.totalMs, timing)
  return canvas
}

export async function exportSceneAsPng(doc: AnimatedDocument, scene: Scene): Promise<Blob> {
  const canvas = renderSceneSettled(doc, scene)
  return canvas.convertToBlob({ type: 'image/png' })
}

export async function exportAllScenesAsPngSequence(doc: AnimatedDocument): Promise<{ name: string; blob: Blob }[]> {
  const out: { name: string; blob: Blob }[] = []
  for (let i = 0; i < doc.scenes.length; i++) {
    const canvas = renderSceneSettled(doc, doc.scenes[i])
    const blob = await canvas.convertToBlob({ type: 'image/png' })
    out.push({ name: `scene-${i + 1}.png`, blob })
  }
  return out
}
