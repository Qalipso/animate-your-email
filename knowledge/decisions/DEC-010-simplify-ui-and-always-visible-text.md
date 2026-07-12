---
type: decision
tags: [decision, ux, animation-behavior, clipboard, implementation]
status: accepted
---
# DEC-010 — UI simplification, always-visible base text, Copy GIF as primary action

Product-directed simplification pass on top of the V2 long-form architecture
([[DEC-009-v2-long-form-architecture]]) — not a feature expansion. Three changes, all in
`src/src/App.tsx`, `src/src/App.css`, `src/src/engine/render.ts`, `src/src/engine/model.ts`,
`src/src/DebugPresets.tsx`.

## 1. Animation-behavior rule: base text is always visible

**New invariant**: the readable text layer never disappears, blurs, or fades at any frame,
from the first exported frame to the last. Only decorative effect layers (highlight fill,
underline, glow, shimmer sweep, weight/scale pulse) may animate. This replaces the old
per-scene entrance reveal (Fade / Soft Rise / Blur Reveal / Word Cascade), which by design
made text illegible for part of the animation.

- `engine/render.ts`: removed `entranceStateFor()` entirely; replaced with a constant
  `ALWAYS_VISIBLE = { opacity: 1, translateY: 0, blurPx: 0 }` applied to every word's base
  layer regardless of scene entrance. `renderScene()`'s `_entrance` parameter is kept
  (unused, `noUnusedParameters`-safe) rather than removed from every call site — `Scene`
  still carries an `entrance` field in the document model for stability, but it no longer
  affects rendering.
- `engine/model.ts`: `EntrancePresetId` kept on `Scene` (document-model stability) but no
  longer exposed as a UI control — every option would now render identically.
- **Two emphasis presets removed, not patched**: `pixelate` and `assemble-blur`. Both were
  built entirely around starting illegible (blocky / blurred+scattered) and resolving to
  legible — the exact mechanic the new rule forbids. There is no partial fix that keeps
  either preset's identity while making it always-readable, so they were deleted from
  `EmphasisPresetId`, `App.tsx`'s `EMPHASIS_OPTIONS`, and `DebugPresets.tsx`'s
  `EMPHASIS_PRESETS`. 10 emphasis presets remain (Marker Highlight, Underline Draw, Soft
  Glow, Gentle Pop, Shimmer, Weight Shift, Burn, Wash Away, Pink Highlight + Bow, Glitch) —
  all confirmed to only animate a decorative fill/stroke/shadow/scale/color layer around
  glyphs that are always drawn via the same `ctx.fillText` call.

**Verified against the real exported artifact, not just the live preview.** Downloaded a
real GIF (multi-paragraph SAMPLE_TEXT, 101 frames, 12.5fps, confirmed via PIL —
`GIF image data, version 89a, 600×360`), extracted frames 0, 1, 50, 75, 100 as PNGs, and
visually inspected each: full legible text present at every checkpoint, with only the
marker-highlight fill-width and weight-shift boldness transitioning in the frame-0/1
checkpoints (scene 1, mid-emphasis) and a fully-settled scene 2 at frames 75/100. No frame
at any checkpoint showed blurred, blocky, faded, or absent base text.

## 2. UI simplification — Copy GIF is the primary action

`App.tsx` rewritten. Flow is now **Paste → choose template → Copy GIF**, no manual
"Generate Preview" step:

- **Auto-generate, debounced** (400ms) via a `useEffect` keyed on `[rawText, effectiveMode,
  modeOverride, transition]`, guarded by a monotonic `generationIdRef` so a stale async
  result from a superseded rapid edit can't clobber a newer one. Replaces the old manual
  "Generate Preview" button entirely.
- **Template picker**: 4 pill buttons (Auto / Card / Paragraph / Story) above the preview,
  replacing the old `<select>`.
- **Primary/secondary action hierarchy**: `Copy GIF` (`.cta-primary` — filled accent,
  glow shadow) is now the largest, first, and only accent-colored button. `Save GIF`
  (`.cta-secondary` — outlined) sits next to it, visibly subordinate. `More export options`
  (PNG / ZIP) demoted to a plain underlined text link below both.
- **Advanced controls collapsed**: native `<details className="customize">` (zero JS) now
  holds the Transition selector and the phrase-toggle chip row — hidden by default, opened
  on demand. Removed from the default view entirely: the old Entrance selector (moot per
  §1) and the old Output-mode `<select>` (replaced by the template picker).
- **Scene navigation de-emphasized**: compact arrow + dot indicators (`.scene-arrow`,
  `.scene-dots`), rendered only when `doc.scenes.length > 1` — invisible for single-scene
  (short-text) output, exactly the common case.
- `.app` max-width reduced 680px → 640px; textarea rows 6 → 5.

Long-form architecture is unchanged: document model, pagination, scene splitting,
highlight detection, click-to-toggle, and the export pipeline are all untouched by this
pass — confirmed via a fresh multi-paragraph run producing 2 scenes with correct
pagination, scene-nav, and per-scene chip lists (see Verification below).

## 3. Copy GIF via the Clipboard API — a real platform limitation, disclosed

