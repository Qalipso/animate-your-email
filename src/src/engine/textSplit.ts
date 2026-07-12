import type { SplitUnit } from './types'

export interface Segment {
  text: string
  /** left edge, relative to the start of the line */
  x: number
  width: number
}

/**
 * Splits text into segments per the preset's split unit and measures each one so they
 * can be laid out left-to-right on a single line. Word/character split assume the text
 * fits on one line — acceptable for V1's short-message scope (see v1-scope.md).
 */
export function splitAndMeasure(
  ctx: CanvasRenderingContext2D,
  text: string,
  unit: SplitUnit,
): { segments: Segment[]; totalWidth: number } {
  const pieces = unit === 'block' ? [text] : unit === 'word' ? splitWords(text) : Array.from(text)

  let x = 0
  const segments: Segment[] = pieces.map((piece) => {
    const width = ctx.measureText(piece).width
    const seg: Segment = { text: piece, x, width }
    x += width
    return seg
  })

  return { segments, totalWidth: x }
}

/** Splits on spaces but keeps a trailing space attached to each word so gaps render. */
function splitWords(text: string): string[] {
  const words = text.split(' ')
  return words.map((w, i) => (i < words.length - 1 ? w + ' ' : w))
}
