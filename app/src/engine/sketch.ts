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

function n(v: number): string {
  return (Math.round(v * 100) / 100).toString()
}

/**
 * The geometry of a hand-drawn line, as SVG path data — one `d` string per pass.
 *
 * Geometry is produced here and *only* here. The canvas renderer strokes these paths through
 * Path2D and the SVG exporter emits them verbatim, so the two backends cannot drift apart.
 * A second, independently-written renderer is precisely what caused DEC-007 and DEC-008.
 */
export function sketchLinePaths(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
): string[] {
  if (progress <= 0) return []
  const ex = x1 + (x2 - x1) * progress
  const ey = y1 + (y2 - y1) * progress
  const dx = ex - x1
  const dy = ey - y1
  const len = Math.hypot(dx, dy)
  if (len < 0.5) return []
  // Perpendicular unit vector — the direction a stroke is allowed to wander.
  const px = -dy / len
  const py = dx / len

  const paths: string[] = []
  for (let pass = 0; pass < style.passes; pass++) {
    const bow = (rand() - 0.5) * 2 * style.roughness
    const startJitter = (rand() - 0.5) * style.roughness * 0.6
    const endJitter = (rand() - 0.5) * style.roughness * 0.6
    paths.push(
      `M ${n(x1 + px * startJitter)} ${n(y1 + py * startJitter)} Q ${n((x1 + ex) / 2 + px * bow)} ${n(
        (y1 + ey) / 2 + py * bow,
      )} ${n(ex + px * endJitter)} ${n(ey + py * endJitter)}`,
    )
  }
  return paths
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
  for (const d of sketchLinePaths(x1, y1, x2, y2, progress, rand, style)) {
    ctx.stroke(new Path2D(d))
  }
}

/**
 * An ellipse drawn as a continuous sweep from `startAngle`, `progress` of the way round.
 * Slightly over-sweeps (a real circled word usually overshoots where the pen started), and
 * each pass wobbles its radius so the two laps don't overlap exactly.
 */
export function sketchEllipsePaths(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
): string[] {
  if (progress <= 0) return []
  const OVERSWEEP = 1.12 // laps slightly past the start, the way a hand does
  const startAngle = -Math.PI * 0.75
  const segments = 48

  const paths: string[] = []
  for (let pass = 0; pass < style.passes; pass++) {
    const rxJitter = rx + (rand() - 0.5) * style.roughness * 2
    const ryJitter = ry + (rand() - 0.5) * style.roughness * 2
    const phase = (rand() - 0.5) * 0.25
    const end = startAngle + Math.PI * 2 * OVERSWEEP * progress
    let d = ''
    for (let i = 0; i <= segments; i++) {
      const a = startAngle + ((end - startAngle) * i) / segments
      if (a > end) break
      // A slow sinusoidal wobble around the path reads as an unsteady hand; a per-point
      // random offset would just read as noise.
      const wobble = Math.sin(a * 3 + phase * 8) * style.roughness * 0.5
      const x = cx + Math.cos(a + phase) * (rxJitter + wobble)
      const y = cy + Math.sin(a + phase) * (ryJitter + wobble)
      d += `${i === 0 ? 'M' : ' L'} ${n(x)} ${n(y)}`
    }
    if (d) paths.push(d)
  }
  return paths
}

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
  for (const d of sketchEllipsePaths(cx, cy, rx, ry, progress, rand, style)) {
    ctx.stroke(new Path2D(d))
  }
}

/**
 * A rectangle drawn edge by edge, `progress` of the way round its perimeter — so it reads as
 * being drawn, not as fading in.
 */
/**
 * A wavy line — the proofreader's squiggle. The wavelength is fixed in px rather than as a
 * fraction of the span, so a long phrase gets more waves instead of longer ones, which is how
 * a hand actually draws it.
 */
export function sketchWavePaths(
  x1: number,
  y: number,
  x2: number,
  wavelength: number,
  amplitude: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
): string[] {
  if (progress <= 0) return []
  const end = x1 + (x2 - x1) * progress
  const span = end - x1
  if (span < 1) return []
  const steps = Math.max(6, Math.ceil(span / 3))
  const phase = rand() * Math.PI * 2

  const paths: string[] = []
  for (let pass = 0; pass < style.passes; pass++) {
    const drift = (rand() - 0.5) * style.roughness
    let d = ''
    for (let i = 0; i <= steps; i++) {
      const px = x1 + (span * i) / steps
      const py = y + Math.sin(phase + ((px - x1) / wavelength) * Math.PI * 2) * amplitude + drift
      d += `${i === 0 ? 'M' : ' L'} ${n(px)} ${n(py)}`
    }
    paths.push(d)
  }
  return paths
}

export function sketchRectPaths(
  x: number,
  y: number,
  w: number,
  h: number,
  progress: number,
  rand: () => number,
  style: SketchStyle,
): string[] {
  if (progress <= 0) return []
  const edges: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h],
    [x + w, y + h, x, y + h],
    [x, y + h, x, y],
  ]
  const perimeter = 2 * (w + h)
  let drawn = perimeter * progress
  const paths: string[] = []
  for (const [ax, ay, bx, by] of edges) {
    if (drawn <= 0) break
    const len = Math.hypot(bx - ax, by - ay)
    const edgeProgress = Math.min(1, drawn / len)
    paths.push(...sketchLinePaths(ax, ay, bx, by, edgeProgress, rand, style))
    drawn -= len
  }
  return paths
}

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
  for (const d of sketchRectPaths(x, y, w, h, progress, rand, style)) {
    ctx.stroke(new Path2D(d))
  }
}
