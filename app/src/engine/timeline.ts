import { layoutSceneForRender } from './document'
import { renderScene, sceneTimingFor, type SceneTiming } from './render'
import type { Ctx2D } from './layout'
import type { AnimatedDocument, Scene, TextLayout, TransitionPresetId } from './model'

const TRANSITION_MS = 650

interface SceneSegment {
  kind: 'scene'
  scene: Scene
  layout: TextLayout
  timing: SceneTiming
  startMs: number
  endMs: number
}

interface TransitionSegment {
  kind: 'transition'
  from: Scene
  fromLayout: TextLayout
  to: Scene
  toLayout: TextLayout
  toTiming: SceneTiming
  preset: TransitionPresetId
  startMs: number
  endMs: number
}

export type Segment = SceneSegment | TransitionSegment

export interface Timeline {
  segments: Segment[]
  totalMs: number
}

/** Builds the full document timeline: each scene's own animation, with a transition segment inserted between consecutive scenes. Pure/serializable-input-safe so it can run on the main thread or inside a Web Worker. Layout (and its font-readiness gate) is resolved once here; renderTimelineFrame below stays synchronous so the per-frame export loop doesn't pay a repeated async cost. */
export async function buildTimeline(doc: AnimatedDocument): Promise<Timeline> {
  const segments: Segment[] = []
  let cursor = 0
  const layouts = await Promise.all(doc.scenes.map((s) => layoutSceneForRender(doc, s)))
  const timings = layouts.map((l) => sceneTimingFor(doc, l))

  doc.scenes.forEach((scene, i) => {
    const timing = timings[i]
    segments.push({ kind: 'scene', scene, layout: layouts[i], timing, startMs: cursor, endMs: cursor + timing.totalMs })
    cursor += timing.totalMs

    const next = doc.scenes[i + 1]
    if (next) {
      segments.push({
        kind: 'transition',
        from: scene,
        fromLayout: layouts[i],
        to: next,
        toLayout: layouts[i + 1],
        toTiming: timings[i + 1],
        preset: scene.transition,
        startMs: cursor,
        endMs: cursor + TRANSITION_MS,
      })
      cursor += TRANSITION_MS
    }
  })

  return { segments, totalMs: cursor }
}

function makeCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

/**
 * Renders the full document at globalTMs onto ctx — dispatches to the right scene or
 * transition segment. Reused by the live preview (scene-by-scene) and by GIF export
 * (full timeline).
 *
 * `pixelScale` is the supersampling factor the caller has already applied to ctx via
 * ctx.scale(); the transition scratch buffers are allocated at that same device
 * resolution so a transition frame is never the one soft frame in an otherwise sharp GIF.
 */
export function renderTimelineFrame(
  ctx: Ctx2D,
  doc: AnimatedDocument,
  timeline: Timeline,
  globalTMs: number,
  pixelScale = 1,
) {
  const seg = timeline.segments.find((s) => globalTMs >= s.startMs && globalTMs < s.endMs) ?? timeline.segments[timeline.segments.length - 1]
  if (!seg) return

  if (seg.kind === 'scene') {
    renderScene(ctx, doc, seg.layout, globalTMs - seg.startMs, seg.timing, 0, 0, pixelScale)
    return
  }

  // Transition: render both scenes onto scratch canvases, then composite.
  const progress = Math.min(1, Math.max(0, (globalTMs - seg.startMs) / (seg.endMs - seg.startMs)))
  const deviceWidth = Math.round(doc.width * pixelScale)
  const deviceHeight = Math.round(doc.height * pixelScale)
  const bufferA = makeCanvas(deviceWidth, deviceHeight)
  const bufferB = makeCanvas(deviceWidth, deviceHeight)
  const ctxA = bufferA.getContext('2d') as Ctx2D
  const ctxB = bufferB.getContext('2d') as Ctx2D
  ctxA.scale(pixelScale, pixelScale)
  ctxB.scale(pixelScale, pixelScale)

  // Outgoing scene: freeze on its final settled frame.
  const fromTimingFinal: SceneTiming = {
    entranceMs: 0,
    emphasisStartMs: 0,
    emphasisEndMs: 0,
    totalMs: 0,
    phraseDurationMs: 1,
    phraseStaggerMs: 0,
  }
  renderScene(ctxA, doc, seg.fromLayout, 1_000_000, fromTimingFinal, 0, 0, pixelScale)
  // Incoming scene: plays its own lead-in starting at t=0 through the transition window.
  renderScene(ctxB, doc, seg.toLayout, progress * TRANSITION_MS, seg.toTiming, 0, 0, pixelScale)

  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, doc.width, doc.height)

  // Explicit destination size: the buffers are in device pixels while ctx is in logical
  // units, so the 2-argument drawImage overload would blow them up by pixelScale.
  if (seg.preset === 'crossfade') {
    ctx.globalAlpha = 1 - progress
    ctx.drawImage(bufferA as CanvasImageSource, 0, 0, doc.width, doc.height)
    ctx.globalAlpha = progress
    ctx.drawImage(bufferB as CanvasImageSource, 0, 0, doc.width, doc.height)
  } else {
    // slide-up: outgoing slides up and out, incoming slides up from below into place.
    ctx.globalAlpha = 1
    ctx.drawImage(bufferA as CanvasImageSource, 0, -doc.height * progress, doc.width, doc.height)
    ctx.drawImage(bufferB as CanvasImageSource, 0, doc.height * (1 - progress), doc.width, doc.height)
  }
  ctx.restore()
}
