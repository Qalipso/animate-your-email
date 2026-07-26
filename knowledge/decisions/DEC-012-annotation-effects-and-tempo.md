# DEC-012 — Hand-drawn annotation effects and tempo controls

**Date:** 2026-07-26
**Status:** Implemented and verified
**Extends:** [[DEC-011]]

## Context

Two asks: make the animations more interesting (with Pinterest named as the place to look for
references), and expose speed controls. A third arrived mid-work: drop the "Advanced"
disclosure from the compose panel.

**Pinterest was not reachable** from this environment — navigation to `pinterest.com` and
`ru.pinterest.com` was denied outright, so no pins were reviewed. The direction below is
grounded in a web search instead, which converged hard on one answer: the canonical vocabulary
for "make this text interesting" is the [Rough Notation](https://roughnotation.com/) set —
highlight, underline, box, circle, strike-through, bracket, crossed-off — all drawn as if by
hand. Recording this because the reference basis is weaker than a real visual survey would
have been.

## Decisions

### 1. A hand-drawn annotation family, implemented natively

Rough Notation itself is not usable here: it annotates DOM elements with SVG, and this app's
output is a rasterised GIF produced in a worker. The *look* is what transfers, so
`engine/sketch.ts` implements the primitives directly on canvas:

- `sketchLine` — bows off the true path and is drawn twice with different jitter
- `sketchEllipse` — sinusoidal wobble plus a deliberate 12% oversweep past the start, the way
  a circled word usually overshoots
- `sketchRect` — drawn edge by edge along the perimeter, so it reads as being drawn

All are pure functions of a seed string via a small deterministic PRNG. `Math.random()` would
break the invariant that preview and export render byte-identical frames — the exact failure
mode behind DEC-007/DEC-008.

New presets: **Circle It**, **Box It**, **Brackets**, **Strike Through**. Existing
**Marker Highlight** and **Underline Draw** were rebuilt on the same primitives — the marker
is now a thick round-capped stroke rather than a `fillRect`, which was the most
machine-looking thing on screen.

Multi-line phrases get one annotation per line segment (a single ellipse around a phrase that
wrapped would swallow the lines between).

Tuned after looking at the rendered output: boxes need ~1.9× the roughness of curved strokes
before the wobble reads at all, and brackets needed 0.34em of clearance — at 0.18em they
collided with the neighbouring word.

### 2. Tempo lives on the document, and is applied by mutation

`speed` (0.5×–2×) and `holdMs` (0–2500ms) are fields on `AnimatedDocument`, not component
state. The export worker only ever receives the document; anything the preview honours but the
export does not is a bug waiting to happen.

`computeSceneTiming` scales the lead-in, each phrase's duration, and the stagger together, so
the animation keeps its proportions at any tempo rather than only the emphasis speeding up.

**Slider changes mutate the existing document and bump `version`; they do not rebuild it.**
`buildAnimatedDocument` re-runs highlight detection from scratch, which would discard every
word the user toggled and every effect they picked. A tempo slider must never do that. The
build effect reads the current slider values through refs so a rebuild triggered by a *text*
change still picks them up.

Values are clamped inside `buildAnimatedDocument` rather than trusted from the caller, since
the document is what crosses into the worker.

### 3. "Advanced" removed

The disclosure is gone; the animated-phrase chips now sit directly in the compose panel, and
the tempo sliders sit next to the preview with the resulting loop length beside them — the
number that decides whether the GIF is email-friendly.

## Verification

- `npm run test:unit` — 30 passed (was 22). New: tempo scales every part proportionally, hold
  adds to the loop without touching the animation, out-of-range values are clamped, the PRNG
  is deterministic per seed, and each annotation preset draws strokes rather than fills.
- `npm run test:e2e` — 11 passed (was 9). New: the speed slider halves the *exported* frame
  count, and the hold slider adds exactly 40 frames (2000ms ÷ 50ms) of the same settled image.
- Measured in-browser end to end: 0.5× → 4.4s/88 frames, 1× → 2.2s/44, 2× → 1.1s/22;
  hold 0 → 1.4s, hold 2500 → 3.9s; `speed: 99` clamps to 2, `holdMs: -500` clamps to 0.
- The marker-highlight regression test was rewritten against stroked paths (the mock canvas now
  records them) — it asserts every marker stroke spans its whole line of the phrase and none is
  word-sized, which is stricter than the old fill-count check.

## Known gaps

- The annotation look was tuned by eye against rendered output, not against a real design
  reference set. If Pinterest or a similar survey becomes available, the roughness and colour
  choices are the first things worth revisiting.
- `crossed-off` from the Rough Notation set was skipped: it overlaps strike-through and box
  closely enough not to earn a slot in a picker that is already 14 items.
