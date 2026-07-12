---
type: decision
tags: [decision, bugfix, implementation]
status: accepted
---
# DEC-008 — Fixed: staggered presets froze mid-animation (both preview and export)

**Bug reported by the user**: "sometimes animation played not completely" — the live
preview screenshot showed Typewriter stuck on "Thank y" instead of the full
"Thank you for the meeting!".

## Root cause
Both the live-preview loop's stop condition and the GIF export's per-frame time clamp
used bare `preset.entranceMs` as "how long the entrance animation takes":

```
if (elapsed < preset.entranceMs + 200) { /* keep animating */ }   // App.tsx tick()
const tMs = Math.min(tSec * 1000, preset.entranceMs)              // export renderFrame
```

`entranceMs` is one **split segment's own** animation duration (e.g. 60ms for
Typewriter — how long one character takes to pop in). For any preset with `stagger`
(11 of 30: Typewriter, Word by Word, Cascade, Decode, Pop, Bounce, Elastic, Wave,
Flip, Glitch, Sparkle), later segments don't even start until
`staggerDelayMs(preset, index, count)` has elapsed — up to `stagger.amountMs` (900ms
for Typewriter). Clamping/stopping at `entranceMs` alone (60ms) meant:
- **Live preview**: the `gsap.ticker` loop removed itself at 260ms, freezing every
  later character at whatever opacity it happened to have — for "Thank you for the
  meeting!" (26 chars) at 260ms into a 960ms full stagger, that's ~7 characters
  revealed: "Thank y". Matches the report exactly.
- **GIF export**: `tMs` never exceeded 60ms, so `sampleObject`'s `localT = tMs - delay`
  was deeply negative for any segment with `delay > 60ms` — those segments stayed at
  `progress = 0` (fully un-rendered) for every exported frame. Confirmed via
  frame-by-frame `seek()`: the pre-fix `03-typewriter-welcome-aboard.gif` was 16KB
  (barely any content); post-fix it's 79KB with the full phrase visible in the final
  frame, and text x-extent grows frame-over-frame (43→250→460→515px) instead of
  jumping straight to a fixed value.

Presets without `stagger` (Fade, Rise, Highlight, Underline, etc. — all `split: 'block'`
with a single segment) were unaffected, since `entranceMs` alone is correct when there's
only one segment and no delay spread. That's why earlier spot-checks (which happened to
land on non-staggered presets) didn't surface this.

## Fix
Added `totalEntranceMs(preset)` to `engine/sample.ts` —
`(preset.delayMs ?? 0) + preset.entranceMs + (preset.stagger?.amountMs ?? 0)` — the true
wall-clock length of the full entrance including stagger spread. Replaced every use of
bare `preset.entranceMs` as a *duration/stop-condition* with this: the preview ticker's
stop check, the export's per-frame time clamp, the export's total GIF duration
(`entranceSpanMs + holdMs`), and both decoration-progress calculations. `sampleObject`'s
internal per-segment easing math (`progress = localT / preset.entranceMs`) is unchanged
— that one correctly refers to one segment's own duration, not the total span.

## Verified (2026-07-12)
All 10 sample GIFs in `samples/` regenerated and re-verified frame-by-frame via
`PIL.Image.seek()`: every preset now reaches its correct final state in the last frame
(text x-extent checked directly, not just "some pixels changed"), and the live preview
was confirmed via screenshot to show the complete phrase 1 second after selecting
Typewriter (previously froze on a partial word). Typecheck and production build pass.

Also confirms the Neon preset's low-contrast look (white text + soft pink glow on a
white canvas) is intentional per [[DEC-006-preset-engine-v1]]'s design, not a bug —
checked while investigating this, not something to silently "fix" without a product
decision.
