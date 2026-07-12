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
- **PNG** (current scene, settled frame) implemented in `exportV2.ts`, main thread.
- **ZIP** (all scenes as PNG, one archive) via `fflate`'s `zipSync` — replaces the earlier
  PNG-sequence-as-N-downloads approach (see Update 2026-07-12 below).

## Update 2026-07-12 — export/visual-quality verification pass

A follow-up focused task ("close the export and visual-quality verification gap before
starting clipboard/email delivery") required manually verifying every preset, click-
testing all three export formats for real, testing Unicode edge cases visually (not just
via unit assertion), benchmarking three input sizes, and gating further work on there
being no known clipping/unreadable-final-frame defects. Findings below are all from this
session, in the Chromium-based preview browser only — no cross-browser (Safari/Firefox)
testing has been done.

### Preset visual QA matrix
Built `/debug/presets` (`src/src/DebugPresets.tsx`), a route that renders all 4 entrance
+ 6 emphasis + 2 transition presets against 4 samples (short, multiline, Cyrillic, emoji)
— 48 cells total, each showing first/mid/final frame plus real frame count, export
duration, and file size from the actual render+export pipeline (not a mock). All 48
cells were visually inspected.

**Two real bugs found and fixed:**
- **Gentle Pop / Weight Shift word collision.** Both presets grow a word's rendered
  width (scale-up, bold) beyond what layout reserved for it. Adjacent words in the same
  animated phrase — the common case, e.g. "great work", "crushed it" — collided into each
  other (rendered as "crushedit", "greatwork") whenever both words animated
  simultaneously, which they do by design since one phrase shares one emphasis timing.
  This is not a debug-harness-only artifact: any real highlighted 2+-word phrase given
  either preset hits it. Root cause and fix in `engine/render.ts`'s `drawEmphasisWord()`:
  - Gentle Pop's scale amplitude is now capped against the font's own *measured* space
    width (`ctx.measureText(' ')`) rather than a fixed constant, so growth self-corrects
    for word length and loaded font instead of assuming a magic number holds everywhere.
  - Weight Shift's bold rendering is measured (`ctx.measureText(word.text)` at the bold
    weight) and horizontally compressed back to the word's original non-bold width via
    `ctx.scale` if it would otherwise overflow — guaranteed not to collide regardless of
    font metrics, rather than picking a lower weight number and hoping it's narrow enough.
  - Verified fixed across all 4 samples, including the harshest case (the debug harness's
    Multiline sample with ~100% of its text force-animated, far above production's 15%
    cap) — no collisions remain there either.
- **Soft Glow / Gentle Pop's `Math.sin(progress * Math.PI)` timing curve** was
  investigated as a possible "final frame loses all emphasis" bug (glow fully fades,
  pop fully un-scales by the time the emphasis animation completes, since `sin(π) = 0`).
  Determined this is *not* a defect: Marker Highlight, Underline Draw, and Weight Shift
  persist their effect at rest; Soft Glow, Gentle Pop, and Shimmer are all designed as
  transient pulses that settle cleanly back to the stable base rendering — which is
  itself always fully readable. No fix applied; documented here so the distinction is
  explicit rather than re-litigated later.
- All other presets (Fade, Soft Rise, Blur Reveal, Word Cascade, Marker Highlight,
  Underline Draw, Shimmer, Crossfade, Slide Up) showed no clipping, no line overlap, and
  a stable final frame across all 4 samples.

### Font-readiness Worker hang (found via this session's own QA harness testing)
While building the QA harness, `waitForFontsReady()` was implemented to check both
`document.fonts.ready` (main thread) and `self.fonts.ready` (Worker context) before
layout/export. This caused every GIF export to hang indefinitely — `self.fonts.ready`
never resolved in the GIF export Worker in this browser, empirically. Fixed by making
`fontReady.ts` main-thread-only; Workers render with whatever system font is already
available, which is correct since this app uses no `@font-face` network font to wait for
in the first place. This is exactly the class of defect the verification task was meant
to catch before shipping — it was a regression from work done earlier in the same
session, caught by the harness before reaching a user.

### Export click-testing (real UI clicks, not synthetic dispatch)
- **GIF**: clicked "Download GIF" in the live app twice; both times the status line
  reported a concrete result (`Downloaded — 698 KB`), confirming the full worker
  pipeline runs end-to-end from a real click.
- **PNG**: clicked "Export ▾" → "PNG (current scene)"; no console errors, same
  `triggerDownload` codepath already proven by the GIF case.
- **ZIP**: clicked "Export ▾" → "ZIP (all scenes, PNG)"; no console errors.
- All 16 Vitest tests still pass after the `render.ts` collision fix
  (`npm test` → `vitest run`, 16/16 passed).

