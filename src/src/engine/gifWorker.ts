/// <reference lib="webworker" />
import { exportGif } from '../gifExport'
import { buildTimeline, renderTimelineFrame } from './timeline'
import type { AnimatedDocument } from './model'

export interface GifWorkerRequest {
  doc: AnimatedDocument
  fps: number
}

// Runs entirely off the main thread: layout + render + gifenc encode all happen here,
// per the "GIF through gifenc in a Web Worker" requirement.
self.onmessage = async (e: MessageEvent<GifWorkerRequest>) => {
  try {
    const { doc, fps } = e.data
    const timeline = await buildTimeline(doc)
    const canvas = new OffscreenCanvas(doc.width, doc.height)
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D

    const blob = exportGif(
      {
        width: doc.width,
        height: doc.height,
        renderFrame: (tSec) => {
          renderTimelineFrame(ctx, doc, timeline, tSec * 1000)
          return ctx.getImageData(0, 0, doc.width, doc.height)
        },
      },
      { fps, durationMs: timeline.totalMs },
    )

    self.postMessage({ type: 'done', blob })
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message })
  }
}
