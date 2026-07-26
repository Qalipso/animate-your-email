# Roadmap — what production readiness would still require

The app is deliberately scoped as a portfolio-grade tool: it does one thing, in the browser,
with no backend. This file exists so the gap between that and a production product is
written down rather than implied. Nothing here is [Implemented].

## Done in the portfolio iteration (2026-07-25)

| Item | Evidence |
|---|---|
| CI on every push | [`ci.yml`](../.github/workflows/ci.yml) — lint, types, 22 unit tests, 9 browser E2E |
| Browser E2E | [`app/e2e/`](../app/e2e) — drives the production build and inspects the GIF/PNG it downloads |
| Honest export UX | Clipboard capability probed on load; buttons labelled for what they actually do |
| Demo deployment | [`deploy.yml`](../.github/workflows/deploy.yml) → GitHub Pages |
| Repository cleanup | `src/src` → `app/src`, Vite boilerplate removed, `samples/` regenerated from the current engine |

## [Planned] — required before calling this a product

### 1. Proven Gmail / Outlook rendering

**Not verified today.** The clipboard investigation ([DEC-002], [DEC-004]) established what
the *clipboard* accepts; it did not establish how a pasted or attached GIF renders across
mail clients. Outlook Web was never tested at all — the spike was blocked with no logged-in
account.

Needs: a real matrix run against Gmail (web, iOS, Android), Outlook (web, Windows desktop,
Mac desktop), Apple Mail, and at least one corporate Exchange setup — checking that the GIF
animates rather than showing frame one, that it is not downscaled or re-encoded, and that
size limits are not silently hit. Outlook desktop's Word rendering engine is the known risk:
it historically shows only the first frame.

Until that exists, the README must not claim compatibility it has not measured.

### 2. Accessibility

Partially addressed (focus-visible treatment, `prefers-reduced-motion` for the preview loop,
`aria-pressed`/`aria-label` on controls, a progress bar with proper roles) but **not audited**
against WCAG 2.2 AA. Known gaps:

- The canvas is the primary editing surface and is **keyboard-inaccessible** — word toggling
  and phrase selection are mouse-only. Needs a real alternative: a focusable word list, or
  arrow-key traversal with an accessible name per word.
- Drag-select does not work on touch at all.
- No screen-reader account of what the animation does; the preview is an opaque canvas.
- Colour contrast of the effect swatches and muted text is unverified.

### 3. Protection against losing typed text

There is none. A refresh, a crash, or a closed tab loses the message, and the 1500-character
cap silently truncates a longer paste (the counter turns red, but the tail is already gone).

Needs: debounced `localStorage` persistence with explicit restore, a non-destructive
over-limit path (keep the full text, mark the overflow) and an undo for destructive edits.

### 4. Export telemetry

Nothing is measured today, and the app is intentionally backend-free, so this needs a
decision before it needs an implementation: privacy-preserving, self-hosted, opt-in — or not
at all. What would be worth knowing: export success/failure rate by browser, encode duration
and output size distributions, which clipboard capability users actually land in, and how
often text is truncated. Adding a third-party analytics SDK would contradict the "nothing is
uploaded" promise the tool currently keeps, so this is not a free addition.

### 5. Real browser / email combination testing

E2E runs on Chromium only. Firefox and WebKit are untested, and both matter here:
`OffscreenCanvas`, `ImageDecoder`, `ClipboardItem.supports`, and worker-module support differ
between them. The app already has capability probing for the clipboard, but nothing verifies
the *export* path degrades correctly where `OffscreenCanvas` is unavailable.

Needs: the Playwright matrix extended to firefox and webkit, a documented support policy, and
a graceful (stated, not silent) failure where a browser cannot encode at all.

---

[DEC-002]: ../knowledge/decisions/DEC-002-investigation-findings.md
[DEC-004]: ../knowledge/decisions/DEC-004-clipboard-gate-results.md
