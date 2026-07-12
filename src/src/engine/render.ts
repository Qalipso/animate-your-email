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

// Deterministic per-word "randomness" (FNV-1a hash -> [0,1)) so particle/jitter effects are
// pure functions of (word, frame time) — required for preview/export to render identically,
// and for a paused/re-rendered frame to always look the same. Never use Math.random() here.
function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

function makeScratchCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
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
  const seed = hashSeed(`${word.runId}:${word.text}`)

  ctx.save()
  ctx.globalAlpha = entranceState.opacity
  ctx.filter = entranceState.blurPx > 0.1 ? `blur(${entranceState.blurPx}px)` : 'none'

  if (preset === 'marker-highlight') {
    const w = word.width * eased
    ctx.fillStyle = 'rgba(255, 214, 79, 0.55)'
    ctx.fillRect(x - 2, oy + word.y + fontSize * 0.12, w + 4, fontSize * 0.86)
  }
  if (preset === 'bow-highlight') {
    const w = word.width * eased
    ctx.fillStyle = 'rgba(255, 133, 178, 0.42)'
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
  if (preset === 'burn') {
    // Flicker ramps in with `eased`, then settles into a steady ember glow — the char
    // itself stays "burnt" (color shift persists) rather than reverting, since that's
    // the whole point of the effect.
    const flicker = 0.5 + 0.5 * Math.sin(emphasisProgress * 40 + seed * 10)
    ctx.shadowColor = `rgba(255, ${Math.round(90 + 40 * flicker)}, 20, 0.85)`
    ctx.shadowBlur = 10 * eased * (0.7 + 0.3 * flicker)
  }
  const washMeltAmount = preset === 'wash-away' ? Math.sin(emphasisProgress * Math.PI) : 0
  if (preset === 'wash-away' && washMeltAmount > 0.02) {
    // Transient ink-drip streaks peaking mid-emphasis, gone by rest — capped short so a
    // drip never reaches the next line's cap-height. Each streak fades out along its own
    // length via a gradient so it reads as dripping ink, not a flat bar.
    ctx.save()
    ctx.globalAlpha = entranceState.opacity
    for (let k = 0; k < 4; k++) {
      const ds = hashSeed(`${word.runId}:drip:${k}`)
      const dx = x + ds * word.width
      const dripLen = washMeltAmount * fontSize * (0.2 + ds * 0.3)
      const dripW = Math.max(2, fontSize * 0.09)
      const grad = ctx.createLinearGradient(0, yBaseline + 2, 0, yBaseline + 2 + dripLen)
      grad.addColorStop(0, `rgba(58, 90, 122, ${0.75 * washMeltAmount})`)
      grad.addColorStop(1, 'rgba(58, 90, 122, 0)')
      ctx.fillStyle = grad
      ctx.fillRect(dx, yBaseline + 2, dripW, dripLen)
    }
    ctx.restore()
  }

  let scale = 1
  let scaleX = 1
  let translateX = 0
  let translateY = 0
  let fontWeight = ''
  let textColor = '#1a1a1a'
  let skipNormalFill = false

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
  if (preset === 'burn') {
    const r = Math.round(26 + eased * (196 - 26))
    const g = Math.round(26 + eased * (62 - 26))
    const b = Math.round(26 + eased * (20 - 26))
    textColor = `rgb(${r},${g},${b})`
  }
  if (preset === 'wash-away' && washMeltAmount > 0.02) {
    // The glyph itself washes toward a pale ink-blue at peak melt so the effect reads on
    // the text, not just the drip streaks — fully back to solid black by rest.
    const r = Math.round(26 + washMeltAmount * (120 - 26))
    const g = Math.round(26 + washMeltAmount * (150 - 26))
    const b = Math.round(26 + washMeltAmount * (175 - 26))
    textColor = `rgba(${r},${g},${b},${1 - washMeltAmount * 0.35})`
  }
  if (preset === 'assemble-blur') {
    // Converges from a per-word deterministic direction/distance to its exact laid-out
    // position as `eased` -> 1, so the final frame always lands pixel-perfect. The flight
    // is transient and can briefly cross a neighbor mid-flight — that read as a real
    // "assembling" motion is the point; it's back in its own slot well before rest.
    const dirAngle = seed * Math.PI * 2
    const dist = (1 - eased) * fontSize * 0.9
    translateX = Math.cos(dirAngle) * dist
    translateY = Math.sin(dirAngle) * dist * 0.5
    const blurPx = (1 - eased) * 8
    ctx.filter = blurPx > 0.1 ? `blur(${blurPx}px)` : 'none'
  }

  ctx.fillStyle = textColor
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

  if (preset === 'pixelate') {
    skipNormalFill = true
    const blockSize = eased >= 0.97 ? 1 : Math.max(1, Math.round((1 - eased) * 8))
    if (blockSize <= 1) {
      ctx.fillText(word.text, x, yBaseline)
    } else {
      const w = Math.max(1, Math.ceil(word.width))
      const h = Math.max(1, Math.ceil(fontSize * 1.3))
      const scratch = makeScratchCanvas(w, h)
      const sctx = scratch.getContext('2d') as Ctx2D
      sctx.fillStyle = textColor
      sctx.font = `${fontSize}px ${FONT_FAMILY}`
      sctx.textBaseline = 'alphabetic'
      sctx.fillText(word.text, 0, fontSize * 0.78)
      const smallW = Math.max(1, Math.round(w / blockSize))
      const smallH = Math.max(1, Math.round(h / blockSize))
      const tiny = makeScratchCanvas(smallW, smallH)
      const tctx = tiny.getContext('2d') as Ctx2D
      tctx.drawImage(scratch as CanvasImageSource, 0, 0, w, h, 0, 0, smallW, smallH)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(tiny as CanvasImageSource, 0, 0, smallW, smallH, x, oy + word.y, w, h)
      ctx.imageSmoothingEnabled = true
    }
  }

  if (preset === 'glitch') {
    skipNormalFill = true
    const intensity = 1 - eased
    if (intensity < 0.03) {
      ctx.fillText(word.text, x, yBaseline)
    } else {
      const mag = 3 * intensity
      const step = Math.floor(emphasisProgress * 20)
      const jitter = (tag: string, m: number) => (hashSeed(`${word.runId}:${word.text}:${tag}:${step}`) - 0.5) * 2 * m
      ctx.save()
      // Plain alpha blending, not a 'lighten'/'screen' composite mode — those resolve to
      // white against this white background, silently hiding the red/cyan layers entirely.
      ctx.fillStyle = 'rgba(255,60,60,0.85)'
      ctx.fillText(word.text, x + jitter('r', mag), yBaseline)
      ctx.fillStyle = 'rgba(60,220,255,0.85)'
      ctx.fillText(word.text, x + jitter('b', mag), yBaseline)
      ctx.restore()
      ctx.fillStyle = textColor
      ctx.fillText(word.text, x + jitter('k', mag * 0.4), yBaseline)
    }
  }

  if (!skipNormalFill) {
    if (scale !== 1 || scaleX !== 1 || translateX !== 0 || translateY !== 0) {
      const cx = x + word.width / 2
      const cy = yBaseline - fontSize * 0.35
      ctx.translate(cx + translateX, cy + translateY)
      ctx.scale(scale * scaleX, scale)
      ctx.translate(-cx, -cy)
    }
    ctx.fillText(word.text, x, yBaseline)
  }

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

  if (preset === 'burn' && emphasisProgress < 1) {
    // Rising embers sell the "catching fire" motion; they're a transient cue, not a
    // persistent decoration, so they fade out once the char has settled into its burnt color.
    for (let k = 0; k < 3; k++) {
      const es = hashSeed(`${word.runId}:ember:${k}`)
      const ex = x + es * word.width
      const rise = emphasisProgress * fontSize * (0.6 + es * 0.4)
      const ey = oy + word.y - rise
      const ealpha = (1 - emphasisProgress) * 0.8
      ctx.fillStyle = `rgba(255, ${140 + Math.round(es * 80)}, 40, ${ealpha})`
      ctx.beginPath()
      ctx.arc(ex, ey, 1.5 + es, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (preset === 'bow-highlight' && eased > 0.3) {
    // Kept small and anchored within this word's own line-box headroom (never above the
    // previous line's descender zone) so it can't collide vertically with the line above.
    const bowAlpha = clamp01((eased - 0.3) / 0.3)
    const bx = x + word.width
    const by = oy + word.y + fontSize * 0.06
    const s = Math.min(6, fontSize * 0.22)
    ctx.save()
    ctx.globalAlpha = entranceState.opacity * bowAlpha
    ctx.fillStyle = '#ff5da2'
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx - s, by - s * 0.6)
    ctx.lineTo(bx - s, by + s * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + s, by - s * 0.6)
    ctx.lineTo(bx + s, by + s * 0.6)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = '#d6316f'
    ctx.beginPath()
    ctx.arc(bx, by, s * 0.28, 0, Math.PI * 2)
    ctx.fill()
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
