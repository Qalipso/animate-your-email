# Spec — Particle & voxel stage

**Status:** `[Planned]` — specification only, nothing here is implemented.
**Date:** 2026-07-26
**Depends on:** [DEC-010], [DEC-011], [DEC-012], [DEC-013]

Text that assembles, explodes, crumbles, and is driven by physics — every effect decomposed
into particles, with an optional voxel (3D) layer.

---

## 0. The decision this spec cannot make for you

The project's central promise, held since DEC-010 and enforced by a test, is:

> The base text is fully readable in **every** frame, from the first to the last. Only the
> effect layer animates.

`Pixelate` and `Assemble-from-Blur` were **deleted** for breaking it. An E2E test
(`the text is fully readable in the very first frame`) asserts frame zero has at least 85% of
the final frame's ink and fails the build otherwise.

Text that assembles, explodes or crumbles breaks this by definition. That is not an argument
against building it — it is a product decision that has to be made deliberately, because the
promise exists for a reason: **a GIF in an email is often seen for one second, in a preview
pane, possibly with animation suppressed.** A recipient who sees only frame one of an
"assemble" effect sees scattered dust where the message should be.

Two viable resolutions:

| | Approach | Consequence |
|---|---|---|
| **A** (recommended) | Two modes: **Readable** (today's behaviour, default) and **Cinematic** (particles). Frame-zero test scoped to Readable. | Both promises stay true; the UI must say which mode is which and what it costs. |
| **B** | Particles allowed everywhere; drop the invariant. | Simpler code, but the product can no longer claim readability, the README claim must go, and the test is deleted rather than scoped. |

**Everything below assumes A.** If B is chosen, §1.2 and §8.2 change.

---

## 1. Scope

### 1.1 In scope
- A deterministic particle system: emitters, forces, integration, lifetime, deterministic seeding.
- A particle **source** that samples glyph coverage, so particles are the text rather than decoration next to it.
- An effect catalogue built on it (§4).
- An optional voxel layer (§5): particles as depth-sorted 3D cells with flat shading.
- Export of all of it through the existing GIF path, within a defensible file-size budget (§6).
- A `Cinematic` document mode and the UI to reach it (§7).

### 1.2 Out of scope
- Changing the Readable mode's behaviour or its guarantees.
- GPU/WebGL execution — rejected in DEC-013 and still rejected here (§3.2).
- SVG export of particle effects — a per-frame particle field has no compact vector form. The SVG exporter must report particle presets as `staticPresets` (mechanism already exists) and emit the settled frame.
- Real collision detection between particles. Forces and constraints only.

---

## 2. Particle model

```
Particle {
  x, y, z          position (z unused in 2D mode, drives the voxel layer)
  vx, vy, vz       velocity
  homeX, homeY     the position it belongs at when the text is intact
  size             px (2D) / voxel edge (3D)
  tone             index into the effect's tone ramp, not a free colour
  seed             deterministic per-particle value in [0,1)
  born, life       ms, relative to the phrase's own clock
}
```

**Source.** Particles are sampled from the rasterised glyphs of a phrase, not scattered
freely: render the phrase to an offscreen bitmap at the export resolution, then sample on a
grid of `density` px, keeping cells whose coverage exceeds a threshold. This gives particles
that genuinely *are* the letterforms, and it reuses the existing layout — no second text
metrics path.

**Budget.** Particle count must be bounded by area, not by word count:
`count = clamp(round(coveredPixels / density²), 0, MAX_PARTICLES)` with `MAX_PARTICLES = 4000`
per phrase and `12000` per frame. Over budget, increase `density` rather than dropping
particles, so the letterform stays legible in the settled state.

---

## 3. Simulation

### 3.1 Integration
Fixed-timestep semi-implicit Euler at the export frame rate (currently 50 ms), so the
simulation advances in exactly the steps the GIF will show. **No wall-clock deltas** — the
preview must be able to seek to any time and produce the same frame the export produces.

Because the preview can be scrubbed and the export renders frames in order, the simulator must
be **replayable from t = 0**: `stateAt(t)` either simulates forward from a cached earlier state
or from zero. Do not retain a single mutable simulation as the source of truth.

Forces, composable per effect: `gravity`, `radialImpulse(origin, strength)`, `drag`,
`turbulence(seededNoise)`, `spring(home, k, damping)`, `vortex(origin, strength)`,
`wind(direction)`.

### 3.2 Determinism — a hard requirement, not a preference
Preview and export must render byte-identically; this is what every pixel-comparison test in
the suite rests on. Therefore:

- All randomness through `seededRandom(seed)` from `engine/sketch.ts`. **`Math.random()` is forbidden.**
- No `Date.now()` / `performance.now()` inside the simulation.
- No floating-point accumulation that differs by evaluation order — sum forces in a fixed declared order.
- No GPU. WebGL rasterises differently across drivers, so the same document would export differently on different machines (DEC-013).

**Acceptance:** simulating the same document twice, and simulating it forward vs. seeking to
the same `t`, must produce identical particle arrays (exact float equality).

---

## 4. Effect catalogue

Each is a preset id, following the existing `EmphasisPresetId` pattern, and declares
`phase: 'in' | 'out' | 'loop'` — whether the text ends up intact, destroyed, or returns.

| Preset | Behaviour | Ends |
|---|---|---|
| `assemble` | Particles fly in from off-frame edges, spring to `home`, settle | intact |
| `explode` | Radial impulse from the phrase centre, gravity + drag | destroyed |
| `crumble` | Particles detach top-down under gravity, slight turbulence | destroyed |
| `dissolve` | Particles drift up, fade by lifetime, no impulse | destroyed |
| `sand` | Gravity, particles pile at the baseline instead of leaving frame | destroyed |
| `magnetise` | Particles scatter, then spring back — a shake that recovers | intact |
| `shatter` | Glyphs break into angular shards (Voronoi-ish cells), not a uniform grid | destroyed |
| `swarm` | Particles orbit `home` with vortex + spring; text stays legible throughout | intact |

`swarm` and `magnetise` are the only two usable in **Readable** mode, since the text remains
resolvable at every frame. The rest are Cinematic-only. This must be enforced in the type
system, not by convention.

---

## 5. Voxel layer

Optional per-effect flag `voxel: true`.

- Particles gain `z`, sampled as a slab: `depth` cells deep, so a glyph becomes a 3D extrusion.
- **Orthographic** projection with a fixed camera (no perspective controls in v1) — a small
  yaw/pitch, animated or static, is enough to read as dimensional.
- Painter's algorithm: sort by `z` descending, draw each voxel as a filled quad (top face,
  side face) — 2–3 flat tones per voxel, no smooth shading.
