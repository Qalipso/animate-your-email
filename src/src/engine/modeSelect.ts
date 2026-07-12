import type { OutputMode } from './model'

export interface ModePreset {
  width: number
  height: number
  fontSize: number
}

export const MODE_PRESETS: Record<OutputMode, ModePreset> = {
  'one-card': { width: 600, height: 320, fontSize: 40 },
  paragraph: { width: 600, height: 400, fontSize: 26 },
  story: { width: 600, height: 360, fontSize: 28 },
}

/** Length-based auto-selection, matching the spec's "auto-select based on text length" — the user can always override. */
export function autoSelectMode(text: string): OutputMode {
  const len = text.trim().length
  const hasParagraphBreak = /\n\s*\n/.test(text.trim())
  if (len <= 80 && !hasParagraphBreak) return 'one-card'
  if (len <= 400 && !hasParagraphBreak) return 'paragraph'
  return 'story'
}
