# animate-your-email

| | |
|---|---|
| **Slug** | `animate-your-email` |
| **Created** | 2026-07-11 |
| **Goal** | Turn text into a short animated layout — a single card, a paragraph, or a multi-scene story — for pasting into emails (Gmail/Outlook) |
| **Brain** | `~/Documents/ClaudeBrain` (shared) |
| **Knowledge (Obsidian)** | `ClaudeBrain/vault/Projects/animate-your-email` |
| **Status** | V2 implemented and export/visual-quality verified: JSON document model, deterministic highlight detection, multi-scene pagination, click-to-toggle, Web Worker GIF export, PNG/ZIP export, 16 Vitest tests passing. All 12 animation presets manually QA'd (2 real bugs found and fixed). See `knowledge/decisions/DEC-009-v2-long-form-architecture.md` for what's verified vs known gaps. |

## Stack
V2: React + plain Canvas2D/OffscreenCanvas (no Fabric.js — removed) + `gifenc` in a Web
Worker for GIF encode. Rendering is driven entirely by a JSON document model
(`src/src/engine/model.ts`); the model, not any canvas library, is the source of truth.
Rationale: `knowledge/decisions/DEC-009-v2-long-form-architecture.md`. V1's stack pick
(Fabric+GSAP) is superseded, see `knowledge/decisions/DEC-003-stack-and-roadmap.md` for
history.

## Scope
Paste up to 1500 characters → auto-paginate into up to 6 scenes (One Card / Paragraph /
Story, auto-selected or overridden) → deterministic highlight detection picks what to
animate (capped at 15% of text / 5 phrases per scene) → click any word to toggle its
animated state → Download GIF (multi-scene, with transitions) or export PNG/ZIP (one PNG
per scene). Copy-to-email clipboard mechanism remains unproven/out of scope, see
`knowledge/decisions/DEC-002-investigation-findings.md` and
`knowledge/decisions/DEC-005-privacy-first-delivery-pivot.md`. No OAuth, AMP, cloud
hosting, accounts, or sending — by design.
