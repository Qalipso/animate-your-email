import { easeOutBack, easeOutCubic } from './easing'
import { FONT_FAMILY, PADDING, type Ctx2D } from './layout'
import type { AnimatedDocument, EntrancePresetId, LayoutWord, TextLayout } from './model'

const ENTRANCE_BASE_MS = 550
const WORD_CASCADE_STAGGER_MS = 35
const WORD_CASCADE_MAX_MS = 1400
const EMPHASIS_DURATION_MS = 550
const EMPHASIS_STAGGER_MS = 180
const HOLD_AFTER_MS = 900

export interface SceneTiming {
  entranceMs: number
  emphasisStartMs: number
  emphasisEndMs: number
  totalMs: number
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

export function computeSceneTiming(layout: TextLayout, entrance: EntrancePresetId): SceneTiming {
  const entranceMs =
    entrance === 'word-cascade'
      ? Math.min(WORD_CASCADE_MAX_MS, ENTRANCE_BASE_MS + layout.totalWordCount * WORD_CASCADE_STAGGER_MS)
      : ENTRANCE_BASE_MS
  const phraseCount = new Set(
    layout.lines.flatMap((l) => l.words).filter((w) => w.highlight?.animated).map((w) => w.runId),
  ).size
  const emphasisSpan = phraseCount > 0 ? (phraseCount - 1) * EMPHASIS_STAGGER_MS + EMPHASIS_DURATION_MS : 0
  return {
    entranceMs,
    emphasisStartMs: entranceMs,
    emphasisEndMs: entranceMs + emphasisSpan,
    totalMs: entranceMs + emphasisSpan + HOLD_AFTER_MS,
  }
}

interface WordEntranceState {
  opacity: number
  translateY: number
  blurPx: number
}

function entranceStateFor(entrance: EntrancePresetId, progress: number): WordEntranceState {
  const eased = easeOutCubic(progress)
  switch (entrance) {
    case 'fade':
      return { opacity: eased, translateY: 0, blurPx: 0 }
    case 'soft-rise':
      return { opacity: eased, translateY: (1 - eased) * 18, blurPx: 0 }
    case 'blur-reveal':
      return { opacity: eased, translateY: 0, blurPx: (1 - eased) * 10 }
    case 'word-cascade':
      return { opacity: eased, translateY: (1 - eased) * 10, blurPx: 0 }
  }
}

function drawWordBase(ctx: Ctx2D, word: LayoutWord, ox: number, oy: number, state: WordEntranceState, fontSize: number) {
  ctx.save()
  ctx.globalAlpha = state.opacity
  ctx.filter = state.blurPx > 0.1 ? `blur(${state.blurPx}px)` : 'none'
  ctx.fillStyle = '#1a1a1a'
  ctx.font = `${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(word.text, ox + word.x, oy + word.y + fontSize * 0.78)
  ctx.restore()
}

function drawEmphasisWord(
  ctx: Ctx2D,
  word: LayoutWord,
  ox: number,
  oy: number,
  entranceState: WordEntranceState,
  emphasisProgress: number,
  fontSize: number,
) {
  const preset = word.highlight!.emphasisPreset
  const x = ox + word.x
  const yBaseline = oy + word.y + fontSize * 0.78
  const eased = easeOutCubic(emphasisProgress)

  ctx.save()
  ctx.globalAlpha = entranceState.opacity
  ctx.filter = entranceState.blurPx > 0.1 ? `blur(${entranceState.blurPx}px)` : 'none'

  if (preset === 'marker-highlight') {
    const w = word.width * eased
    ctx.fillStyle = 'rgba(255, 214, 79, 0.55)'
    ctx.fillRect(x - 2, oy + word.y + fontSize * 0.12, w + 4, fontSize * 0.86)
  }
  if (preset === 'underline-draw') {
    ctx.strokeStyle = '#2b6cff'
    ctx.lineWidth = Math.max(2, fontSize * 0.06)
    ctx.beginPath()
    ctx.moveTo(x, yBaseline + 4)
    ctx.lineTo(x + word.width * eased, yBaseline + 4)
    ctx.stroke()
  }
  if (preset === 'soft-glow') {
    ctx.shadowColor = 'rgba(43, 108, 255, 0.85)'
    ctx.shadowBlur = 14 * Math.sin(eased * Math.PI)
  }

  let scale = 1
  let scaleX = 1
  let fontWeight = ''
  if (preset === 'gentle-pop') {
    // Words in the same animated phrase (the common case — "great work", "crushed it")
    // are laid out with normal-weight spacing, so scaling too far makes glyphs collide
    // into the next word. Cap growth against the font's own measured space width rather
    // than a guessed constant, so it self-corrects for any word length or loaded font.
    const bounceEase = easeOutBack(emphasisProgress)
    const desiredScale = 1 + 0.16 * Math.sin(Math.min(1, bounceEase) * Math.PI)
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    const spaceWidth = ctx.measureText(' ').width
    const maxGrowthPerSide = spaceWidth * 0.4
    const maxScale = word.width > 0 ? 1 + (2 * maxGrowthPerSide) / word.width : desiredScale
    scale = Math.min(desiredScale, maxScale)
  }
  if (preset === 'weight-shift') {
    fontWeight = emphasisProgress < 0.55 ? '700 ' : ''
  }

  ctx.fillStyle = '#1a1a1a'
  ctx.font = `${fontWeight}${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'alphabetic'

  if (fontWeight) {
    // Bold measures wider than the normal-weight width the layout reserved for this word.
    // Compress horizontally to fit back inside that slot so it can't collide with the next
    // word — measured live so it holds regardless of font metrics or word length.
    const boldWidth = ctx.measureText(word.text).width
    if (boldWidth > word.width && boldWidth > 0) {
      scaleX = word.width / boldWidth
    }
  }

  if (scale !== 1 || scaleX !== 1) {
    const cx = x + word.width / 2
    const cy = yBaseline - fontSize * 0.35
    ctx.translate(cx, cy)
    ctx.scale(scale * scaleX, scale)
    ctx.translate(-cx, -cy)
  }
  ctx.fillText(word.text, x, yBaseline)

  if (preset === 'shimmer' && emphasisProgress < 1) {
    const sweepX = x - word.width * 0.4 + word.width * 1.8 * emphasisProgress
    const grad = ctx.createLinearGradient(sweepX - 14, 0, sweepX + 14, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, 'rgba(255,255,255,0.75)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.save()
    ctx.globalCompositeOperation = 'source-atop'
    ctx.fillStyle = grad
    ctx.fillRect(x - 4, oy + word.y, word.width + 8, fontSize * 1.1)
    ctx.restore()
  }

  ctx.restore()
}

/** Renders one scene at time tMs onto ctx at (offsetX, offsetY). Pure function — the only rendering codepath, used by both the live preview canvas and OffscreenCanvas export. */
export function renderScene(
  ctx: Ctx2D,
  doc: AnimatedDocument,
  layout: TextLayout,
  entrance: EntrancePresetId,
  tMs: number,
  timing: SceneTiming,
  offsetX = 0,
  offsetY = 0,
) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(offsetX, offsetY, doc.width, doc.height)

  const ox = offsetX + PADDING
  const oy = offsetY + PADDING
  const words = layout.lines.flatMap((l) => l.words)
  const wordCount = layout.totalWordCount

  words.forEach((word, i) => {
    const entranceProgress =
      entrance === 'word-cascade'
        ? clamp01((tMs - (i / Math.max(1, wordCount - 1)) * (timing.entranceMs * 0.6)) / (timing.entranceMs * 0.4))
        : clamp01(tMs / timing.entranceMs)
    const state = entranceStateFor(entrance, entranceProgress)

    if (!word.highlight?.animated) {
      drawWordBase(ctx, word, ox, oy, state, doc.fontSize)
      return
    }

    const phraseStart = timing.emphasisStartMs + word.animatedIndex * EMPHASIS_STAGGER_MS
    const emphasisProgress = clamp01((tMs - phraseStart) / EMPHASIS_DURATION_MS)
    drawEmphasisWord(ctx, word, ox, oy, state, emphasisProgress, doc.fontSize)
  })

  ctx.restore()
}
