import { detectHighlights } from './highlight'
import { clampFontSize, createMeasurer, metricsFor, wrapBlocksIntoLines, positionLines, type WrappedLine } from './layout'
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
import { MAX_ANIMATED_PHRASES_PER_SCENE, MAX_CHARACTERS, MAX_SCENES } from './model'

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
        lastRun.text = `${lastRun.text} ${word.text}`
      } else {
        currentBlock.runs.push({ id: word.runId, text: word.text, highlight: word.highlight })
      }
    }
  }
  return blocks
}

/** Disables the lowest-priority animated runs in a scene beyond MAX_ANIMATED_PHRASES_PER_SCENE. */
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

/**
 * The core "prove the foundation" pipeline: raw text -> highlight detection -> paragraph
 * blocks -> global word-wrap -> pagination into <= MAX_SCENES scenes by height budget ->
 * per-scene block re-synthesis + phrase cap. Always rebuilt from scratch on text change;
 * word-click toggles mutate the resulting document in place instead (see toggleWord()).
 */
export async function buildAnimatedDocument(rawTextInput: string, options: BuildDocumentOptions): Promise<AnimatedDocument> {
  const rawText = rawTextInput.slice(0, MAX_CHARACTERS)
  const preset = MODE_PRESETS[options.mode]
  // Font size is fixed per mode (never auto-shrunk to force a fit) — clamped defensively
  // to MIN_READABLE_FONT_PX so a future mode/config change can't silently produce
  // unreadable text; overflow is handled by pagination instead, not by shrinking.
  const fontSize = clampFontSize(preset.fontSize)
  const metrics = metricsFor(fontSize, preset.width, preset.height)

  const flatRuns = detectHighlights(rawText)
  const paragraphBlocks = splitIntoParagraphBlocks(flatRuns)

  // createMeasurer() awaits font readiness internally — nothing here measures text
  // before the selected font has actually loaded.
  const ctx = await createMeasurer()
  const allLines = wrapBlocksIntoLines(ctx, paragraphBlocks, metrics)

  const sceneLineGroups: WrappedLine[][] = [[]]
  let usedHeight = 0
  let truncated = false

  for (const line of allLines) {
    const gap = line.isFirstOfParagraph && sceneLineGroups[sceneLineGroups.length - 1].length > 0 ? metrics.paragraphGap : 0
    const needed = usedHeight + gap + metrics.lineHeight
    const currentGroup = sceneLineGroups[sceneLineGroups.length - 1]
    if (needed > metrics.contentHeight && currentGroup.length > 0) {
      if (sceneLineGroups.length >= MAX_SCENES) {
        truncated = true
        break
      }
      sceneLineGroups.push([])
      usedHeight = 0
    }
    sceneLineGroups[sceneLineGroups.length - 1].push(line)
    usedHeight += (sceneLineGroups[sceneLineGroups.length - 1].length > 1 ? gap : 0) + metrics.lineHeight
  }

  const entrance = options.entrance ?? 'fade'
  const transition = options.transition ?? 'crossfade'

  const scenes: Scene[] = sceneLineGroups
    .filter((group) => group.length > 0)
    .map((group) => {
      const blocks = synthesizeSceneBlocks(group)
      capPhrasesPerScene(blocks)
      return { id: nextId('scene'), blocks, entrance, transition }
    })

  if (scenes.length === 0) {
    scenes.push({ id: nextId('scene'), blocks: [{ id: nextId('block'), runs: [] }], entrance, transition })
  }

  return {
    version: 1,
    rawText,
    mode: options.mode,
    modeIsOverridden: options.modeIsOverridden,
    scenes,
    truncated,
    fontSize,
    width: preset.width,
    height: preset.height,
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
    const text = covered.map((r) => r.text).join(' ')
    const priority = Math.min(...covered.map((r) => r.highlight?.priority ?? 8))
    const merged: TextRun = {
      id: nextId('run'),
      text,
      highlight: { kind: 'content-word', priority, animated: true, emphasisPreset: preset },
    }
    block.runs.splice(lo, hi - lo + 1, merged)
    return true
  }
  return false
}
