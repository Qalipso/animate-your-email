export type SplitUnit = 'block' | 'word' | 'character'
export type StaggerOrder = 'forward' | 'reverse' | 'random' | 'center-out'
export type Category = 'Clean' | 'Typing' | 'Editorial' | 'Playful' | 'Bold' | 'Light & Color'
export type Easing = (t: number) => number

/** The animatable state of a single split segment (whole text, one word, or one character). */
export interface ObjectState {
  opacity: number
  x: number
  y: number
  scale: number
  rotate: number
  fill: string
  glowColor: string
  glowBlur: number
}

export const DEFAULT_STATE: ObjectState = {
  opacity: 1,
  x: 0,
  y: 0,
  scale: 1,
  rotate: 0,
  fill: '#1a1a1a',
  glowColor: 'transparent',
  glowBlur: 0,
}

export interface Oscillation {
  /** which channel the decaying sine wave is applied to, on top of the lerp'd value */
  channel: 'x' | 'y' | 'rotate' | 'glowBlur'
  amplitude: number
  cycles: number
}

/**
 * A preset is a declarative document: target values + how they're distributed across
 * split segments, not one-off animation code. See DEC-003/DEC-006.
 */
export interface Preset {
  id: string
  name: string
  category: Category
  split: SplitUnit
  /** ms before the entrance animation begins (e.g. Countdown's held-blank frame) */
  delayMs?: number
  entranceMs: number
  /** ms the text holds fully visible before the GIF loop ends */
  holdMs: number
  ease: Easing
  from: Partial<ObjectState>
  to: Partial<ObjectState>
  stagger?: { order: StaggerOrder; amountMs: number }
  oscillation?: Oscillation
  /** deterministic per-frame color flicker between from.fill/to.fill, approximating glitch */
  colorFlicker?: boolean
  /** an extra decorative rect (underline / highlight bar) driven by the same progress */
  decoration?: 'underline' | 'highlightBar'
}
