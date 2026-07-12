---
type: decision
tags: [decision, architecture, implementation, major-version]
status: accepted
---
# DEC-009 — V2: long-form text-to-animated-layout architecture

Replaces V1's single-short-line Fabric.js engine ([[DEC-003-stack-and-roadmap]],
[[DEC-006-preset-engine-v1]]) with a document-model-driven, multi-scene engine per an
explicit product spec: paste up to 1500 characters, auto-paginate into up to 6 scenes,
deterministically detect what's worth animating, keep the base paragraph static and
animate only selected phrases as overlays. Fabric.js is gone entirely — removed as a
dependency. Bundle size dropped 562KB → 207KB as a result.

## Architecture: JSON model is the source of truth
`src/src/engine/model.ts` defines `AnimatedDocument → Scene → TextBlock → TextRun`
(authored/derived-once) and `TextLayout → LayoutLine → LayoutWord` (always *recomputed*
from the model, never persisted as truth). Every render — live preview and GIF/PNG
export alike — calls the same `renderScene()`/`renderTimelineFrame()` functions in
`engine/render.ts` / `engine/timeline.ts` against freshly-derived layout. There is
exactly one rendering codepath; preview and export cannot visually diverge, which is
what caused [[DEC-007-retina-canvas-export-bug]] and [[DEC-008-stagger-timing-bug]] in
V1's two-codepath (Fabric preview + separate export loop) design.

## Rendering foundation (built and proven first, per the task's explicit ordering)
- **No devicePixelRatio anywhere.** The new engine never references
  `devicePixelRatio` at all — canvases are created with `new OffscreenCanvas(doc.width,
  doc.height)`, explicit logical pixels, full stop. This makes DEC-007's entire bug
  class structurally impossible rather than patched via a flag.
- **Export renders to a dedicated OffscreenCanvas** (`engine/gifWorker.ts`,
  `engine/exportV2.ts`), separate from the live preview's DOM `<canvas>`.
- **Text wrapping/measurement/overflow**: `engine/layout.ts` — real `measureText`-based
  word wrap, oversized-word hard-splitting (character-by-character, Unicode-safe via
  `Array.from`), and an `overflowed` flag on every computed `TextLayout`.
- **Never shrink text; paginate instead**: font size is fixed per output mode
  (22/26/28px, all ≥ `MIN_READABLE_FONT_PX`=16, defensively clamped), never reduced to
  force a fit. When content overflows a scene's height budget, `engine/document.ts`'s
  pagination starts a new scene — proven with a multi-paragraph input that correctly
  split a paragraph mid-way across two scenes with the continuation picking up exactly
  where the first left off, no duplication, no missing words (verified both visually and
  via an automated reconstruction test).

## Deterministic highlight detection (`engine/highlight.ts`)
No LLM. Regex/heuristic detectors in the spec's priority order: `*soft emphasis*` →
`[[primary phrase]]` → `"quoted phrases"` → numbers/dates → capitalized names (via
`\p{Lu}\p{Ll}` Unicode property escapes — script-agnostic, so Cyrillic names work the
same as Latin ones) → final sentence → CTA phrases → longer content words. Overlaps
resolve by priority; every remaining word becomes its own clickable "content-word" run
(default off) so any word is toggleable, not just detected phrases. Two caps enforced:
≤15% of total characters animated (global), ≤5 animated phrases per scene (post-
pagination pass). Found and fixed a real bug during testing: the initial span-boundary
math excluded only the opening delimiter's *offset* but not its *length* from the
consumed range, so `*`/`[[`/`]]` characters leaked into the plain text as literal
characters — fixed by always consuming the full regex match span, not just the captured
group.

## Click-to-toggle — found and fixed a real bug
`handleCanvasClick`'s hit-test originally treated `word.y` as a text baseline (subtracting
80% of line height above, adding 30% below) — but `word.y` is actually the line's *top*
edge in this model, not a baseline. Every click round-trip failed silently (no error, no
visible change) until this was caught by dispatching synthetic clicks at *known* word
coordinates (pulled from a temporary debug hook) and confirming the animated flag never
flipped. Fixed to a plain box test (`y >= word.y && y <= word.y + word.height`), then
re-verified with a real mouse click on the actual rendered UI — clicking "three" in a
highlighted "three major updates" phrase removed just that word's highlight, leaving
"major updates" animated. Bidirectional toggle confirmed via script.

## Animation: three roles, not a motion editor
`engine/render.ts` implements the three-role split exactly as specified — scene
entrance (Fade, Soft Rise, Blur Reveal via genuine `ctx.filter = 'blur()'` — Canvas2D
supports this natively, unlike Fabric — and Word Cascade), emphasis (Marker Highlight,
Underline Draw, Soft Glow, Gentle Pop, Shimmer, Weight Shift), and scene transition
(Crossfade, Slide Up in `engine/timeline.ts`, compositing two scratch-rendered
OffscreenCanvases). Long-paragraph text is never split into per-character render
objects: non-animated words draw once as static base text; only the (capped) animated
phrases get a second overlay pass with their own emphasis timing. No Fabric object ever
existed per character — there never were Fabric objects in V2 at all.

## Export
- **GIF**: `engine/gifWorker.ts` runs entirely inside a Web Worker — layout, render, and
  `gifenc` encoding all happen off the main thread, per the explicit requirement. Verified
  with a real 2-scene, 293-character multi-paragraph document: 715KB, 50 frames,
  crossfade transition, content bounds checked frame-by-frame and confirmed to stay
  within the 600×360 canvas in every sampled frame (no clipping).
- **PNG** (current scene, settled frame) and **PNG sequence** (one file per scene,
  sequential downloads — not a zip, see Known gaps) implemented in `exportV2.ts`, main
  thread. Typechecked and built; not interactively exercised in-browser this session
  (only GIF export was).

## Tests
Added Vitest (`src/vitest.config.ts`) with a deterministic mock `OffscreenCanvas`/2D
context (`src/test/mockCanvas.ts`) so the pure engine logic runs under plain Node — no
jsdom, no native canvas bindings. 13 tests across the exact required list: retina export
dimensions, very long words, multiple paragraphs, Cyrillic text, emoji, 1500-character
input, automatic pagination (including a truncation case), animation-range isolation
across independently-built documents, exported frame dimensions sampled across a full
timeline, and preview/export layout determinism + alignment. All 13 pass
(`npm test` → `vitest run`).

## Known gaps — not silently claimed as done
- **"Style selector" UI element**: not built. The UI has Output mode, Entrance,
  Transition, and Customize (font size) selectors, but no separate visual
  theme/style picker — that requirement fell out of scope during implementation and is
  flagged here rather than left unmentioned.
- Only **Marker Highlight** and **Crossfade** were visually confirmed in-browser this
  session (screenshots + a real click). The other 5 emphasis presets and Slide Up
  transition are implemented via the same code path and covered by the frame-dimension/
  no-throw test, but not individually eyeballed for correct appearance.
- **PNG / PNG-sequence export**: implemented and typechecked, not clicked through in the
  browser this session (GIF export was the one verified end-to-end with real output
  bytes).
- **PNG sequence** triggers N sequential browser downloads, not a zip archive — no zip
  library was added; this is a real V1-of-this-feature limitation, not a bug.
- `MODE_PRESETS` canvas sizes (One Card 600×320, Paragraph 600×400, Story 600×360) are
  fixed choices, not derived from any spec'd sizing rule — reasonable defaults, not
  validated against a design requirement.
