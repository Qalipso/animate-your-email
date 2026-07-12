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

export type EmphasisPresetId = 'marker-highlight' | 'underline-draw' | 'soft-glow' | 'gentle-pop' | 'shimmer' | 'weight-shift'
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
  /** True if the input needed more than MAX_SCENES scenes and was truncated. */
  truncated: boolean
  fontSize: number
  width: number
  height: number
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
export const MAX_SCENES = 6
export const MAX_ANIMATED_FRACTION = 0.15
export const MAX_ANIMATED_PHRASES_PER_SCENE = 5
export const MIN_READABLE_FONT_PX = 16
