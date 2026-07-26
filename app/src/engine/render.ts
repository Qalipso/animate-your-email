import { easeOutBack, easeOutCubic } from './easing'
import { materialFor, paintAxis, type Paint, type PaintBox } from './materials'
import { seededRandom, sketchEllipse, sketchLine, sketchRect, sketchWavePaths } from './sketch'
import { FONT_FAMILY, PADDING, type Ctx2D } from './layout'
import { DEFAULT_HOLD_MS } from './model'
import type { AnimatedDocument, EmphasisPresetId, LayoutWord, TextLayout } from './model'

// Lead-in hold before the first emphasis fires. The base text is fully readable from
// frame 1 (see the layering note below), so this is purely "let the reader land on the
// sentence", not a reveal — 500ms is enough for that. It used to be 1200ms, which made
// every export start with over a second of a completely static image.
const LEAD_IN_MS = 500
const EMPHASIS_DURATION_MS = 900
// Animated phrases play strictly one after another, never overlapping — each phrase's
// start is the previous phrase's end, so "in order" isn't just visual (reading order via
// animatedIndex) but also temporal.
const EMPHASIS_STAGGER_MS = EMPHASIS_DURATION_MS

const TEXT_COLOR = '#1a1a1a'

/** Ink colours for the hand-drawn annotation family. */
const INK_MARKER = 'rgba(255, 214, 79, 0.62)'
const INK_BOW = 'rgba(255, 133, 178, 0.45)'
const INK_BLUE = '#2b6cff'
const INK_RED = '#e0463a'