`handleCopyGif()` uses `navigator.clipboard.write([new ClipboardItem({...})])`, passing a
`Promise<Blob>` (not an already-resolved `Blob`) as the `ClipboardItem` value so the
`write()` call itself stays synchronous within the click handler — required for Safari's
transient-user-activation gate, though not yet verified on Safari itself (see gaps below).

**Finding, confirmed empirically via `ClipboardItem.supports()` and a real failed write in
this Chromium-based browser: `image/gif` is not a supported Clipboard-writable MIME type.**
Only `image/png` and `image/svg+xml` are. This means an *animated* GIF genuinely cannot be
placed on the OS clipboard from a web page today, in this browser — not a bug in this app,
a Web Platform gap. `handleCopyGif()` probes `ClipboardItem.supports('image/gif')` first;
when unsupported it falls back to copying the current scene's settled frame as a static PNG
via `exportSceneAsPng()`, with an explicit status message telling the user their browser
can't copy animated GIFs and to use Save GIF for the real animated file. This is a
disclosed downgrade, not a silent one.

**Net effect**: "Copy GIF" as a UI *action* is fully real and is the primary CTA per the
product requirement. "Copy GIF" as a literal *payload description* is not fully deliverable
on the web platform as tested — the clipboard payload is a static PNG, not an animated GIF,
whenever `image/gif` write is unsupported (confirmed: always, in every browser tested so
far — see gaps).

## Verification (this session, Chromium-based preview browser only)

| Case | Result |
|---|---|
| Short text (`Thanks for the *great work* today!`) | Single scene, no scene-nav shown, emphasis auto-detected on "great work". Copy GIF → PNG fallback, 17 KB, correct status message. Save GIF → 117 KB, correct status message. |
| Multi-paragraph text (4 paragraphs, `*soft*` / `[[primary]]` / quote / number-date highlights) | Correctly paginated into 2 scenes; scene-nav (arrows + dots) appears; Customize panel shows per-scene chip list that updates when switching scenes; scene switching is stable when done as isolated actions (see below). |
| Highlighted phrases | All 4 highlight kinds (`markup-soft`, `markup-primary`, `number-date` ×2, `quote`) detected and shown as toggleable chips in Customize; click-to-toggle handler unchanged from prior session's verified drag-select/right-click implementation. |
| Exported GIF playback | Real downloaded GIF (multi-paragraph case): 101 frames, 12.5fps, infinite loop, `600×360`, confirmed via PIL. 5 sampled frames (0/1/50/75/100) all show fully legible text — see §1. |
| Save GIF | Confirmed for both short text (117 KB) and multi-paragraph text (1623 KB / 1.6 MB, matches the on-disk downloaded file size exactly). |
| Copy GIF fallback | Confirmed for both short text (17 KB PNG) and multi-paragraph text (56 KB PNG) — real non-zero blob sizes, no console errors, correct disclosure message each time. |
| `npx tsc -b` | Clean, exit 0. |
| `npm test` | 16/16 Vitest tests pass. |
| `npm run build` | Succeeds — `dist/assets/index-*.js` 229.92 KB (75.30 KB gzip), `gifWorker` 18.32 KB. |

**One testing artifact, not an app bug**: batching two browser-automation clicks in the
same tool call (switch scene + open Customize) once produced a screenshot showing the
preview reverted to scene 1 with Customize open — investigated by re-running the same two
actions as isolated, sequential steps, which behaved correctly and stably both times. Read
through `App.tsx`: scene index state (`sceneIndex`) has no dependency path from the
`<details>` toggle (pure uncontrolled DOM state) back into React state, so there is no
plausible code path for opening Customize to reset the scene. Root-caused to the
browser-automation tooling issuing two rapid clicks against refs captured before either
click resolved, not a defect in the shipped code.

## Known gaps — not silently claimed as done

- **Animated-GIF-to-clipboard is unverified/unsupported on every browser tested** (only
  this session's Chromium-based preview browser). No Safari or Firefox testing has been
  done for `ClipboardItem` GIF support, the `Promise`-value `ClipboardItem` pattern, or the
  PNG fallback path. Given `image/gif` is rejected by spec-level Async Clipboard API image
  type support in Chromium, it is unlikely (not confirmed) that Safari or Firefox differ —
  this needs to be checked before advertising "Copy GIF" without qualification to users on
  those browsers.
- Click-to-toggle and drag-select + right-click were sanity-checked (chip list wiring,
  hint text presence, unchanged handler code) but not re-exercised end-to-end with a fresh
  screenshot-verified drag gesture this session — the full flow was verified end-to-end in
  the prior session ([[DEC-009-v2-long-form-architecture]]'s predecessor task, tasks
  #11/#12) and the handler code is byte-for-byte unchanged here.
- Cross-browser verification gap from [[DEC-009-v2-long-form-architecture]] is unchanged
  and still open (Safari/Firefox Canvas2D, Worker+OffscreenCanvas, `document.fonts.ready`
  timing, GIF Worker export).
- GIF output size for long-form text (up to ~3.3 MB at 1500 chars/6 scenes, per
  [[DEC-009-v2-long-form-architecture]]'s benchmark) is unchanged by this pass and still
  flagged as a concern for large emails.
