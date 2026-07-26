# DEC-014 — Local effect suggestion, and polish on the ink

**Date:** 2026-07-26
**Status:** Implemented and verified
**Extends:** [[DEC-012]], [[DEC-013]]

## 1. "Suggest effects" is local, and is not called AI

The ask was an auto-suggest button where "the AI decides". Two promises stood in the way, both
of them printed on the product's own front page and README:

- *everything runs in this browser; nothing is uploaded*
- highlight detection is *deterministic, no LLM*

A model call means sending the user's email text to a third party, plus a key and a backend.
That may be a fine trade one day, but it is a product decision, not an implementation detail —
so it was put to the user, who chose the local option.

`engine/suggest.ts` matches an effect to what each phrase *is*, using signals the detector has
already extracted plus a few lexical cues:

| Signal | Mark | Why |
|---|---|---|
| Negation (`not`, `never`, `no longer`…) | Strike through | A person crosses out what is denied |
| Quotation | Brackets | Quotes get held, not highlighted |
| Figure or date | Circle | Numbers get circled |
| Call to action | Marker | The action gets the highlighter |
| Deadline language | Box | Reads as "note this" |
| Enthusiasm (`!`, `record`, `thrilled`…) | Pop / shimmer | Wants movement, not a ruled line |
| Closing sentence | Underline | |

**Negation is checked first, before category.** Otherwise "we did *not* reach 200 users" gets
its figure circled like good news — the single most embarrassing thing this feature could do.

Equally-good alternatives rotate by phrase index rather than at random, so a message with five
figures does not become five identical circles, and the same document always suggests the same
set. Every suggestion carries a `reason` which the UI shows, so the button is explicable rather
than magic. It is labelled **Suggest effects**, not "AI" — it isn't one.

## 2. Polish

Each change targets the specific thing that made an effect read as printed rather than applied:

- **Marker** gains a second, narrower pass at higher density inside the broad stroke. A
  highlighter never lays down one flat band — the tip deposits more ink along its centre line,
  and that density difference is most of what separates "highlighted" from "a coloured
  rectangle".
- **Underline** gains a thinner, lower repeat inset from both ends — where a real second pass
  of the hand actually lands.
- **Soft glow** becomes two layers, a wide dim halo plus a tight bright core. A single blur
  reads as a smudge; the falloff between two radii is what reads as light.
- **Gentle pop** gains about a degree of rotation, direction fixed per word. Pure scaling looks
  mechanical; the tilt is what makes it look like something moved rather than resized.

The marker and underline passes had to be mirrored into the SVG exporter by hand, since only
the *geometry* is shared, not the stroke list. The SVG-versus-raster zero-diff test is what
proves the mirroring is correct, and it was re-run after the change.

## Verification

- 57 unit tests (was 51), 14 E2E (was 13), lint and typecheck clean.
- Suggestion tests cover: negation beating category, each kind mapping, variety across repeats,
  determinism across two builds of the same text, only-animated-runs being touched, and every
  suggestion carrying a reason.
- E2E clicks the real button and asserts the status names what changed and why, and that the
  canvas actually changed.
- The SVG/raster zero-diff test still passes, confirming the polish reached both backends.

## 3. Three more marks

`squiggle` (proofreader's wavy underline), `arrow` (points at the phrase from below), and
`corner-marks` (crop marks around it — the only mark here that never touches the words).

The arrow is drawn **once per phrase, under its last line**. The first version drew one per
line segment, which put a shaft straight through the words of anything that wrapped — caught
by looking at the render, not by a test.

All three are in the hand-drawn family, so they share geometry with the canvas renderer and
appear in the SVG export too. `sketchWavePaths` is new: wavelength fixed in px, so a long
phrase gets more waves rather than longer ones, which is how a hand draws it.

## Known gaps

- The cues are English-only. Russian or other input falls through to the category rules, which
  still work but lose the negation and enthusiasm detection.
- Suggestion picks the effect but never decides *which phrases* should be animated — that is
  still the detector's 15%/5-phrase budget.