- Lighting: a single fixed directional light producing exactly the tone ramp; no per-pixel
  lighting.

**Why flat tones matter:** GIF has 255 usable colours (one is reserved for inter-frame
transparency). Smooth shading over thousands of voxels would exhaust the palette and band
visibly. A **declared tone ramp of ≤ 8 tones per effect** keeps quantisation clean and is a
hard constraint, not a stylistic choice.

Voxel rasterisation is CPU-side into the existing 2× supersampled canvas. Expect it to be the
most expensive thing in the pipeline; §8 sets the budget.

---

## 6. Export — the real constraint

**This is the section that decides whether the feature is shippable.**

Today's GIF is small because almost nothing changes between frames: inter-frame differencing
writes only changed pixels as a transparent index, taking a 2-scene story from 1.9 MB to
326 KB (DEC-011). A full-frame particle field changes **every pixel every frame**, so
differencing collapses to nothing and the file returns to full frames.

> **Superseded by measurement — see §12.** The estimate below was made before the spike and was
> wrong for the common case. Kept for the record; §12 has the real numbers.

Measured baseline: full frames cost ~16 KB/frame at 600×360. At 600×451, ~20 KB/frame.
An 80-frame particle animation would land near **1.6 MB** — far past what an email will carry.

Required mitigations, in order of leverage:

