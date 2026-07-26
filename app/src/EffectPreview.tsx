import { useEffect, useRef } from 'react'
import { layoutSceneForRender } from './engine/document'
import { previewDocument, PREVIEW_PAUSE_MS } from './engine/previewDoc'
import { renderScene, sceneTimingFor } from './engine/render'
import type { EmphasisPresetId } from './engine/model'

/**
 * A one-word, looping sample of a single effect, shown on hover in the picker.
 *
 * Fourteen rows of names and colour swatches do not tell you what "Wash Away" or "Weight
 * Shift" actually look like, and finding out costs a click, a look, and an undo. Rendering the
 * real thing is cheap here because it goes through the same renderScene the export uses — the
 * hover preview cannot promise something the GIF then fails to deliver.
 */

export function EffectPreview({ preset, word }: { preset: EmphasisPresetId; word: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    let raf = 0
    const canvas = canvasRef.current
    if (!canvas) return

    const doc = previewDocument(word, preset)
    layoutSceneForRender(doc, doc.scenes[0]).then((layout) => {
      if (cancelled) return
      const dpr = Math.min(3, window.devicePixelRatio || 1)
      canvas.width = Math.round(doc.width * dpr)
      canvas.height = Math.round(doc.height * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const timing = sceneTimingFor(doc, layout)
      const loopMs = timing.totalMs + PREVIEW_PAUSE_MS
      let start = performance.now()

      const tick = () => {
        let elapsed = performance.now() - start
        if (elapsed >= loopMs) {
          start = performance.now()
          elapsed = 0
        }
        renderScene(ctx, doc, layout, elapsed, timing, 0, 0, dpr)
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    })

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
    }
  }, [preset, word])

  return <canvas ref={canvasRef} className="effect-preview-canvas" aria-hidden="true" />
}
