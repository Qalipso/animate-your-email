import { detectHighlights } from './highlight'
import {
  PADDING,
  clampFontSize,
  createMeasurer,
  metricsFor,
  positionLines,
  wrapBlocksIntoLines,
  type Ctx2D,
  type WrappedLine,
} from './layout'
import { MODE_PRESETS } from './modeSelect'
import type {
  AnimatedDocument,
  EmphasisPresetId,
  EntrancePresetId,
  OutputMode,
  Scene,
  TextBlock,
  TextRun,
  TransitionPresetId,
} from './model'
import { MAX_ANIMATED_PHRASES_PER_SCENE, MAX_CHARACTERS, MAX_FRAME_HEIGHT, MIN_READABLE_FONT_PX } from './model'

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${idCounter}`
}

/** Splits the flat highlight-detected run stream into paragraph blocks at isBreak markers. */
function splitIntoParagraphBlocks(runs: TextRun[]): TextBlock[] {
  const blocks: TextBlock[] = []
  let current: TextRun[] = []
  for (const run of runs) {
    if (run.isBreak) {
      if (current.length > 0) blocks.push({ id: nextId('block'), runs: current })
      current = []
      continue
    }
    current.push(run)
  }
  if (current.length > 0) blocks.push({ id: nextId('block'), runs: current })
  return blocks.length > 0 ? blocks : [{ id: nextId('block'), runs: [] }]
}

/** Re-joins consecutive same-runId LayoutWords in a scene's lines back into TextRun/TextBlock structures — the model stays the source of truth even though pagination worked at word/line granularity. */
function synthesizeSceneBlocks(sceneLines: WrappedLine[]): TextBlock[] {
  const blocks: TextBlock[] = []
  let currentBlock: TextBlock | null = null
  let currentBlockIndex = -1

  for (const line of sceneLines) {
    if (line.blockIndex !== currentBlockIndex || !currentBlock) {
      currentBlock = { id: nextId('block'), runs: [] }
      blocks.push(currentBlock)
      currentBlockIndex = line.blockIndex
    }
    for (const word of line.words) {
      const lastRun = currentBlock.runs[currentBlock.runs.length - 1]
      if (lastRun && lastRun.id === word.runId) {
        lastRun.text = word.tightBefore ? `${lastRun.text}${word.text}` : `${lastRun.text} ${word.text}`
      } else {
        currentBlock.runs.push({ id: word.runId, text: word.text, highlight: word.highlight, tightBefore: word.tightBefore })
      }
    }
  }
  return blocks
}

/** Disables the lowest-priority animated runs beyond MAX_ANIMATED_PHRASES_PER_SCENE. */
function capPhrasesPerScene(blocks: TextBlock[]) {
  const animatedRuns = blocks
    .flatMap((b) => b.runs)
    .filter((r) => r.highlight?.animated)
    .sort((a, b) => a.highlight!.priority - b.highlight!.priority)
  animatedRuns.slice(MAX_ANIMATED_PHRASES_PER_SCENE).forEach((r) => {
    r.highlight!.animated = false
  })
}

export interface BuildDocumentOptions {
  mode: OutputMode
  modeIsOverridden: boolean
  entrance?: EntrancePresetId
  transition?: TransitionPresetId
}

interface FitResult {
  fontSize: number
  lines: WrappedLine[]
  contentHeight: number
  truncated: boolean
}

/**
 * Fits the whole text into a single frame.
 *
 * The product rule is that however much text is pasted, the reader sees all of it at once —
 * so there is no pagination and no scene navigation. Two levers get it there, in the order
 * that costs the least legibility: the frame grows taller (up to MAX_FRAME_HEIGHT), and only
 * once that ceiling is reached does the type step down, never below MIN_READABLE_FONT_PX.
 *
 * Text that still doesn't fit at the minimum size is cut at a line boundary and flagged, so
 * the caller can say so — the one thing this must never do is render lines off-frame and
 * pretend the image is complete.
 */
function fitIntoOneFrame(ctx: Ctx2D, blocks: TextBlock[], startFontSize: number, width: number): FitResult {
  for (let fontSize = clampFontSize(startFontSize); ; fontSize -= 1) {
    const metrics = metricsFor(fontSize, width, MAX_FRAME_HEIGHT)
    const wrapped = wrapBlocksIntoLines(ctx, blocks, metrics)
    const measured = positionLines(ctx, wrapped, metrics)

    if (measured.contentHeight <= metrics.contentHeight) {
      return { fontSize, lines: wrapped, contentHeight: measured.contentHeight, truncated: false }
    }
    if (fontSize <= MIN_READABLE_FONT_PX) {
      const fitted: WrappedLine[] = []
      let used = 0
      for (const line of wrapped) {
        const gap = line.isFirstOfParagraph && fitted.length > 0 ? metrics.paragraphGap : 0
        if (used + gap + metrics.lineHeight > metrics.contentHeight) break
        used += gap + metrics.lineHeight
        fitted.push(line)
      }
      return { fontSize, lines: fitted, contentHeight: used, truncated: fitted.length < wrapped.length }
    }
  }
}

/**
 * The core pipeline: raw text -> highlight detection -> paragraph blocks -> word-wrap ->
 * single-frame fit -> block re-synthesis + phrase cap. Always rebuilt from scratch on text
 * change; word-click toggles mutate the resulting document in place instead (see
 * toggleRunAnimation()).
 */
export async function buildAnimatedDocument(rawTextInput: string, options: BuildDocumentOptions): Promise<AnimatedDocument> {
  const rawText = rawTextInput.slice(0, MAX_CHARACTERS)
  const preset = MODE_PRESETS[options.mode]

  const flatRuns = detectHighlights(rawText)
  const paragraphBlocks = splitIntoParagraphBlocks(flatRuns)

  // createMeasurer() awaits font readiness internally — nothing here measures text
  // before the selected font has actually loaded.
  const ctx = await createMeasurer()
  const fit = fitIntoOneFrame(ctx, paragraphBlocks, preset.fontSize, preset.width)

  // The frame is exactly as tall as its content needs, but never shorter than the mode's
  // own proportions — a three-word card shouldn't come out as a letterbox strip.
  const height = Math.max(preset.height, Math.ceil(fit.contentHeight) + PADDING * 2)

  const blocks = synthesizeSceneBlocks(fit.lines)
  capPhrasesPerScene(blocks)

  const scene: Scene = {
    id: nextId('scene'),
    blocks: blocks.length > 0 ? blocks : [{ id: nextId('block'), runs: [] }],
    entrance: options.entrance ?? 'fade',
    transition: options.transition ?? 'crossfade',
  }

  return {
    version: 1,
    rawText,
    mode: options.mode,
    modeIsOverridden: options.modeIsOverridden,
    scenes: [scene],
    truncated: fit.truncated,
    fontSize: fit.fontSize,
    width: preset.width,
    height,
  }
}

/** Re-lays-out a single scene for rendering (no pagination — used by both preview and export). */
export async function layoutSceneForRender(doc: AnimatedDocument, scene: Scene) {
  const metrics = metricsFor(doc.fontSize, doc.width, doc.height)
  const ctx = await createMeasurer()
  const lines = wrapBlocksIntoLines(ctx, scene.blocks, metrics)
  return positionLines(ctx, lines, metrics)
}

/** Toggles a run's animated flag in place — does not re-run highlight detection or pagination, so other toggles/edits aren't lost. */
export function toggleRunAnimation(doc: AnimatedDocument, runId: string): boolean {
  for (const scene of doc.scenes) {
    for (const block of scene.blocks) {
      for (const run of block.runs) {
        if (run.id === runId && run.highlight) {
          run.highlight.animated = !run.highlight.animated
          return run.highlight.animated
        }
      }
    }
  }
  return false
}

/** Finds the id of the block containing a given run, for use with applyEmphasisToWordRange. */
export function findBlockIdForRun(doc: AnimatedDocument, runId: string): string | null {
  for (const scene of doc.scenes) {
    for (const block of scene.blocks) {
      if (block.runs.some((r) => r.id === runId)) return block.id
    }
  }
  return null
}

/**
 * Merges a contiguous, in-order range of runs within one block into a single run carrying
 * the chosen emphasis preset — this is how a user's right-click selection becomes "one
 * animated phrase": LayoutWords sharing a runId share one animatedIndex/stagger group (see
 * layout.ts's positionLines), so merging is what makes the whole selection animate together
 * as a unit instead of each word animating independently.
 *
 * Bypasses the 15%/5-phrase automatic-detection caps deliberately — those exist to keep
 * *automatic* highlight detection restrained, not to second-guess an explicit user choice.
 */
export function applyEmphasisToWordRange(
  doc: AnimatedDocument,
  blockId: string,
  firstRunId: string,
  lastRunId: string,
  preset: EmphasisPresetId,
): boolean {
  for (const scene of doc.scenes) {
    const block = scene.blocks.find((b) => b.id === blockId)
    if (!block) continue
    const startIdx = block.runs.findIndex((r) => r.id === firstRunId)
    const endIdx = block.runs.findIndex((r) => r.id === lastRunId)
    if (startIdx < 0 || endIdx < 0) continue
    const lo = Math.min(startIdx, endIdx)
    const hi = Math.max(startIdx, endIdx)
    const covered = block.runs.slice(lo, hi + 1)
    // Join respecting each run's source-level spacing, so merging a selection that ends on
    // punctuation ("three major updates.") doesn't reintroduce the space before the period.
    const text = covered.reduce((acc, r, i) => (i === 0 ? r.text : r.tightBefore ? `${acc}${r.text}` : `${acc} ${r.text}`), '')
    const priority = Math.min(...covered.map((r) => r.highlight?.priority ?? 8))
    const merged: TextRun = {
      id: nextId('run'),
      text,
      highlight: { kind: 'content-word', priority, animated: true, emphasisPreset: preset },
      tightBefore: covered[0].tightBefore,
    }
    block.runs.splice(lo, hi - lo + 1, merged)
    return true
  }
  return false
}