1. **Bound particles to the phrase's own box.** Particles must not be allowed to cross the
   whole frame; clamp them to the phrase's bounding box plus a margin (default 1.5× the box).
   The rest of the image stays static, so differencing still works on most of the frame. This
   single constraint is what makes the feature viable and should be treated as non-negotiable.
2. **Per-frame delay.** The encoder already writes `delay` per frame. Particle phases can run
   at 20 fps while the settled hold runs at 2–5 fps, cutting frame count sharply.
   `gifExport.snapDelayMs` currently assumes a uniform delay and must be generalised.
3. **Reduced palette during particle phases** — 64–128 colours instead of 255. With a declared
   tone ramp (§5) this costs nothing visually.
4. **Shorter phases.** Particle motion reads in 400–700 ms; longer adds bytes, not meaning.

**Acceptance:** a single-phrase Cinematic export at default settings must be **≤ 600 KB**, and
the exporter must refuse (with a clear message, not silently) above 1.5 MB.

---

## 7. Data model & UI

### 7.1 Model
- `AnimatedDocument.renderMode: 'readable' | 'cinematic'` (default `'readable'`).
- `EmphasisPresetId` extended with the §4 ids; particle presets carry `phase` and `voxel`.
- A compile-time split so Cinematic-only presets are unassignable in Readable mode — e.g.
  `ReadablePresetId` as a subset union, with the document generic over its mode.
- Particle presets need their own timing: a phrase's duration becomes `attack + hold + release`
  rather than a single 900 ms sweep. `SceneTiming` gains per-phase values.

### 7.2 UI
- Mode switch near the template picker, labelled by what it costs, not by jargon —
  e.g. *"Readable — text stays legible in every frame"* / *"Cinematic — text assembles and
  breaks apart; a recipient who only sees the first frame will not be able to read it."*
- Cinematic effects appear in the picker only in Cinematic mode.
- The existing speed / hold sliders apply unchanged.
- Predicted file size shown **before** export in Cinematic mode, since it is the constraint the
  user will actually hit.

---

## 8. Testing

### 8.1 New
- Determinism: two simulations of the same document produce identical particle arrays; seeking
  to `t` equals simulating forward to `t`.
- Budget: particle count never exceeds the caps; a 1500-character document does not exceed the
  per-frame cap.
- Containment: no particle leaves its phrase's clamp box (this is what protects file size).
- Export size: Cinematic default ≤ 600 KB; oversize refusal path is exercised.
- Settled state: an `intact`-ending effect's final frame equals the Readable render of the same
  document within quantisation tolerance.

### 8.2 Existing, to be scoped — not deleted
- `the text is fully readable in the very first frame` becomes Readable-mode only, with a
  Cinematic counterpart asserting the *final* frame is fully readable for `intact` effects.
- The SVG/raster zero-diff test stays as-is; particle presets are excluded via `staticPresets`.

---

## 9. Performance budget

| Stage | Budget |
|---|---|
| Sampling glyphs → particles | ≤ 50 ms per phrase, once per document build |
| Simulation step | ≤ 2 ms per frame at 4000 particles |
| 2D raster of a frame | ≤ 8 ms at 2× supersample |
| Voxel raster of a frame | ≤ 25 ms at 4000 voxels |
| Full Cinematic export | ≤ 8 s wall clock for a single-phrase document |

Export already runs in a worker and reports progress; the progress bar must stay honest
(currently 20% palette / 80% encode — simulation needs a third weighted segment).

---

## 10. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| File size makes the feature unusable in email | **High** | §6; treat the containment rule as non-negotiable and measure before building the effect catalogue |
| Readability promise lost across the whole product | **High** | Mode split (§0 A); never let a Cinematic preset be reachable in Readable mode |
| Float non-determinism between preview and export | Medium | Fixed declared force order; exact-equality determinism test |
| Palette banding from voxel shading | Medium | ≤ 8 declared tones per effect |
| Encode time regression | Medium | Per-frame delay + reduced palette; budget in §9 |
| Scope: 8 effects × 2D/voxel is a large surface | Medium | Phasing (§11) — prove one effect end to end first |

