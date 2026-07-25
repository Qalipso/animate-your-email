# animate-your-email

Turn typed text into a short animated image — a single frame, however much text you paste —
exported as a GIF or a still PNG, for pasting into emails (Gmail/Outlook). Three-step flow:
**Paste → choose a size → Copy GIF**.

## Status: V2 + output-quality and UI pass

Paste up to 1500 characters — the preview auto-generates as you type (debounced, no manual
step). **Everything you paste is fitted into one frame**: the frame grows taller (up to
1000px) and, only if that ceiling is reached, the type steps down — never below 16px. There
is no pagination and no scene navigation. Deterministic detection (no LLM) picks what's
worth animating (capped at 15% of the text / 5 phrases), any word can be clicked to toggle
it, and dragging across a phrase opens an inline effect picker. **The base readable text is
always visible, from the first exported frame to the last — only the effect layer (highlight
sweep, underline, glow, shimmer, etc.) around an emphasized phrase animates.**

**Copy GIF** is the primary action (falls back to copying a static PNG with a clear message
if the browser's clipboard doesn't support writing `image/gif` — verified unsupported in
Chromium). **Save GIF** and a still-PNG export are the secondary actions.

Full architecture and what's been verified vs. still open:
[`knowledge/decisions/DEC-009-v2-long-form-architecture.md`](knowledge/decisions/DEC-009-v2-long-form-architecture.md),
[`knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md`](knowledge/decisions/DEC-010-simplify-ui-and-always-visible-text.md)
and
[`knowledge/decisions/DEC-011-output-quality-and-one-frame.md`](knowledge/decisions/DEC-011-output-quality-and-one-frame.md).

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
