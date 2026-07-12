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

## Links
- Project map: [[animate-your-email]]
- Brain: [[Brain Map]]
