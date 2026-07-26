/// <reference lib="webworker" />
import { exportGif } from '../gifExport'
import { buildTimeline, renderTimelineFrame } from './timeline'
import { SUPERSAMPLE } from './quality'
import type { AnimatedDocument } from './model'

export interface GifWorkerRequest {
  doc: AnimatedDocument
  fps: number
}

export type GifWorkerResponse =
  | { type: 'progress'; value: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string }

// Runs entirely off the main thread: layout + render + gifenc encode all happen here,
// per the "GIF through gifenc in a Web Worker" requirement.
self.onmessage = async (e: MessageEvent<GifWorkerRequest>) => {
  try {
    const { doc, fps } = e.data
    const timeline = await buildTimeline(doc)

    // Supersample: draw at SUPERSAMPLE× and box-filter down to the output size. A GIF is
    // limited to 256 hard colours with no alpha, so the anti-aliasing baked in at render
    // time is all the smoothing a glyph edge ever gets — rendering 1:1 left text visibly
    // jagged. Downscaling a 2× render gives each output pixel four samples to average.
    const hiCanvas = new OffscreenCanvas(doc.width * SUPERSAMPLE, doc.height * SUPERSAMPLE)
    const hiCtx = hiCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    hiCtx.scale(SUPERSAMPLE, SUPERSAMPLE)

    const outCanvas = new OffscreenCanvas(doc.width, doc.height)
    const outCtx = outCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    outCtx.imageSmoothingEnabled = true
    outCtx.imageSmoothingQuality = 'high'

    let lastReported = -1

    const blob = exportGif(
      {
        width: doc.width,
        height: doc.height,
        renderFrame: (tSec) => {
          renderTimelineFrame(hiCtx, doc, timeline, tSec * 1000, SUPERSAMPLE)
          outCtx.drawImage(hiCanvas, 0, 0, doc.width, doc.height)
          return outCtx.getImageData(0, 0, doc.width, doc.height)
        },
      },
      {
        fps,
        durationMs: timeline.totalMs,
        onProgress: (fraction) => {
          // The encode loop is synchronous, so throttle to whole percent to avoid flooding
          // the main thread's task queue with hundreds of no-op messages.
          const percent = Math.round(fraction * 100)
          if (percent === lastReported) return
          lastReported = percent
          self.postMessage({ type: 'progress', value: fraction } satisfies GifWorkerResponse)
        },
      },
    )

    self.postMessage({ type: 'done', blob } satisfies GifWorkerResponse)
  } catch (err) {
    self.postMessage({ type: 'error', message: (err as Error).message } satisfies GifWorkerResponse)
  }
}
