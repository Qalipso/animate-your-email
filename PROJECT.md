# animate-your-email

| | |
|---|---|
| **Slug** | `animate-your-email` |
| **Created** | 2026-07-11 |
| **Goal** | Turn text into a short animated layout — a single card, a paragraph, or a multi-scene story — for pasting into emails (Gmail/Outlook) |
| **Brain** | `~/Documents/ClaudeBrain` (shared) |
| **Knowledge (Obsidian)** | `ClaudeBrain/vault/Projects/animate-your-email` |
| **Status** | V2 architecture + a UI-simplification/animation-behavior pass, both implemented and verified: JSON document model, deterministic highlight detection, multi-scene pagination, click-to-toggle, Web Worker GIF export, PNG/ZIP export, 16 Vitest tests passing, base text now always visible in every exported frame (only effect layers animate), Copy GIF is the primary CTA with a disclosed static-PNG clipboard fallback. See `knowledge/decisions/DEC-009-v2-long-form-architecture.md` and `knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md` for what's verified vs known gaps. |

## Stack
V2: React + plain Canvas2D/OffscreenCanvas (no Fabric.js — removed) + `gifenc` in a Web
Worker for GIF encode. Rendering is driven entirely by a JSON document model
(`src/src/engine/model.ts`); the model, not any canvas library, is the source of truth.
Rationale: `knowledge/decisions/DEC-009-v2-long-form-architecture.md`. V1's stack pick
(Fabric+GSAP) is superseded, see `knowledge/decisions/DEC-003-stack-and-roadmap.md` for
history.

## Scope
Paste text → pick a template (Auto / Card / Paragraph / Story) → **Copy GIF** (primary
action). Text auto-paginates into up to 6 scenes for long input, deterministic highlight
detection picks what to animate (capped at 15% of text / 5 phrases per scene, adjustable
via click-to-toggle in the collapsed Customize panel), and the base readable text is always
visible in every frame — only the effect layer around emphasized phrases animates. Save GIF
and PNG/ZIP export remain available as secondary actions. Copy-to-email as an `<img>`
HTML-snippet clipboard mechanism (a separate concept from Copy GIF's image-blob copy)
remains unproven/out of scope, see `knowledge/decisions/DEC-002-investigation-findings.md`
and `knowledge/decisions/DEC-005-privacy-first-delivery-pivot.md`. No OAuth, AMP, cloud
hosting, accounts, or sending — by design.
