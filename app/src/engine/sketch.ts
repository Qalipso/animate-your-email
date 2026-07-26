import type { Ctx2D } from './layout'

/**
 * Hand-drawn stroke primitives.
 *
 * The look is the one Rough Notation / RoughJS popularised: a stroke is never a straight
 * line, it bows slightly off course and is drawn more than once so the passes don't quite
 * agree. That "not quite mechanical" quality is what makes an annotation read as a person
 * marking up a page rather than a rectangle a program drew.
 *
 * Everything here is a pure function of a seed string, never Math.random(): the live preview
 * and the exported GIF must produce byte-identical frames, and a frame re-rendered at the
 * same time must look the same (the whole reason DEC-007/DEC-008 happened was two renderers
 * disagreeing).
 */

/** Small deterministic PRNG (FNV-1a seed + xorshift-ish mixing) — same seed, same sequence. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

export interface SketchStyle {
  /** How far, in px, a stroke may wander off the true path. Scales with font size at the call site. */
  roughness: number
  /** How many times to redraw the same stroke. 2 reads as pen-on-paper; 1 reads as a ruler. */
  passes: number
}

/**
 * A line from (x1,y1) to (x2,y2), drawn `progress` of the way along, with a hand-drawn bow.
 * The path is truncated rather than scaled, so a stroke growing over time keeps the exact
 * shape it will end with instead of morphing.
 */
export function sketchLine(
  ctx: Ctx2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
) {
  if (progress <= 0) return
  const ex = x1 + (x2 - x1) * progress
  const ey = y1 + (y2 - y1) * progress
  const dx = ex - x1
  const dy = ey - y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return
  // Perpendicular unit vector — the direction a stroke is allowed to wander.
  const px = -dy / len
  const py = dx / len

  for (let pass = 0; pass < style.passes; pass++) {
    const bow = (rand() - 0.5) * 2 * style.roughness
    const startJitter = (rand() - 0.5) * style.roughness * 0.6
    const endJitter = (rand() - 0.5) * style.roughness * 0.6
    ctx.beginPath()
    ctx.moveTo(x1 + px * startJitter, y1 + py * startJitter)
    ctx.quadraticCurveTo(
      (x1 + ex) / 2 + px * bow,
      (y1 + ey) / 2 + py * bow,
      ex + px * endJitter,
      ey + py * endJitter,
    )
    ctx.stroke()
  }
}

/**
 * An ellipse drawn as a continuous sweep from `startAngle`, `progress` of the way round.
 * Slightly over-sweeps (a real circled word usually overshoots where the pen started), and
 * each pass wobbles its radius so the two laps don't overlap exactly.
 */
export function sketchEllipse(
  ctx: Ctx2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
) {
  if (progress <= 0) return
  const OVERSWEEP = 1.12 // laps slightly past the start, the way a hand does
  const startAngle = -Math.PI * 0.75
  const segments = 48

  for (let pass = 0; pass < style.passes; pass++) {
    const rxJitter = rx + (rand() - 0.5) * style.roughness * 2
    const ryJitter = ry + (rand() - 0.5) * style.roughness * 2
    const phase = (rand() - 0.5) * 0.25
    const end = startAngle + Math.PI * 2 * OVERSWEEP * progress
    ctx.beginPath()
    for (let i = 0; i <= segments; i++) {
      const a = startAngle + ((end - startAngle) * i) / segments
      if (a > end) break
      // A slow sinusoidal wobble around the path reads as an unsteady hand; a per-point
      // random offset would just read as noise.
      const wobble = Math.sin(a * 3 + phase * 8) * style.roughness * 0.5
      const x = cx + Math.cos(a + phase) * (rxJitter + wobble)
      const y = cy + Math.sin(a + phase) * (ryJitter + wobble)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }
}

/**
 * A rectangle drawn edge by edge, `progress` of the way round its perimeter — so it reads as
 * being drawn, not as fading in.
 */
export function sketchRect(
  ctx: Ctx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
) {
  if (progress <= 0) return
  const edges: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ]
  const perimeter = 2 * (w + h)
  let drawn = perimeter * progress
  for (const [ax, ay, bx, by] of edges) {
    if (drawn <= 0) return
    const len = Math.hypot(bx - ax, by - ay)
    const edgeProgress = Math.min(1, drawn / len)
    sketchLine(ctx, ax, ay, bx, by, edgeProgress, rand, style)
    drawn -= len
  }
}
