import type { HighlightSpec, LayoutLine, LayoutWord, TextBlock, TextLayout } from './model'
import { MIN_READABLE_FONT_PX } from './model'
import { waitForFontsReady } from './fontReady'

export const PADDING = 32
export const FONT_FAMILY = '-apple-system, "Helvetica Neue", Arial, sans-serif'

/** Covers both a live DOM canvas context and an OffscreenCanvas context — the renderer doesn't care which. */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface LayoutMetrics {
  fontSize: number
  lineHeight: number
  paragraphGap: number
  contentWidth: number
  contentHeight: number
}

export function metricsFor(fontSize: number, width: number, height: number): LayoutMetrics {
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.35),
    paragraphGap: Math.round(fontSize * 0.55),
    contentWidth: width - PADDING * 2,
    contentHeight: height - PADDING * 2,
  }
}

/**
 * A canvas 2D context used purely for text measurement (never drawn to). Awaits font
 * readiness first — measuring or wrapping against a not-yet-loaded font produces wrong
 * widths (typically the fallback font's metrics), so every caller that creates a fresh
 * measurer gets the guarantee for free rather than needing to remember to await it.
 */
export async function createMeasurer(): Promise<Ctx2D> {
  await waitForFontsReady()
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(10, 10) : document.createElement('canvas')
  const ctx = canvas.getContext('2d') as Ctx2D | null
  if (!ctx) throw new Error('2d context unavailable for text measurement')
  return ctx
}

export function setFont(ctx: Ctx2D, fontSize: number, bold = false) {
  ctx.font = `${bold ? '600 ' : ''}${fontSize}px ${FONT_FAMILY}`
}

interface FlatWord {
  runId: string
  text: string
  highlight?: HighlightSpec
  isFirstOfParagraph: boolean
  blockIndex: number
}

/** Splits a word wider than maxWidth into multiple chunks that each fit (long URLs, long tokens). */
function splitOversizedWord(ctx: Ctx2D, word: string, maxWidth: number): string[] {
  const chars = Array.from(word)
  const chunks: string[] = []
  let current = ''
  for (const ch of chars) {
    const next = current + ch
    if (ctx.measureText(next).width > maxWidth && current.length > 0) {
      chunks.push(current)
      current = ch
    } else {
      current = next
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [word]
}

/** Flattens a paragraph's TextBlock runs into word tokens (multi-word runs/phrases split on internal whitespace but keep the same runId/highlight so they still animate and toggle as one unit). */
function flattenBlockToWords(block: TextBlock, blockIndex: number): FlatWord[] {
  const words: FlatWord[] = []
  block.runs.forEach((run) => {
    const parts = run.text.split(/\s+/).filter(Boolean)
    parts.forEach((part) => {
      words.push({ runId: run.id, text: part, highlight: run.highlight, isFirstOfParagraph: false, blockIndex })
    })
  })
  if (words.length > 0) words[0].isFirstOfParagraph = true
  return words
}

export interface WrappedLine {
  words: LayoutWord[]
  isFirstOfParagraph: boolean
  blockIndex: number
}

/** Word-wraps a set of paragraph blocks into lines within contentWidth. Pure layout, no pagination. */
export function wrapBlocksIntoLines(
  ctx: Ctx2D,
  blocks: TextBlock[],
  metrics: LayoutMetrics,
): WrappedLine[] {
  setFont(ctx, metrics.fontSize)
  const spaceWidth = ctx.measureText(' ').width
  const lines: WrappedLine[] = []
  let current: LayoutWord[] = []
  let currentWidth = 0
  let currentIsFirstOfParagraph = false
  let currentBlockIndex = 0

  function flush() {
    if (current.length === 0) return
    lines.push({ words: current, isFirstOfParagraph: currentIsFirstOfParagraph, blockIndex: currentBlockIndex })
    current = []
    currentWidth = 0
    currentIsFirstOfParagraph = false
  }

  blocks.forEach((block, blockIndex) => {
    const words = flattenBlockToWords(block, blockIndex)
    words.forEach((w, wi) => {
      if (w.isFirstOfParagraph && current.length > 0) flush()
      if (current.length === 0) {
        currentBlockIndex = w.blockIndex
        if (wi === 0) currentIsFirstOfParagraph = true
      }

      const text = w.text
      const width = ctx.measureText(text).width
      if (width > metrics.contentWidth) {
        // Long word/URL: hard-split into fitting chunks, each its own layout word.
        const chunks = splitOversizedWord(ctx, text, metrics.contentWidth)
        chunks.forEach((chunk) => {
          const chunkWidth = ctx.measureText(chunk).width
          const needed = current.length === 0 ? chunkWidth : currentWidth + spaceWidth + chunkWidth
          if (needed > metrics.contentWidth && current.length > 0) flush()
          if (current.length === 0) currentBlockIndex = w.blockIndex
          current.push({ runId: w.runId, text: chunk, x: 0, y: 0, width: chunkWidth, height: metrics.lineHeight, highlight: w.highlight, animatedIndex: -1 })
          currentWidth = current.length === 1 ? chunkWidth : currentWidth + spaceWidth + chunkWidth
        })
        return
      }

      const needed = current.length === 0 ? width : currentWidth + spaceWidth + width
      if (needed > metrics.contentWidth && current.length > 0) flush()
      if (current.length === 0) currentBlockIndex = w.blockIndex
      current.push({ runId: w.runId, text, x: 0, y: 0, width, height: metrics.lineHeight, highlight: w.highlight, animatedIndex: -1 })
      currentWidth = current.length === 1 ? width : currentWidth + spaceWidth + width
    })
  })
  flush()
  return lines
}

/** Positions already-wrapped lines (x per word, y per line) and assigns animatedIndex by first-appearance order of each animated runId. */
export function positionLines(ctx: Ctx2D, lines: WrappedLine[], metrics: LayoutMetrics): TextLayout {
  setFont(ctx, metrics.fontSize)
  const spaceWidth = ctx.measureText(' ').width
  const layoutLines: LayoutLine[] = []
  let y = 0
  let totalWords = 0
  const animatedIndexByRunId = new Map<string, number>()
  let animatedCounter = 0

  lines.forEach((line, i) => {
    if (i > 0 && line.isFirstOfParagraph) y += metrics.paragraphGap
    let x = 0
    line.words.forEach((w) => {
      w.x = x
      w.y = y
      x += w.width + spaceWidth
      totalWords += 1
      if (w.highlight?.animated) {
        if (!animatedIndexByRunId.has(w.runId)) animatedIndexByRunId.set(w.runId, animatedCounter++)
        w.animatedIndex = animatedIndexByRunId.get(w.runId)!
      }
    })
    layoutLines.push({ words: line.words, y, height: metrics.lineHeight })
    y += metrics.lineHeight
  })

  return {
    lines: layoutLines,
    overflowed: y > metrics.contentHeight,
    contentHeight: y,
    animatedWordCount: animatedIndexByRunId.size,
    totalWordCount: totalWords,
  }
}

/** Lays out a scene's blocks for rendering (no pagination — scene boundaries are already fixed). */
export function layoutScene(ctx: Ctx2D, blocks: TextBlock[], metrics: LayoutMetrics): TextLayout {
  const lines = wrapBlocksIntoLines(ctx, blocks, metrics)
  return positionLines(ctx, lines, metrics)
}

export function clampFontSize(fontSize: number): number {
  return Math.max(MIN_READABLE_FONT_PX, fontSize)
}
