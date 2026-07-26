# DEC-015 — Keyboard access to the canvas, and not losing the user's text

**Date:** 2026-07-26
**Status:** Implemented and verified
**Closes:** two of the `[Planned]` items in [docs/ROADMAP.md](../../docs/ROADMAP.md)

## 1. A long paste was being destroyed

`onChange` ran `setRawText(e.target.value.slice(0, MAX_CHARACTERS))`. Pasting 3000 characters
deleted 1500 of them **in the moment of pasting** — not held back from the image, deleted from
the textarea, with no way to scroll back and see what had gone.

The cap belongs at the build step, not at the input. The textarea now keeps everything the user
typed; `buildAnimatedDocument` already takes only the first `MAX_CHARACTERS`, and an alert says
exactly how many characters are not in the image and that the full text is still there.

## 2. The draft survives a reload

There was no persistence at all: a refresh, a crash or a closed tab lost the message. For a tool
whose entire input is something composed by hand, that was the worst failure available to it.

`session.ts` keeps text, template override, speed and hold in `localStorage`, debounced on the
same beat as the preview rebuild. Restored synchronously in `useState`, so the first paint is
already the draft rather than flashing the sample text first.

Every access is guarded: `localStorage` *throws* rather than returning null in a private window
with storage disabled and inside a cross-origin iframe. Losing a draft is bad; taking the app
down to save one would be worse. Restored values are validated rather than trusted — the stored
JSON is something a user can edit by hand, and a bad `mode` would break the build.

This does not change the "nothing leaves the browser" promise: local storage is still local.

## 3. The canvas is operable from a keyboard

The canvas is the *primary editing surface* — toggling words and selecting phrases — and it was
mouse-only. That is the accessibility gap the roadmap called out, and it was the real one.

It is now focusable, with a roving caret:

| Key | Action |
|---|---|
| `←` `→` | previous / next word |
| `↑` `↓` | nearest word on the line above / below |
| `Home` `End` | first / last word |
| `Enter` `Space` | toggle whether the word animates |
| `Shift` + arrows | extend a selection across a phrase |
| `E` | open the effect list for the selection |
| `Escape` | clear |

Two channels, because a caret has to be perceivable both ways: a dashed focus ring drawn on the
selection overlay for sighted keyboard users, and an `aria-live` region announcing
`"<word>, animated|not animated, word N of M"` for screen readers. The overlay was already a
separate canvas kept out of the export codepath (DEC-009), so the ring cannot leak into a GIF.

`↑`/`↓` pick the word nearest the current x on the target line rather than the same index —
index-based movement jumps around unpredictably on ragged lines.

## Verification

- 63 unit tests, 17 E2E (was 14), lint and typecheck clean.
- New E2E: a 2500-character paste keeps all 2500 in the box and warns about the excess; a draft
  survives `page.reload()`; the canvas is driven start to finish from the keyboard — focus,
  arrow, toggle (asserting the announced state flips), shift-select, `E`, `Escape`.

## Known gaps

- Still no WCAG 2.2 AA audit; this closes the largest gap, not the standard.
- Contrast of the effect swatches and muted text remains unverified.
- Drag-select is still mouse-only on touch devices — the keyboard path does not help there.
