import type { AnimatedDocument, EmphasisPresetId } from './model'

/** Small enough to sit beside a menu row, large enough that PADDING (32) is not the whole frame. */
export const PREVIEW_WIDTH = 260
export const PREVIEW_HEIGHT = 104
const PREVIEW_FONT = 30
/** Beat of stillness before the sample restarts, so the loop reads as a loop. */
export const PREVIEW_PAUSE_MS = 450

/**
 * A minimal document carrying exactly one animated run. Built by hand rather than through
 * buildAnimatedDocument because that runs highlight detection and mode fitting, none of which
 * applies to a single sample word.
 */
export function previewDocument(word: string, preset: EmphasisPresetId): AnimatedDocument {
  return {
    version: 1,
    rawText: word,
    mode: 'one-card',
    modeIsOverridden: true,
    scenes: [
      {
        id: 'preview-scene',
        blocks: [
          {
            id: 'preview-block',
            runs: [
              {
                id: 'preview-run',
                text: word,
                highlight: { kind: 'content-word', priority: 0, animated: true, emphasisPreset: preset },
              },
            ],
          },
        ],
        entrance: 'fade',
        transition: 'crossfade',
      },
    ],
    truncated: false,
    fontSize: PREVIEW_FONT,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    speed: 1,
    holdMs: 250,
  }
}

