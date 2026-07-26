# animate-your-email

| | |
|---|---|
| **Slug** | `animate-your-email` |
| **Created** | 2026-07-11 |
| **Goal** | Turn text into a short animated image — always one frame, however long the text — for pasting into emails (Gmail/Outlook) |
| **Brain** | `~/Documents/ClaudeBrain` (shared) |
| **Knowledge (Obsidian)** | `ClaudeBrain/vault/Projects/animate-your-email` |
| **Status** | V2 architecture plus two follow-up passes, all implemented and verified: JSON document model, deterministic highlight detection, click-to-toggle, Web Worker GIF export, 63 Vitest tests and 17 Playwright E2E passing, base text always visible in every exported frame. Latest pass (DEC-011): pagination replaced by single-frame auto-fit, 2× supersampled export with a shared palette and inter-frame differencing, exact centisecond frame timing, phrase-level (not per-word) emphasis sweeps, punctuation/quote fidelity, and a two-column responsive UI with an inline effect picker and export progress. See `knowledge/decisions/DEC-009-v2-long-form-architecture.md`, `DEC-010-simplify-ui-and-always-visible-text.md` and `DEC-011-output-quality-and-one-frame.md`. |

## Stack
V2: React + plain Canvas2D/OffscreenCanvas (no Fabric.js — removed) + `gifenc` in a Web
Worker for GIF encode (2× supersampled, one shared palette, inter-frame differencing). Rendering is driven entirely by a JSON document model
(`app/src/engine/model.ts`); the model, not any canvas library, is the source of truth.
Rationale: `knowledge/decisions/DEC-009-v2-long-form-architecture.md`. V1's stack pick
(Fabric+GSAP) is superseded, see `knowledge/decisions/DEC-003-stack-and-roadmap.md` for
history.

## Scope
Paste text → pick a template (Auto / Card / Paragraph / Story) → **Copy GIF** (primary
action). However much text is pasted, it is fitted into a single frame — the frame grows
taller up to MAX_FRAME_HEIGHT and only then does the type step down, never below
MIN_READABLE_FONT_PX. Deterministic highlight detection picks what to animate (capped at
15% of text / 5 phrases, adjustable via click-to-toggle and a drag-select effect picker),
and the base readable text is always visible in every frame — only the effect layer around
emphasized phrases animates. Save GIF and a still-PNG export are the secondary actions. Copy-to-email as an `<img>`
HTML-snippet clipboard mechanism (a separate concept from Copy GIF's image-blob copy)
remains unproven/out of scope, see `knowledge/decisions/DEC-002-investigation-findings.md`
and `knowledge/decisions/DEC-005-privacy-first-delivery-pivot.md`. No OAuth, AMP, cloud
hosting, accounts, or sending — by design.
