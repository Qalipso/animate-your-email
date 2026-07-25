# DEC-011 — Output quality pass + one frame for any amount of text

**Date:** 2026-07-25
**Status:** Implemented and verified
**Supersedes:** the pagination half of [[DEC-009]]; extends [[DEC-010]]

## Context

Two asks: keep improving the UI, and keep improving the quality of the exported images.
Mid-pass a third constraint arrived and changed the product shape: *however much text is
pasted, it must be on one screen.*

## Decisions

### 1. One frame, always — pagination removed

`buildAnimatedDocument` no longer splits text into up to 6 scenes with dot navigation and
transitions. It fits everything into a single frame, using the two levers in the order that
costs the least legibility:

1. the frame grows taller, up to `MAX_FRAME_HEIGHT` (1000px);
2. only at that ceiling does the type step down, never below `MIN_READABLE_FONT_PX` (16px).

Text that still doesn't fit is cut at a line boundary and `truncated` is set, so the UI can
say so. The one thing this must never do is render lines off-frame and present the image as
complete.

This reverses DEC-009's "font size is fixed per mode, overflow is handled by pagination".
Scene navigation, the transition picker, and the multi-scene ZIP export are gone with it;
`fflate` was dropped as a dependency. `timeline.ts` still handles N scenes and transitions —
it is the export clock — but the builder now only ever produces one.

Short text still gets the mode's own frame proportions rather than a letterbox strip, so the
renderer centres the text block vertically in whatever spare height there is
(`contentOffsetY`, shared by the renderer and the editor's hit-testing).

**Measured** (mock-free, in-browser, `autoSelectMode`): 30 / 120 / 400 / 800 / 1200 / 1500
characters → 1 scene each, 0 overflowed, 0 truncated, word count in == word count out,
frames 600×320 … 600×964, font 40px … 22px.

### 2. Export renders at 2× and is filtered down

A GIF is 256 hard colours with no alpha, so whatever anti-aliasing exists at render time is
final. Both GIF and PNG now render at `SUPERSAMPLE` = 2 and are box-filtered to the output
size. `shadowBlur` is compensated by hand because the canvas spec defines it in device
pixels and it is not affected by the transform.

### 3. One shared palette + inter-frame differencing

Previously every frame was quantized independently: a 768-byte local colour table per frame,
and colours that survive in frame N but get merged in frame N+1, which makes glyph edges
crawl even where nothing is animating. Now one palette is built from 10 sampled frames and
written once as the global table.

On top of that, pixels identical to the previous frame are written as a reserved transparent
index with `dispose: 1`. Without it the 2× / 20fps export of a two-scene story was 1.9 MB.

**Measured:** 1.9 MB → 326 KB for the same document (5.8×). Worst case at the 1500-character
cap: 600×973, 5.8s, **240 KB**, 983ms to encode.

### 4. Frame delay snapped to a whole centisecond

GIF stores delays in 1/100s. The old 12fps meant an 83.33ms delay that the encoder rounded to
80ms — the file played 4% faster than every frame had been rendered for. The delay is now
snapped first and each frame's render time derived from it. Default is 20fps = exactly 50ms.

**Verified** by decoding the produced GIF with `ImageDecoder` and comparing each decoded
frame against a fresh reference render: frame count matches exactly, every frame duration is
50000µs, and max per-channel difference is ≤ 21 (pure palette quantization) with **zero**
pixels differing by more than 40 — including the scene-transition frames. No ghosting from
the differencing.

### 5. Emphasis is a phrase-level effect, drawn in three layers

Sweeping effects (marker highlight, underline draw, shimmer) used to be computed per word, so
"three major updates" rendered as three disconnected stripes with unpainted gaps at the word
spaces, each restarting its own sweep from zero. They are now computed per phrase across all
the lines it spans.

Rendering is also split into three passes — highlight underlays → glyphs → sweeps and
ornaments — so an effect belonging to one word can never paint over a neighbour's glyphs. The
bow ornament is now one per phrase instead of one per word.

### 6. Text fidelity fixes

- **Punctuation glued to a detected phrase kept its space.** `July 12, 2026.` rendered as
  `July 12, 2026 .` — a character the user never typed. Runs and layout words now carry
  `tightBefore`, set from the source text, and layout gives them zero advance.
- **Quotation marks were being deleted.** Unlike `*soft*` and `[[primary]]`, which are
  authoring markup, real quotation marks are part of the sentence; the quote pattern now
  captures them.

### 7. Timing

Lead-in 1200ms → 500ms (the base text is fully visible from frame 1, so it was over a second
of a static image), emphasis 1200ms → 900ms, hold 900ms → 800ms. Phrases still play strictly
one after another, per DEC-010.

### 8. UI

Two-column responsive workspace with a sticky preview (single column under 960px); DPR-aware,
responsive preview canvas; replay + loop controls (loop defaults off under
`prefers-reduced-motion`); an inline effect picker with colour swatches after a drag-select,
so effects no longer depend on knowing that right-click does something; a real export
progress bar fed by worker progress messages; typed status messages (info/success/error); a
char-count warning before the cap silently truncates a paste; a consistent focus-visible
treatment; and the frame's real dimensions and type size shown under the preview.

## Verification

- `npm test` — 22 passed (was 16). New regression tests cover punctuation spacing, quote
  preservation, contiguous phrase highlight geometry, centisecond delay snapping, and the
  single-frame fitting invariants.
- `npm run build` — typecheck + production build clean.
- `npm run lint` — clean.
- In-browser measurements above, taken against the real render/export pipeline.

## Known gaps

- Drag-select uses mouse events; touch devices get tap-to-toggle but not drag-to-select.
- The `Scene.transition` field and `timeline.ts`'s transition compositing are retained but
  unreachable from the UI now that documents are single-frame.
