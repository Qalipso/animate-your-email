---
type: decision
tags: [decision, implementation, engine]
status: accepted
---
# DEC-006 — V1 preset engine: primitive set, and which of the 30 named effects are approximated

Implements the "30 presets from one parametric engine, not 30 one-off implementations"
idea from the original concept doc and [[DEC-003-stack-and-roadmap]]. Code:
`src/src/engine/` (`types.ts`, `easing.ts`, `sample.ts`, `textSplit.ts`, `presets.ts`).

## The primitive set actually shipped
`split` (block/word/character) × per-segment `{opacity, x, y, scale, rotate, fill,
glowColor, glowBlur}` × `stagger` (forward/reverse/random/center-out + amountMs) ×
`ease` × optional `oscillation` (decaying sine on one channel — powers Shake/Wave/Glitch
jitter) × optional `colorFlicker` (deterministic per-frame color flip — powers
Decode/Glitch) × optional `decoration` (an underline/highlight-bar rect).

**One pure function, `sampleObject(preset, index, count, tMs)`, is the single source of
truth** — the live preview (driven by a `gsap.ticker` loop) and the GIF frame export both
call it with the same inputs, so preview and export cannot drift apart. This mattered
more than routing every tween through GSAP's own tweening API, which would have meant
two parallel animation implementations to keep in sync.

## Deliberately NOT implemented (approximated instead)
The concept doc named specific mechanisms this engine doesn't have. Each affected preset
carries an inline comment; listed here for one place to check honesty against the
original spec:
- **True blur** (Focus) — canvas Text objects have no easy per-object blur filter in
  Fabric; simulated with a scale settle instead.
- **Letter-spacing / tracking animation** (Tracking) — simulated with a uniform scale
  settle, not real per-character spacing.
- **Clip-path wipes/masks** (Mask Reveal, Split Reveal) — simulated with
  scale/opacity, not an actual growing clip region.
- **3D perspective flip** (Flip) — simulated with 2D rotation, no perspective transform.
- **RGB-split / scanline glitch** (Glitch) — simulated with color-flicker + x-jitter.
- **Sweeping specular highlight** (Shine) — simulated as a brief flash.
- **Moving multi-stop gradient text** (Gradient) — simulated as a two-color sweep
  (solid color lerp, not a real gradient fill).
- **Scramble-to-real-text decode** (Decode) — simulated with color flicker + settle,
  not actual glyph substitution.

None of these are silently passed off as the full effect — every simplification has a
one-line comment at its preset definition in `presets.ts`. If any of these need to be
"real" later (V1.5+), the primitive set will need extending (a `clipReveal` channel, a
per-object blur filter, true gradient fills) — tracked here as a known gap, not
rebuilt from scratch, since the split/stagger/sample architecture already supports it.

## Verified (2026-07-12)
Typecheck and production build pass. Manually exercised in-browser: default 5 presets
render correctly; drawer opens all 30 across 6 categories; Glitch (character split +
colorFlicker + oscillation) and Underline (decoration path) both export valid GIFs
(`GIF89a` header, correct dimensions, sizes 58–61KB — under the 800KB target from
DEC-002) with no console errors. Not exhaustively tested: all 30 presets individually,
only representative ones covering each code path.
