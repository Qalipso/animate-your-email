# animate-your-email

Turn typed text into a short animated layout — a single card, a paragraph, or a
multi-scene story — exported as a GIF, PNG, or ZIP of PNGs, for pasting into emails
(Gmail/Outlook). Three-step flow: **Paste → choose template → Copy GIF**.

## Status: V2 + simplification pass

Paste up to 1500 characters — the preview auto-generates as you type (debounced, no manual
step). The text is auto-paginated into up to 6 scenes (One Card / Paragraph / Story,
auto-selected or overridden via a small template picker), deterministic detection (no LLM)
picks what's worth animating (capped at 15% of text / 5 phrases per scene), and any word
can be clicked to toggle its animated state. **The base readable text is always visible,
from the first exported frame to the last — only the effect layer (highlight sweep,
underline, glow, shimmer, etc.) around an emphasized phrase animates.**

**Copy GIF** is the primary action (falls back to copying a static PNG with a clear message
if the browser's clipboard doesn't support writing `image/gif` — verified unsupported in
Chromium). **Save GIF** and PNG/ZIP export remain available as secondary actions. Advanced
controls (scene transition, phrase toggles) live in a collapsed Customize panel.

Full architecture and what's been verified vs. still open:
[`knowledge/decisions/DEC-009-v2-long-form-architecture.md`](knowledge/decisions/DEC-009-v2-long-form-architecture.md)
and
[`knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md`](knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md).

## Run the app

```bash
cd "src" && npm install && npm run dev
```

Other commands (run from `src/`): `npm test` (Vitest), `npm run build` (typecheck +
production build), `npm run lint`. A `/debug/presets` route renders every animation
preset against short/multiline/Cyrillic/emoji sample text for visual QA.

Part of the [AI Portal](../README.md). Uses the shared **ClaudeBrain** for methodology,
skills, agents, and commands. Project memory and notes live in `knowledge/` and are
mirrored into the shared Obsidian vault at `ClaudeBrain/vault/Projects/animate-your-email`.

## Run with Claude Code
```bash
cd ~/Documents/AI\ Portal/animate-your-email && claude
```
The brain and this project's memory load automatically on session start.

See [CLAUDE.md](CLAUDE.md) for how the brain and memory are wired.