export interface SceneTiming {
  entranceMs: number
  emphasisStartMs: number
  emphasisEndMs: number
  totalMs: number
  /** Speed-scaled per-phrase values, so nothing downstream has to re-apply the tempo. */
  phraseDurationMs: number
  phraseStaggerMs: number
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/**
 * Where the text block starts vertically inside the frame. The frame is never shorter than
 * the mode's own proportions, so short text leaves spare height; centring it keeps a
 * three-word card looking like a card instead of a line stranded against the top edge.
 *
 * Exported because the editor's hit-testing and selection overlay have to use exactly the
 * same offset the renderer does, or clicking a word lands on the wrong one.
 */
export function contentOffsetY(doc: AnimatedDocument, layout: TextLayout): number {
  const spare = Math.max(0, doc.height - PADDING * 2 - layout.contentHeight)
  return PADDING + spare / 2
}

export interface TimingOptions {
  /** Tempo multiplier; 2 halves every duration. */
  speed?: number
  /** Hold on the settled frame before the loop restarts, in ms at speed 1. */
  holdMs?: number
}

/**
 * Scene timing. `speed` scales the lead-in, each phrase, and the hold together, so the
 * animation keeps its proportions at any tempo rather than only the emphasis getting faster.
 * Callers pass the document's own values so preview and export can never disagree.
 */
export function computeSceneTiming(layout: TextLayout, options: TimingOptions = {}): SceneTiming {
  const speed = options.speed && options.speed > 0 ? options.speed : 1
  const hold = Math.max(0, options.holdMs ?? DEFAULT_HOLD_MS)

  const phraseCount = new Set(
    layout.lines.flatMap((l) => l.words).filter((w) => w.highlight?.animated).map((w) => w.runId),
  ).size
  const leadIn = LEAD_IN_MS / speed
  const emphasisSpan =
    phraseCount > 0 ? ((phraseCount - 1) * EMPHASIS_STAGGER_MS + EMPHASIS_DURATION_MS) / speed : 0
  return {
    entranceMs: leadIn,
    emphasisStartMs: leadIn,
    emphasisEndMs: leadIn + emphasisSpan,
    totalMs: leadIn + emphasisSpan + hold / speed,
    phraseDurationMs: EMPHASIS_DURATION_MS / speed,
    phraseStaggerMs: EMPHASIS_STAGGER_MS / speed,
  }
}

/** Timing derived straight from a document — the form both the preview and the worker use. */
export function sceneTimingFor(doc: AnimatedDocument, layout: TextLayout): SceneTiming {
  return computeSceneTiming(layout, { speed: doc.speed, holdMs: doc.holdMs })
}

// ---------------------------------------------------------------------------
// Phrases
//
// An animated phrase ("three major updates") is one runId spanning several LayoutWords,
// possibly across a line break. Effects that sweep — marker highlight, underline draw,
// shimmer — must treat it as ONE continuous span, otherwise each word restarts its own
// sweep from zero and the phrase renders as disconnected stripes with unpainted gaps
// where the word spaces are. So sweeps are computed per phrase here, not per word.
// ---------------------------------------------------------------------------

export interface PhraseSegment {
  /** Line-box top, in layout coordinates. */
  y: number
  x0: number
  x1: number
  /** Width of this phrase's earlier segments, so the sweep continues across a line break. */
  offset: number
}

export interface Phrase {
  runId: string
  animatedIndex: number
  preset: EmphasisPresetId
  segments: PhraseSegment[]
  totalWidth: number
  /** Last word in reading order — where end-of-phrase ornaments (the bow) are anchored. */
  lastWord: LayoutWord
}

export function buildPhrases(layout: TextLayout): Phrase[] {
  const byRunId = new Map<string, Phrase>()
  for (const line of layout.lines) {
    let segment: { phrase: Phrase; seg: PhraseSegment } | null = null
    for (const word of line.words) {
      if (!word.highlight?.animated) {
        segment = null
        continue
      }
      if (segment && segment.phrase.runId === word.runId) {
        segment.seg.x1 = word.x + word.width
        segment.phrase.lastWord = word
        continue
      }
      let phrase = byRunId.get(word.runId)
      if (!phrase) {
        phrase = {
          runId: word.runId,
          animatedIndex: word.animatedIndex,
          preset: word.highlight.emphasisPreset,
          segments: [],
          totalWidth: 0,
          lastWord: word,
        }
        byRunId.set(word.runId, phrase)
      }
      const seg: PhraseSegment = { y: line.y, x0: word.x, x1: word.x + word.width, offset: 0 }
      phrase.segments.push(seg)
      phrase.lastWord = word
      segment = { phrase, seg }
    }
  }
  for (const phrase of byRunId.values()) {
    let offset = 0
    for (const seg of phrase.segments) {
      seg.offset = offset
      offset += seg.x1 - seg.x0
    }
    phrase.totalWidth = offset
  }
  return [...byRunId.values()]
}

function phraseProgress(phrase: Phrase, tMs: number, timing: SceneTiming): number {
  const start = timing.emphasisStartMs + phrase.animatedIndex * timing.phraseStaggerMs
  return clamp01((tMs - start) / timing.phraseDurationMs)
}

/**
 * The box a phrase's material is painted over — the union of its segments, so a phrase that
 * wraps still gets one continuous ink gradient rather than restarting on the second line.
 * Computed identically by the SVG exporter; if the two ever diverge, the SVG-versus-raster
 * agreement test fails, which is the point.
 */
export function phrasePaintBox(phrase: Phrase, ox: number, oy: number, fontSize: number): PaintBox {
  const x0 = ox + Math.min(...phrase.segments.map((s) => s.x0))
  const x1 = ox + Math.max(...phrase.segments.map((s) => s.x1))
  const y0 = oy + phrase.segments[0].y
  return { x0, y0, x1, y1: y0 + fontSize }
}

/** Resolves a backend-neutral material into something canvas can stroke with. */
function resolvePaint(ctx: Ctx2D, paint: Paint, box: PaintBox): string | CanvasGradient {
  if (paint.kind === 'solid') return paint.colour
  const a = paintAxis(paint, box)
  const gradient = ctx.createLinearGradient(a.x1, a.y1, a.x2, a.y2)
  for (const stop of paint.stops) gradient.addColorStop(stop.at, stop.colour)
  return gradient
}

/** Calls `draw` for the portion of each segment covered by a left-to-right sweep at `progress`. */
export function forEachSweptSegment(
  phrase: Phrase,
  progress: number,
  draw: (seg: PhraseSegment, sweptTo: number) => void,
) {
  const swept = phrase.totalWidth * progress
  for (const seg of phrase.segments) {
    const local = swept - seg.offset
    if (local <= 0) return
    draw(seg, seg.x0 + Math.min(local, seg.x1 - seg.x0))
  }
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

// ---------------------------------------------------------------------------
// Layer 1 — underlays drawn BEHIND every glyph in the scene.
//
// Drawing a highlight rect immediately before its own word (the old approach) meant word
// N+1's rect painted over word N's glyph tail. Separating the passes makes the highlight
// unambiguously a background, which is what a marker pen actually looks like.
// ---------------------------------------------------------------------------

/**
 * A marker stroke, not a rectangle: a thick round-capped line laid down along the phrase, with
 * the slight bow and double-pass of a real highlighter. The old flat `fillRect` was the single
 * most machine-looking thing on screen.
 */
function drawMarkerStroke(
  ctx: Ctx2D,
  phrase: Phrase,
  ox: number,
  oy: number,
  eased: number,
  fontSize: number,
  fallbackColour: string,
) {
  const rand = seededRandom(`${phrase.runId}:marker`)
  ctx.save()
  ctx.strokeStyle = resolvePaint(
    ctx,
    materialFor(phrase.preset, fallbackColour),
    phrasePaintBox(phrase, ox, oy, fontSize),
  )
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = fontSize * 0.82
  forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
    const y = oy + seg.y + fontSize * 0.53
    sketchLine(ctx, ox + seg.x0 - 1, y, ox + sweptTo + 1, y, 1, rand, {
      roughness: fontSize * 0.045,
      passes: 2,
    })
  })
  // A second, narrower pass inside the first. A highlighter run over paper is never one flat
  // band — the tip deposits more ink along its centre line, and that density difference is
  // most of what separates "highlighted" from "a coloured rectangle".
  ctx.lineWidth = fontSize * 0.46
  const coreRand = seededRandom(`${phrase.runId}:marker:core`)
  forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
    const y = oy + seg.y + fontSize * 0.5
    sketchLine(ctx, ox + seg.x0 + 1, y, ox + sweptTo - 1, y, 1, coreRand, {
      roughness: fontSize * 0.06,
      passes: 1,
    })
  })
  ctx.restore()
}

