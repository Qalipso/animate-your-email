# DEC-013 — Vector export and procedural ink materials

**Date:** 2026-07-26
**Status:** Implemented and verified (branch `feat/svg-export`, not yet merged)
**Extends:** [[DEC-012]]

## Context

Two asks: an SVG version, and "different shaders for the effects".

## Decisions

### 1. GIF stays the product; SVG is a web-only companion

SVG is stripped or refused by essentially every mail client — Gmail removes it, Outlook's Word
engine will not render it. Since the entire product is "an image for your email", an SVG
export offered as a peer of **Save GIF** would be a straightforward lie about where it works.

So: GIF remains the primary action, and the SVG button reads *"Save animated SVG (for the web,
not email)"*, with the status line repeating it after the save. For a page, a README or a
link, SVG is worth having — measured **7.5 KB against 35 KB** for the same scene as a PNG, with
19 real `<text>` elements, sharp at any zoom.

### 2. One geometry source, two backends — never two renderers

Writing an independent SVG renderer would recreate exactly the failure that produced DEC-007
and DEC-008: two codepaths that agree until they quietly don't.

Instead the sketch primitives were refactored to emit **SVG path data as their only output**.
Canvas strokes those same strings through `Path2D`; the SVG exporter emits them verbatim. Only
the animation mechanism differs — canvas draws a frame at time *t*, SVG declares CSS keyframes
over the same timeline (`pathLength="1"` plus `stroke-dashoffset`, easing matched to
`easeOutCubic`).

Guarded by an E2E test that freezes the SVG at its settled state, rasterises it, and diffs it
against the canvas PNG: **zero differing pixels**.

### 3. "Shaders" are procedural materials, not WebGL — deliberately

GPU shaders were considered and rejected for the export path. WebGL rasterises differently
across drivers and machines, so the same document would produce a different GIF on different
hardware. That breaks the invariant the entire test suite rests on — preview and export
rendering identically — and the pixel-comparison tests above could not exist. Add context loss
in a worker and headless-CI support, and the cost is real while the benefit is cosmetic.

`engine/materials.ts` instead describes each effect's ink as a **backend-neutral gradient**:
a marker that starts saturated and dries out along the word; pink that pools downward under
its own weight; a pen stroke that lightens as the hand accelerates; a strike heaviest through
the middle; pressure at the top of a circled loop. Canvas resolves these through
`createLinearGradient`, the SVG exporter emits the same stops as a `<linearGradient>` in
`userSpaceOnUse` over the same box — so both backends shade identically and the zero-diff
guarantee survives the change (re-verified after wiring).

The gradient box is computed **per phrase**, not per line segment, so a phrase that wraps gets
one continuous ink gradient instead of restarting on the second line.

## Verification

- 35 unit tests (was 30), 12 E2E (was 11), lint and typecheck clean.
- The SVG/raster zero-diff test was re-run after the materials landed and still passes — the
  materials are shared, not duplicated.
- Fresh `npm ci` in a clean worktree reproduces the whole suite.
- Visual check of all seven materials at settled state: each reads as a distinct ink.
- User text is XML-escaped; a test covers `<script>` and quote characters.

## Known gaps

- Only drawn-stroke presets animate in SVG. The particle and per-glyph presets (burn,
  wash-away, glitch, shimmer, glow, pop, weight-shift) are emitted at rest — faithful, since
  all of them settle to plain text anyway, except burn whose burnt colour is emitted
  statically. The export reports which presets it drew at rest and the UI names them.
- Grain/paper texture was considered and left out: canvas noise and SVG `feTurbulence` cannot
  be made to match pixel-for-pixel, which would have cost the zero-diff invariant. Worth
  revisiting only if that guarantee is deliberately relaxed.
- The material set is fixed per preset; it is not user-selectable.
