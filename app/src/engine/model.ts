// The JSON document model is the source of truth for V2. Fabric is gone entirely —
// both the live preview and GIF/PNG export render directly from this model via
// engine/render.ts, so there is exactly one rendering codepath and it can't drift
// (this is what caused DEC-007/DEC-008: two divergent renderers).

export type HighlightKind =
  | 'markup-soft' // *soft emphasis*
  | 'markup-primary' // [[primary phrase]]
  | 'quote' // "quoted phrase"
  | 'number-date'
  | 'proper-noun'
  | 'final-sentence'
  | 'cta'
  | 'content-word'

// Every preset here animates only a decorative effect layer (highlight sweep, underline
// draw, glow, shimmer, etc.) around or above the text — never the text's own visibility.
// The base glyphs are always drawn at full opacity from the first frame (see
// ALWAYS_VISIBLE in render.ts). Pixelate and Assemble-from-Blur were removed: both were
// built entirely around starting illegible and resolving to readable, which is exactly
// what this rule forbids.
export type EmphasisPresetId =
  | 'marker-highlight'
  | 'underline-draw'
  | 'soft-glow'
  | 'gentle-pop'
  | 'shimmer'
  | 'weight-shift'
  | 'burn'
  | 'wash-away'
  | 'bow-highlight'
  | 'glitch'
  // Hand-drawn annotation family — the vocabulary Rough Notation popularised. Each is drawn
  // around or through the phrase over time, so the text underneath stays fully readable from
  // frame one, which is the one rule no preset may break.
  | 'circle-annotation'
  | 'box-annotation'
  | 'strike-through'
  | 'bracket'
  | 'squiggle'
  | 'arrow'
  | 'corner-marks'
// Kept on Scene for document-model stability, but no longer affects rendering — the base
// text layer is always fully visible from frame 1 regardless of this value (render.ts's
// ALWAYS_VISIBLE). Not exposed as a UI choice anymore since every option would now look
// identical.
export type EntrancePresetId = 'fade' | 'soft-rise' | 'blur-reveal' | 'word-cascade'
export type TransitionPresetId = 'crossfade' | 'slide-up'
export type OutputMode = 'one-card' | 'paragraph' | 'story'
export type ExportFormat = 'gif' | 'png' | 'png-sequence'

export interface HighlightSpec {
  kind: HighlightKind
  /** Priority order kind was selected at — lower is stronger. Used when trimming to the 15%/5-phrase cap. */
  priority: number
  /** Whether this run is actually animated. User can toggle by clicking; starts true for the top candidates. */
  animated: boolean
  emphasisPreset: EmphasisPresetId
}

export interface TextRun {
  id: string
  text: string
  highlight?: HighlightSpec
  /** Marks a paragraph break in the flat run stream produced by highlight detection. */
  isBreak?: boolean
  /**
   * True when no whitespace separated this run from the previous one in the source text —
   * e.g. the "." after a detected `July 12, 2026` span, or an opening "(" before one.
   * Layout must then join them with zero advance instead of a word space, otherwise the
   * rendered output silently gains spaces the user never typed ("July 12, 2026 .").
   */
  tightBefore?: boolean
}

export interface TextBlock {
  id: string
  runs: TextRun[]
}

export interface Scene {
  id: string
  blocks: TextBlock[]
  entrance: EntrancePresetId
  transition: TransitionPresetId
}

export interface AnimatedDocument {
  version: 1
  rawText: string
  mode: OutputMode
  modeIsOverridden: boolean
  scenes: Scene[]
  /** True if the text could not fit even at MIN_READABLE_FONT_PX and its tail was cut. */
  truncated: boolean
  fontSize: number
  width: number
  height: number
  /**
   * Playback tempo. 1 is the designed pace; 2 plays twice as fast. Lives on the document
   * rather than in component state because the export worker only ever receives the
   * document — anything the preview honours but the export doesn't is a bug waiting to
   * happen (see DEC-009 on the single rendering codepath).
   */
  speed: number
  /** How long the finished frame is held before the GIF loops, in ms at speed 1. */
  holdMs: number
}

// ---- Computed layout (never authored, always derived from a Scene + canvas metrics) ----

export interface LayoutWord {
  runId: string
  text: string
  x: number
  y: number
  width: number
  height: number
  highlight?: HighlightSpec
  /** Index of this word among only the highlighted+animated words in the scene, for stagger. */
  animatedIndex: number
  /** See TextRun.tightBefore — no word space between this word and the previous one on the line. */
  tightBefore?: boolean
}

export interface LayoutLine {
  words: LayoutWord[]
  y: number
  height: number
}

export interface TextLayout {
  lines: LayoutLine[]
  overflowed: boolean
  contentHeight: number
  animatedWordCount: number
  totalWordCount: number
}

export const MAX_CHARACTERS = 1500
/**
 * Tallest frame the single-frame fitter will produce before it starts shrinking type
 * instead. Everything the user pastes has to be readable in one image, so the frame has to
 * be allowed to grow — but an email client will not thank us for an arbitrarily long one.
 */
export const MAX_FRAME_HEIGHT = 1000
export const MAX_ANIMATED_FRACTION = 0.15
export const MAX_ANIMATED_PHRASES_PER_SCENE = 5
export const MIN_READABLE_FONT_PX = 16

/** Tempo bounds for the speed control. Below 0.5 the GIF gets email-hostile; above 2 the effects stop reading. */
export const MIN_SPEED = 0.5
export const MAX_SPEED = 2
export const DEFAULT_SPEED = 1
/** Hold-at-the-end bounds, in ms. Zero is allowed: some senders want a tight loop. */
export const MIN_HOLD_MS = 0
export const MAX_HOLD_MS = 2500
export const DEFAULT_HOLD_MS = 800