function drawPhraseUnderlay(ctx: Ctx2D, phrase: Phrase, ox: number, oy: number, progress: number, fontSize: number) {
  const eased = easeOutCubic(progress)
  if (phrase.preset === 'marker-highlight') drawMarkerStroke(ctx, phrase, ox, oy, eased, fontSize, INK_MARKER)
  if (phrase.preset === 'bow-highlight') drawMarkerStroke(ctx, phrase, ox, oy, eased, fontSize, INK_BOW)
}

// ---------------------------------------------------------------------------
// Layer 2 — the glyphs themselves.
// ---------------------------------------------------------------------------

function drawWordBase(ctx: Ctx2D, word: LayoutWord, ox: number, oy: number, fontSize: number) {
  ctx.save()
  ctx.fillStyle = TEXT_COLOR
  ctx.font = `${fontSize}px ${FONT_FAMILY}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(word.text, ox + word.x, oy + word.y + fontSize * 0.78)
  ctx.restore()
}

/**
 * Per-glyph emphasis: everything that transforms or recolours the word itself. Phrase-wide
 * sweeps and ornaments are NOT handled here — see drawPhraseUnderlay/drawPhraseOverlay.
 */
function drawEmphasisWord(
  ctx: Ctx2D,
  word: LayoutWord,
  ox: number,
  oy: number,
  emphasisProgress: number,
  fontSize: number,
  pixelScale: number,
) {
  const preset = word.highlight!.emphasisPreset
  const x = ox + word.x
  const yBaseline = oy + word.y + fontSize * 0.78
  const eased = easeOutCubic(emphasisProgress)
  const seed = hashSeed(`${word.runId}:${word.text}`)

  ctx.save()

  if (preset === 'soft-glow') {
    // Two layers: a wide dim halo and a tight bright core. A single blur reads as a smudge;
    // the falloff between two radii is what makes it read as light.
    const pulse = Math.sin(eased * Math.PI)
    ctx.save()
    ctx.shadowColor = 'rgba(43, 108, 255, 0.45)'
    // shadowBlur is specified in device pixels and is NOT scaled by the canvas transform,
    // so a supersampled export would otherwise render a glow at half its intended radius.
    ctx.shadowBlur = 26 * pulse * pixelScale
    ctx.fillStyle = TEXT_COLOR
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(word.text, x, yBaseline)
    ctx.restore()
    ctx.shadowColor = 'rgba(43, 108, 255, 0.9)'
    ctx.shadowBlur = 11 * pulse * pixelScale
  }
  if (preset === 'burn') {
    // Flicker ramps in with `eased`, then settles into a steady ember glow — the char
    // itself stays "burnt" (color shift persists) rather than reverting, since that's
    // the whole point of the effect.
    const flicker = 0.5 + 0.5 * Math.sin(emphasisProgress * 40 + seed * 10)
    ctx.shadowColor = `rgba(255, ${Math.round(90 + 40 * flicker)}, 20, 0.85)`
    ctx.shadowBlur = 10 * eased * (0.7 + 0.3 * flicker) * pixelScale
  }
  const washMeltAmount = preset === 'wash-away' ? Math.sin(emphasisProgress * Math.PI) : 0
  if (preset === 'wash-away' && washMeltAmount > 0.02) {
    // Transient ink-drip streaks peaking mid-emphasis, gone by rest — capped short so a
    // drip never reaches the next line's cap-height. Each streak fades out along its own
    // length via a gradient so it reads as dripping ink, not a flat bar.
    ctx.save()
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
  let rotate = 0
  let fontWeight = ''
  let textColor = TEXT_COLOR
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
    // A degree or so of tilt, direction fixed per word. Pure scaling reads mechanical; the
    // slight rotation is what makes it look like something moved rather than resized.
    rotate = (seed - 0.5) * 0.05 * Math.sin(Math.min(1, bounceEase) * Math.PI)
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
    if (scale !== 1 || scaleX !== 1 || rotate !== 0) {
      const cx = x + word.width / 2
      const cy = yBaseline - fontSize * 0.35
      ctx.translate(cx, cy)
      if (rotate !== 0) ctx.rotate(rotate)
      ctx.scale(scale * scaleX, scale)
      ctx.translate(-cx, -cy)
    }
    ctx.fillText(word.text, x, yBaseline)
  }

  ctx.restore()
}

// ---------------------------------------------------------------------------
// Layer 3 — overlays drawn ON TOP of every glyph, once per phrase.
// ---------------------------------------------------------------------------

function drawPhraseOverlay(ctx: Ctx2D, phrase: Phrase, ox: number, oy: number, progress: number, fontSize: number) {
  const preset = phrase.preset
  ctx.save()

  const eased = easeOutCubic(progress)
  const rand = seededRandom(`${phrase.runId}:${preset}`)
  const stroke = Math.max(2, fontSize * 0.055)
  const roughness = fontSize * 0.05
  const box = phrasePaintBox(phrase, ox, oy, fontSize)
  const ink = (fallback: string) => resolvePaint(ctx, materialFor(preset, fallback), box)

  if (preset === 'underline-draw') {
    // Two passes that don't quite agree, the way an underline drawn by hand doubles back.
    ctx.strokeStyle = ink(INK_BLUE)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
      const y = oy + seg.y + fontSize * 0.78 + fontSize * 0.14
      sketchLine(ctx, ox + seg.x0, y, ox + sweptTo, y, 1, rand, { roughness, passes: 2 })
    })
    // The hand comes back over the line: a thinner, slightly lower repeat that only covers the
    // middle of the span, which is where a real second pass lands.
    ctx.save()
    ctx.lineWidth = stroke * 0.55
    ctx.globalAlpha = 0.55
    const backRand = seededRandom(`${phrase.runId}:underline:back`)
    forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
      const y = oy + seg.y + fontSize * 0.78 + fontSize * 0.2
      const inset = (sweptTo - seg.x0) * 0.12
      sketchLine(ctx, ox + seg.x0 + inset, y, ox + sweptTo - inset, y, 1, backRand, {
        roughness: roughness * 1.3,
        passes: 1,
      })
    })
    ctx.restore()
  }

  if (preset === 'strike-through') {
    ctx.strokeStyle = ink(INK_RED)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
      const y = oy + seg.y + fontSize * 0.52
      sketchLine(ctx, ox + seg.x0, y, ox + sweptTo, y, 1, rand, { roughness, passes: 2 })
    })
  }

  if (preset === 'circle-annotation') {
    // One loop per line the phrase occupies; a single ellipse round a phrase that wrapped
    // would swallow the lines in between.
    ctx.strokeStyle = ink(INK_RED)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    for (const seg of phrase.segments) {
      const w = seg.x1 - seg.x0
      const cx = ox + seg.x0 + w / 2
      const cy = oy + seg.y + fontSize * 0.5
      sketchEllipse(ctx, cx, cy, w / 2 + fontSize * 0.28, fontSize * 0.66, eased, rand, {
        roughness: roughness * 1.4,
        passes: 2,
      })
    }
  }

  if (preset === 'box-annotation') {
    ctx.strokeStyle = ink(INK_BLUE)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    for (const seg of phrase.segments) {
      const padX = fontSize * 0.24
      const padY = fontSize * 0.1
      sketchRect(
        ctx,
        ox + seg.x0 - padX,
        oy + seg.y - padY,
        seg.x1 - seg.x0 + padX * 2,
        fontSize * 1.05 + padY,
        eased,
        rand,
        // Straight edges hide the wobble that curves show off, so a box needs more of it
        // before it stops reading as a plain rectangle.
        { roughness: roughness * 1.9, passes: 2 },
      )
    }
  }

  if (preset === 'squiggle') {
    // The proofreader's mark: wavelength fixed in px so a long phrase gets more waves rather
    // than longer ones, which is how a hand actually draws it.
    ctx.strokeStyle = ink(INK_RED)
    ctx.lineWidth = stroke * 0.9
    ctx.lineCap = 'round'
    forEachSweptSegment(phrase, eased, (seg, sweptTo) => {
      const y = oy + seg.y + fontSize * 0.78 + fontSize * 0.17
      for (const d of sketchWavePaths(
        ox + seg.x0,
        y,
        ox + sweptTo,
        fontSize * 0.42,
        fontSize * 0.075,
        1,
        rand,
        { roughness: roughness * 0.7, passes: 1 },
      )) {
        ctx.stroke(new Path2D(d))
      }
    })
  }

  if (preset === 'arrow') {
    // Points up at the phrase from below-left, along a curved shaft — a straight arrow reads
    // as a diagram, a curved one as someone pointing something out.
    ctx.strokeStyle = ink(INK_BLUE)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    // ONE arrow for the whole phrase, anchored under its LAST line. Drawing one per line
    // segment put a shaft straight through the words on anything that wrapped.
    const last = phrase.segments[phrase.segments.length - 1]
    const tipX = ox + last.x0 + (last.x1 - last.x0) * 0.5
    const tipY = oy + last.y + fontSize * 1.1
    const tailX = tipX - fontSize * 1.25
    const tailY = tipY + fontSize * 0.7
    sketchLine(ctx, tailX, tailY, tipX, tipY, eased, rand, { roughness: roughness * 1.2, passes: 2 })
    // The head only lands once the shaft has been drawn.
    const headEase = clamp01((eased - 0.65) / 0.35)
    if (headEase > 0) {
      const head = fontSize * 0.3
      sketchLine(ctx, tipX, tipY, tipX - head, tipY + head * 0.28, headEase, rand, { roughness, passes: 1 })
      sketchLine(ctx, tipX, tipY, tipX - head * 0.28, tipY + head, headEase, rand, { roughness, passes: 1 })
    }
  }

  if (preset === 'corner-marks') {
    // Crop marks at the four corners — the quietest way to say "this bit", and the only one
    // here that never touches the words themselves.
    ctx.strokeStyle = ink('#2f3542')
    ctx.lineWidth = stroke * 0.85
    ctx.lineCap = 'round'
    for (const seg of phrase.segments) {
      const padX = fontSize * 0.3
      const padY = fontSize * 0.16
      const left = ox + seg.x0 - padX
      const right = ox + seg.x1 + padX
      const top = oy + seg.y - padY
      const bottom = oy + seg.y + fontSize * 1.05 + padY * 0.5
      const arm = fontSize * 0.26
      const corners: [number, number, number, number][] = [
        [left, top, 1, 1],
        [right, top, -1, 1],
        [left, bottom, 1, -1],
        [right, bottom, -1, -1],
      ]
      for (const [cx, cy, dx, dy] of corners) {
        sketchLine(ctx, cx, cy, cx + arm * dx, cy, eased, rand, { roughness: roughness * 0.6, passes: 1 })
        sketchLine(ctx, cx, cy, cx, cy + arm * dy, eased, rand, { roughness: roughness * 0.6, passes: 1 })
      }
    }
  }

  if (preset === 'bracket') {
    // Both brackets grow from the middle of their own stroke outwards, so the phrase reads as
    // being taken hold of rather than fenced in.
    ctx.strokeStyle = ink(INK_BLUE)
    ctx.lineWidth = stroke
    ctx.lineCap = 'round'
    for (const seg of phrase.segments) {
      const top = oy + seg.y + fontSize * 0.04
      const bottom = top + fontSize * 0.98
      const arm = fontSize * 0.22
      // Clear of the neighbouring words: at 0.18em the bracket collided with the word before it.
      const left = ox + seg.x0 - fontSize * 0.34
      const right = ox + seg.x1 + fontSize * 0.34
      for (const [x, dir] of [
        [left, 1],
        [right, -1],
      ] as [number, number][]) {
        sketchLine(ctx, x, top, x, bottom, eased, rand, { roughness, passes: 2 })
        sketchLine(ctx, x, top, x + arm * dir, top, eased, rand, { roughness, passes: 1 })
        sketchLine(ctx, x, bottom, x + arm * dir, bottom, eased, rand, { roughness, passes: 1 })
      }
    }
  }

  if (preset === 'shimmer' && progress < 1) {
    // One highlight band travelling the length of the whole phrase, rather than every word
    // flashing at once. Width scales with the font so it reads the same at 26px and 40px.
    const band = Math.max(14, fontSize * 0.6)
    const travel = -band + (phrase.totalWidth + band * 2) * progress
    for (const seg of phrase.segments) {
      const local = travel - seg.offset
      const segWidth = seg.x1 - seg.x0
      if (local < -band || local > segWidth + band) continue
      const sweepX = ox + seg.x0 + local
      const grad = ctx.createLinearGradient(sweepX - band, 0, sweepX + band, 0)
      grad.addColorStop(0, 'rgba(255,255,255,0)')
      grad.addColorStop(0.5, 'rgba(255,255,255,0.75)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = grad
      ctx.fillRect(ox + seg.x0 - 4, oy + seg.y, segWidth + 8, fontSize * 1.1)
    }
  }

  if (preset === 'burn' && progress < 1) {
    // Rising embers sell the "catching fire" motion; they're a transient cue, not a
    // persistent decoration, so they fade out once the phrase has settled into its burnt
    // colour. Spread across the whole phrase so a long phrase isn't 3 embers per word.
    const emberCount = Math.max(3, Math.min(10, Math.round(phrase.totalWidth / (fontSize * 1.5))))
    for (const seg of phrase.segments) {
      const segWidth = seg.x1 - seg.x0
      for (let k = 0; k < emberCount; k++) {
        const es = hashSeed(`${phrase.runId}:ember:${seg.offset}:${k}`)
        const ex = ox + seg.x0 + es * segWidth
        const rise = progress * fontSize * (0.6 + es * 0.4)
        const ey = oy + seg.y - rise
        ctx.fillStyle = `rgba(255, ${140 + Math.round(es * 80)}, 40, ${(1 - progress) * 0.8})`
        ctx.beginPath()
        ctx.arc(ex, ey, 1.5 + es, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }

  if (preset === 'bow-highlight') {
    if (eased > 0.3) {
      // One bow at the end of the phrase — not one per word. Kept small and anchored
      // within the last word's own line-box headroom so it can't collide with the line above.
      const word = phrase.lastWord
      const bowAlpha = clamp01((eased - 0.3) / 0.3)
      const bx = ox + word.x + word.width
      const by = oy + word.y + fontSize * 0.06
      const s = Math.min(6, fontSize * 0.22)
      ctx.globalAlpha = bowAlpha
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
    }
  }

  ctx.restore()
}

/**
 * Renders one scene at time tMs onto ctx at (offsetX, offsetY). Pure function — the only
 * rendering codepath, used by both the live preview canvas and OffscreenCanvas export.
 *
 * The base text layer is always fully visible: nothing ever hides, fades in, or blurs the
 * readable text itself; only the emphasis layers around it animate. Rendering is done in
 * three passes (highlight underlays -> glyphs -> sweeps and ornaments) so an effect
 * belonging to one word can never paint over a neighbouring word's glyphs.
 *
 * `pixelScale` is the supersampling factor the caller has already applied via ctx.scale().
 * Everything geometric follows the transform automatically; only shadowBlur, which the
 * canvas spec defines in device pixels, has to be compensated by hand.
 */
export function renderScene(
  ctx: Ctx2D,
  doc: AnimatedDocument,
  layout: TextLayout,
  tMs: number,
  timing: SceneTiming,
  offsetX = 0,
  offsetY = 0,
  pixelScale = 1,
) {
  ctx.save()
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(offsetX, offsetY, doc.width, doc.height)

  const ox = offsetX + PADDING
  const oy = offsetY + contentOffsetY(doc, layout)
  const words = layout.lines.flatMap((l) => l.words)
  const phrases = buildPhrases(layout)
  const progressByRunId = new Map(phrases.map((p) => [p.runId, phraseProgress(p, tMs, timing)]))

  for (const phrase of phrases) {
    drawPhraseUnderlay(ctx, phrase, ox, oy, progressByRunId.get(phrase.runId)!, doc.fontSize)
  }

  for (const word of words) {
    if (!word.highlight?.animated) {
      drawWordBase(ctx, word, ox, oy, doc.fontSize)
      continue
    }
    drawEmphasisWord(ctx, word, ox, oy, progressByRunId.get(word.runId) ?? 0, doc.fontSize, pixelScale)
  }

  for (const phrase of phrases) {
    drawPhraseOverlay(ctx, phrase, ox, oy, progressByRunId.get(phrase.runId)!, doc.fontSize)
  }

  ctx.restore()
}