## 11. Phasing

1. **Spike (throwaway):** one effect (`explode`), 2D only, no UI — measure the real GIF size
   with and without containment. **Go/no-go on §6 before anything else is built.**
2. Particle core + determinism tests + glyph sampling.
3. Mode split in the model and UI, with the existing test scoped.
4. 2D effect catalogue (§4).
5. Per-frame delay and reduced palette in the encoder.
6. Voxel layer.
7. Samples regenerated; README and ROADMAP updated with measured numbers.

**Do not start at step 2.** Step 1 is cheap and can kill the feature honestly.

---

## 12. Spike results — `explode`, measured 2026-07-26

Step 1 was run: a throwaway `explode`, 2D, no UI, no code committed, encoded through the **real**
`exportGif` (2× supersample, shared palette, inter-frame differencing) at 600×400 / 600×489.
Particles sampled from the rasterised glyphs; closed-form trajectory so the encoder's
out-of-order palette pass stays seekable.

**Phrase-scoped explode** — only the emphasised phrase becomes particles, the rest of the text
stays put:

| Case | Particles | Contained | Free |
|---|---|---|---|
| One phrase | 945 | **77 KB** | 103 KB |
| Long text, all phrases | 4 290 | **238 KB** | 368 KB |

**Whole-text explode** — every glyph in the frame becomes particles:

| Case | Particles | fps | Size |
|---|---|---|---|
| Short card | 5 880 | 20 | **346 KB** |
| Long text, 1px particles | 26 857 | 20 | **1 266 KB** |
| Long text, 2px particles | 6 723 | 20 | 879 KB |
| Long text, 1px, 12.5 fps | 26 857 | 12.5 | 796 KB |

Encode time stayed between 230 ms and 680 ms throughout — performance is not the problem.

### Verdict

**GO for phrase-scoped particles.** At 77–368 KB they sit in the same range as today's GIFs
(24–240 KB) and need no special pleading.

**CONDITIONAL for whole-text explode.** Short text is fine at 346 KB. Long text is 0.8–1.3 MB,
which is past the §6 budget and needs both coarser particles and a lower frame rate to come
back — and even then it sits at the edge. Gate it on predicted size and refuse politely, or cap
it by text length.

### Corrections to this spec

1. **§6's premise was wrong.** Containment is worth only 25–35%, not the difference between
   viable and not. Particles are sparse dots, so differencing keeps working across most of the
   frame even when they fly freely. The real levers, in order, are **particle size**, **whether
   the whole text or one phrase explodes**, and **frame rate**. §6.1 should be demoted from
   "non-negotiable" to "worth having".
2. **Coarser particles are both cheaper and better-looking.** At 1 px and ~27 000 particles the
   effect reads as smoke, not debris — the letterforms turn to uniform grey mush. Larger shards
   (2–4 px, or Voronoi cells per §4 `shatter`) would look more like an explosion *and* cut the
   file by ~30%. The cheap option is the better one; §2's `density` default should be 2–3, not 1.
3. **Readability collapses within ~200 ms of the effect starting** — confirmed visually at
   t=430 ms, where the text is already illegible. This removes any doubt about §0: the mode
   split is mandatory, not a nicety. A recipient seeing a preview-pane still of a Cinematic GIF
   gets dust.

### Not yet measured
- Voxel rasterisation cost and its palette pressure (§5) — the spike was 2D only.
- `assemble` (reverse trajectory): should be symmetric in size, but its **first** frame is the
  scattered state, which is the worst case for a preview-pane still.
- Per-frame variable delay (§6.2) — the 12.5 fps row above lowered the rate uniformly rather
  than only during the particle phase.

---

[DEC-010]: ../../knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md
[DEC-011]: ../../knowledge/decisions/DEC-011-output-quality-and-one-frame.md
[DEC-012]: ../../knowledge/decisions/DEC-012-annotation-effects-and-tempo.md
[DEC-013]: ../../knowledge/decisions/DEC-013-svg-export-and-procedural-materials.md
