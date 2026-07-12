---
type: decision
tags: [decision, bugfix, implementation]
status: accepted
---
# DEC-007 — Fixed: GIF export was blank due to Fabric's retina canvas scaling

**Bug reported by the user**: exported GIFs showed no visible text ("text only 1/4 of
the size" — actual root cause turned out to be closer to "text missing entirely" than
merely small).

## Root cause
Fabric.js's `Canvas` scales its backing pixel buffer by `window.devicePixelRatio` by
default (`enableRetinaScaling: true`). On the machine used for testing,
`devicePixelRatio = 2`, so a "600×180" canvas actually had a 1200×360 backing store —
confirmed directly: `canvasEl.width` was `1200`, `canvasEl.height` was `360`, while the
CSS-rendered size stayed `600×180`.

`gifExport.ts`'s `renderFrame` reads pixels via
`ctx.getImageData(0, 0, WIDTH, HEIGHT)` with `WIDTH=600, HEIGHT=180` — a fixed window
that, against a 1200×360 buffer, only captures the top-left quarter. Text centered in
the canvas is drawn around the buffer's actual center (~600,180 in raw pixels), which
falls outside that captured quadrant — so the exported frames came out blank or
near-blank while the on-screen preview (which the browser composites/downscales
correctly via CSS) looked completely normal. That's why this shipped unnoticed through
[[DEC-006-preset-engine-v1]]'s manual testing — screenshots of the live preview always
looked right; only the raw exported bytes were broken.

## Fix
Pass `enableRetinaScaling: false` to the `Canvas` constructor in `App.tsx`. The backing
store now stays at exactly `WIDTH×HEIGHT` regardless of the display's pixel ratio, so
`getImageData(0, 0, WIDTH, HEIGHT)` captures the entire rendered canvas — preview and
export are pixel-consistent again. Trade-off: the on-screen preview is no longer
retina-sharp on high-DPI displays (rendered at 1x, upscaled by CSS) — acceptable for a
600×180 preview box; the shipped artifact is the GIF, not the preview's crispness.

## Also added
A font-size control (`Customize` panel, 22–64px slider) per direct user request while
investigating this — `fontSize` is now state threaded through `buildScene`, replacing
the hardcoded `FONT_SIZE` constant.

## Verification method correction
Initial re-verification using `PIL.Image` + `ImageSequence.Iterator` falsely reported
every frame as identical (misleading — this iterator doesn't reliably handle GIF
frame disposal in the Pillow version used here). Switched to explicit
`im.seek(i)` per frame, which correctly showed the expected fade progression
(min pixel value ranging from 255 at frame 0 down to ~26 by the hold phase). All 10
samples in `samples/` re-verified this way after the fix — see `samples/README.md`.

## Verified (2026-07-12)
Typecheck and production build pass. All 10 regenerated sample GIFs confirmed to
animate correctly via frame-by-frame `seek()` inspection, and the final held frame of
`01-fade-thank-you.gif` visually confirmed as correctly-sized, readable, full-width
text (not a fraction of it).
