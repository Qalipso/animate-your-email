export type Easing = (t: number) => number

export const easeOutCubic: Easing = (t) => 1 - (1 - t) ** 3
export const linear: Easing = (t) => t

export interface Preset {
  id: string
  name: string
  /** ms for the entrance animation */
  entranceMs: number
  /** ms the text holds fully visible before the GIF ends */
  holdMs: number
  ease: Easing
  from: { opacity: number; translateY: number }
  to: { opacity: number; translateY: number }
}

/** Declarative presets: each is data (target values + easing), not one-off animation code. */
export const PRESETS: Preset[] = [
  {
    id: 'fade',
    name: 'Fade',
    entranceMs: 700,
    holdMs: 1200,
    ease: easeOutCubic,
    from: { opacity: 0, translateY: 0 },
    to: { opacity: 1, translateY: 0 },
  },
  {
    id: 'rise',
    name: 'Rise',
    entranceMs: 850,
    holdMs: 1200,
    ease: easeOutCubic,
    from: { opacity: 0, translateY: 28 },
    to: { opacity: 1, translateY: 0 },
  },
]

/** Evaluates a preset's opacity/translateY at time t (ms) from animation start. */
export function sampleAt(preset: Preset, tMs: number): { opacity: number; translateY: number } {
  const progress = Math.min(1, Math.max(0, tMs / preset.entranceMs))
  const eased = preset.ease(progress)
  return {
    opacity: preset.from.opacity + (preset.to.opacity - preset.from.opacity) * eased,
    translateY: preset.from.translateY + (preset.to.translateY - preset.from.translateY) * eased,
  }
}
