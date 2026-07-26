import type { EmphasisPresetId } from './model'

/**
 * Procedural materials for the annotation ink.
 *
 * A flat colour is what makes an annotation look printed rather than applied. Real ink varies
 * along the stroke — a marker starts saturated and runs out, pressure pools at the top of a
 * circled word, a pen's line thins as the hand accelerates. These materials describe that
 * variation.
 *
 * They are deliberately expressed as *backend-neutral gradient descriptions* rather than as
 * canvas calls. Canvas resolves them through createLinearGradient and the SVG exporter emits
 * the same stops as a <linearGradient>, so both backends paint identically and the
 * SVG-versus-raster agreement test keeps its meaning. This is also why they are not GPU
 * shaders: WebGL rasterises differently across drivers, so the same document would export
 * differently on different machines and that test could not exist.
 */

export interface PaintStop {
  /** 0..1 along the gradient axis. */
  at: number
  colour: string
}

export type Paint =
  | { kind: 'solid'; colour: string }
  | {
      kind: 'gradient'
      /**
       * `along` runs the length of the phrase (how ink depletes as the hand travels);
       * `down` runs top to bottom of the line box (how pressure pools).
       */
      axis: 'along' | 'down'
      stops: PaintStop[]
    }

/**
 * One material per effect, so "different effects" also means "different inks" rather than the
 * same stroke in a different colour.
 */
export const MATERIAL_BY_PRESET: Partial<Record<EmphasisPresetId, Paint>> = {
  // A highlighter laid down in one pass: wet and saturated where it started, drying out by
  // the end of the word.
  'marker-highlight': {
    kind: 'gradient',
    axis: 'along',
    stops: [
      { at: 0, colour: 'rgba(255, 205, 60, 0.72)' },
      { at: 0.55, colour: 'rgba(255, 214, 79, 0.6)' },
      { at: 1, colour: 'rgba(255, 228, 138, 0.42)' },
    ],
  },
  // Pink ink pooling downward under its own weight.
  'bow-highlight': {
    kind: 'gradient',
    axis: 'down',
    stops: [
      { at: 0, colour: 'rgba(255, 158, 195, 0.34)' },
      { at: 1, colour: 'rgba(255, 116, 168, 0.52)' },
    ],
  },
  // A pen stroke that thins as the hand accelerates away from the first letter.
  'underline-draw': {
    kind: 'gradient',
    axis: 'along',
    stops: [
      { at: 0, colour: '#1f4fc4' },
      { at: 1, colour: '#5b8bff' },
    ],
  },
  // Struck out in one decisive pass — heaviest through the middle.
  'strike-through': {
    kind: 'gradient',
    axis: 'along',
    stops: [
      { at: 0, colour: '#e86a5f' },
      { at: 0.5, colour: '#cf2f21' },
      { at: 1, colour: '#e86a5f' },
    ],
  },
  // Pressure at the top of the loop where the pen lands, lighter as it comes round.
  'circle-annotation': {
    kind: 'gradient',
    axis: 'down',
    stops: [
      { at: 0, colour: '#c8341f' },
      { at: 1, colour: '#f0705f' },
    ],
  },
  'box-annotation': {
    kind: 'gradient',
    axis: 'down',
    stops: [
      { at: 0, colour: '#2b6cff' },
      { at: 1, colour: '#4d86ff' },
    ],
  },
  'bracket': {
    kind: 'gradient',
    axis: 'down',
    stops: [
      { at: 0, colour: '#4d86ff' },
      { at: 1, colour: '#1f4fc4' },
    ],
  },
}

export interface PaintBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Gradient endpoints for a paint over a given box, shared by both backends. */
export function paintAxis(paint: Paint, box: PaintBox): { x1: number; y1: number; x2: number; y2: number } {
  if (paint.kind === 'solid' || paint.axis === 'along') {
    return { x1: box.x0, y1: box.y0, x2: box.x1, y2: box.y0 }
  }
  return { x1: box.x0, y1: box.y0, x2: box.x0, y2: box.y1 }
}

/** The material for a preset, or a solid fallback for presets that have none. */
export function materialFor(preset: EmphasisPresetId, fallback: string): Paint {
  return MATERIAL_BY_PRESET[preset] ?? { kind: 'solid', colour: fallback }
}
