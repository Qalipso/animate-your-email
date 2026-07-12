---
type: memory-index
tags: [memory, brain]
---
# Project Memory — animate-your-email

One line per durable fact. Each detailed fact is one file in [`memory/`](memory/) with
frontmatter; this index links to them. Loaded into context automatically at session start.

> Save what is **non-obvious and durable**: goals, constraints, conventions, user
> preferences, and *why*-decisions. Don't record what the code or git history already shows.

## Facts
<!-- - [Short title](memory/short-slug.md) — one-line hook -->
- [V1 product scope](memory/v1-scope.md) — single screen, 30 presets from 8 primitives, Copy to email + Download GIF
- [DEC-001: GIF is the delivery format](decisions/DEC-001-gif-first-delivery.md) — CSS is preview-only; email clients don't render CSS animation reliably
- [DEC-002: investigation findings](decisions/DEC-002-investigation-findings.md) — use `gifenc` (JS) not WASM; "Copy to email" clipboard mechanism is UNPROVEN, needs a spike as the first implementation task
- [DEC-003: stack + roadmap](decisions/DEC-003-stack-and-roadmap.md) — V1 = React+Fabric.js+GSAP+gifenc+FastAPI+Supabase; Tiptap/PixiJS/CanvasKit explicitly deferred to V1.5/V2/V3, not V1
- [DEC-004: clipboard gate results](decisions/DEC-004-clipboard-gate-results.md) — Chrome+Gmail confirmed both strategies: Gmail keeps our external img URL as-is, never re-hosts it. Outlook/Safari/manual-control paused (not verified) by user decision
- [DEC-005: privacy-first delivery pivot](decisions/DEC-005-privacy-first-delivery-pivot.md) — remote-hosted GIF behaves like a tracking pixel (confirmed by DEC-004); V1 defaults to local-only generation, "Copy animation" then "Download & insert" fallback, hosted image becomes opt-in with strict no-tracking constraints
- [DEC-006: preset engine V1](decisions/DEC-006-preset-engine-v1.md) — 30 presets from one shared primitive engine (`src/src/engine/`); documents which named effects (blur, clip-masks, gradients, 3D flip, glitch) are honest approximations, not pixel-faithful, in V1

## Links
- Project map: [[animate-your-email]]
- Brain: [[Brain Map]]
