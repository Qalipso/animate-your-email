---
type: decision
tags: [decision, architecture, stack]
status: accepted
---
# DEC-003 — Stack pick for V1 + V1.5/V2/V3 roadmap

Resolves `PROJECT.md`'s "Stack: TBD". Source: user's own architecture analysis
(2026-07-11) of the kinetic-typography solution space — a parametric constructor
(target × property × distribution × easing × masks/filters) rather than N hardcoded
effects, expressed as three parallel text representations:

```
Rich Text Model → Text Layout/Glyph Shaping → Scene Graph → Animation Tracks → Preview → Export
```

## V1 stack (this is what actually gets built first)
`React + Fabric.js + GSAP + gifenc + FastAPI + Supabase Storage`

- **Fabric.js** — `IText`/`Textbox` gives editable-text-on-canvas (cursor, selection,
  wrapping, scaling, serialization) without hand-building a text editor. Fastest path to
  an MVP; documented limitation: per-character animation still needs temporarily
  exploding text into separate objects.
- **GSAP (+ SplitText, free since 3.13)** — the animation engine; splits text into
  lines/words/chars with auto re-split on resize, drives timelines/stagger/easing.
  Chosen over Anime.js/Motion for the breadth of stagger + timeline control this product
  needs long-term.
- **gifenc** — already decided in [[DEC-002-investigation-findings]]; author notes it's
  tuned for flat-style vector graphics (exactly our case), not photos.
- **FastAPI + Supabase Storage** — backend is intentionally thin for V1: auth-free
  project/asset storage and the immutable GIF hosting from [[DEC-001-gif-first-delivery]].
  Not a rendering server — rendering stays client-side (Fabric/GSAP/gifenc in a Worker).

## V1 scope (unchanged from [[v1-scope]], now with the stack that builds it)
One text block, max 3 lines, block-level styling only (no per-word styling yet),
character/word-level *splitting* for animation purposes only, 30 presets, 5 user-facing
controls (Speed/Energy/Order/Amount/Loop → mapped internally to GSAP params), GIF export,
Copy to email.

## Preset data model
Presets are declarative documents, not functions — `{split, entrance, idle, exit}` with
target/order/stagger/easing fields — so new presets are data, not code. This is additive
detail on [[v1-scope]], no scope change.

## Deferred — NOT V1, do not build yet
| Phase | Adds |
|---|---|
| V1.5 | word/char-level selection + per-run styling → **Tiptap** (structured doc + marks) replaces plain text input; text-on-path; stroke-draw via **OpenType.js** glyph outlines; variable fonts; animated gradients; masks; glow/glitch |
| V2 | multiple text blocks/layers, draggable canvas, custom animation builder (entrance/idle/exit authoring UI), user-saved presets, PNG/WebP/MP4 export, brand kits, server-side rendering |
| V3 | **CanvasKit/Skia** + **HarfBuzz** for production-grade multilingual shaping, when Fabric/GSAP's DOM+Canvas2D approach hits a wall (complex scripts, ligatures, mixed languages) |

Explicitly rejected as the V1 foundation: Konva (great scene graph, not a text editor —
fits V2 layer work), PixiJS (best for the heavy filter/shader effects in V1.5+, overkill
for 30 flat presets), Polotno/CE.SDK (ready-made editor SDKs — traded off against owning
the kinetic-typography engine, which is the actual product differentiator here).

## Why not build V1.5/V2 features now
Recorded V1 scope already caps complexity deliberately (see [[v1-scope]]: "no timeline,
no layers, no keyframe editor"). This doc's own §14 V1 list matches that — the elaborate
three-representation architecture is the *end-state* model info, not a V1 requirement.
Building Tiptap/PixiJS/CanvasKit now would be scope creep against an already-agreed V1.