### Unicode edge cases — visual pass (beyond the existing unit tests)
Rendered live in the app: Cyrillic `ё`/`Ё`, em dash, a non-breaking space, a combining-
mark-composed `é`, a skin-tone emoji, a ZWJ family emoji, and a flag.
- ё/Ё, em dash, and the combining-mark `é` all render correctly.
- The flag (regional-indicator pair, 🇺🇸) renders correctly as a single flag glyph.
- The skin-tone thumbs-up (👍🏽) renders correctly with the modifier visibly applied.
- **The ZWJ family emoji (👨‍👩‍👧‍👦) does not render as a combined glyph** — it falls back
  to a generic two-person "contacts" icon. This is a Canvas2D `fillText` + OS font-
  fallback limitation for complex multi-codepoint ZWJ sequences, not a bug in this app's
  text handling: the existing Vitest suite already proves every codepoint of the source
  string survives intact through detection and layout (`engine.test.ts`, "does not
  corrupt ZWJ family emoji..."). Fixing the *visual* rendering would require bundling a
  custom emoji font and a different text-shaping approach — out of scope for this task
  and not attempted. Documented as a known, accepted browser-platform limitation rather
  than engineered around.

### Benchmarks
Measured via `buildAnimatedDocument` → `buildTimeline` → `exportDocumentAsGif`, timed
with `performance.now()`, in the live app (Chromium-based preview browser):

| Input | Scenes | Build doc | Build timeline | GIF export | Total | GIF size | Frames |
|---|---|---|---|---|---|---|---|
| 120 chars | 1 | 5.2ms | 0.3ms | 202ms | 208ms | 242 KB | 24 |
| 500 chars | 3 | 0.7ms | 0.4ms | 659ms | 660ms | 1212 KB | 82 |
| 1500 chars | 6 (truncated) | 1.0ms | 0.8ms | 1331ms | 1333ms | 3311 KB | 185 |

Caveats: the 120-char case's higher `buildDoc` time is cold-start overhead (first font-
measurer/canvas creation in the session), not a real per-call cost — the 500/1500-char
runs immediately after show sub-millisecond doc-build times. "Peak memory" was not
measurable; `performance.memory.usedJSHeapSize` (Chrome-only, non-standard) only gives a
heap snapshot at the end of each run (10.2 → 10.4 → 10.7 MB across the three), not a true
peak during processing — treat as a rough lower bound, not a peak.

**File size is the one concrete concern this surfaced.** V1's original spec target was
≤800KB / hard cap ~1.5MB for a single short animation; V2's long-form GIFs scale with
scene count and blow well past that — 1.2MB at 500 chars, 3.3MB at 1500 chars. V2 is
explicitly a different product shape (long-form, up to 6 scenes) so the V1 cap doesn't
directly apply, but a 3.3MB GIF is large for an email attachment in practice (some mail
providers are slow to render or strip very large inline images). Not fixed in this
task (out of scope — no new features/optimizations were authorized), but flagged here as
a concrete number for whoever scopes the next round of work.

### Remaining browser-specific uncertainty
- Only tested in the Chromium-based preview browser used by this session's tooling. No
  Safari or Firefox verification has been done for: Canvas2D emoji/ZWJ rendering
  (Safari's emoji font fallback behavior differs from Chrome's), Worker + OffscreenCanvas
  support, `document.fonts.ready` timing, or GIF Worker export behavior generally.
- The font-readiness Worker hang (above) is itself evidence that Worker-context Web
  Platform APIs can behave unexpectedly even within one browser engine — a strong prior
  that cross-browser testing would surface more such gaps, not a reason to skip it.
- `performance.memory` is Chrome-only; there is no cross-browser way to measure peak
  memory from within the page, so real peak memory during a large (1500-char, 6-scene)
  export remains unmeasured on any browser.

## Known gaps — not silently claimed as done (updated 2026-07-12)
- **"Style selector" UI element**: still not built — out of scope for the verification
  task, unchanged from the original gap.
- **Cross-browser verification**: still not done (see "Remaining browser-specific
  uncertainty" above). This is now the primary open item before this engine can be
  considered broadly verified, rather than "only 2 of 12 presets eyeballed" (resolved —
  see preset QA matrix above, all 12 now visually verified).
- **GIF output size** grows with scene count well past the V1-era size target at longer
  inputs (3.3MB at 1500 chars/6 scenes) — not addressed, flagged for future scoping.
- `MODE_PRESETS` canvas sizes (One Card 600×320, Paragraph 600×400, Story 600×360) are
  fixed choices, not derived from any spec'd sizing rule — reasonable defaults, not
  validated against a design requirement. Unchanged from original gap.

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
