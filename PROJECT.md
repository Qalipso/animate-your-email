# animate-your-email

| | |
|---|---|
| **Slug** | `animate-your-email` |
| **Created** | 2026-07-11 |
| **Goal** | Turn typed text into a short animated GIF for pasting into emails (Gmail/Outlook) |
| **Brain** | `~/Documents/ClaudeBrain` (shared) |
| **Knowledge (Obsidian)** | `ClaudeBrain/vault/Projects/animate-your-email` |
| **Status** | V1 vertical slice implemented (2 of 30 presets, Download GIF only — `src/`) |

## Stack
V1: React + Fabric.js (editable text-on-canvas) + GSAP/SplitText (animation) + `gifenc`
(GIF encode, Web Worker) + FastAPI + Supabase Storage (asset hosting only, rendering
stays client-side). Full rationale + V1.5/V2/V3 roadmap: `knowledge/decisions/DEC-003-stack-and-roadmap.md`.

## Scope
V1: one text block, ≤3 lines, block-level styling, 30 declarative presets, GIF export,
Copy to email (mechanism unproven — see `knowledge/decisions/DEC-002-investigation-findings.md`).
Details: `knowledge/memory/v1-scope.md`.
