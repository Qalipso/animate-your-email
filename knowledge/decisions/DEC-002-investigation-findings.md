---
type: decision
tags: [decision, investigation, risk]
status: accepted
---
# DEC-002 — Investigation findings: GIF encoder choice + "Copy to email" is unverified, needs a spike

Web research pass (2026-07-11) against the two riskiest technical assumptions behind
[[DEC-001-gif-first-delivery]], before writing implementation code.

## 1. GIF encoding: use `gifenc` (pure JS), not WASM — [Provisionally Verified]
The original concept doc assumed a WASM GIF encoder. Published sources support the
*capability and likely performance* of `gifenc` over WASM options at our target size —
but that's secondary reporting, not a local measurement. Downgraded from "Verified" to
**Provisionally Verified** until benchmarked against our actual frame budget:
- `gifenc` (mattdesl) — fast, includes its own color quantizer, commonly cited as 2x+
  faster than the older `gif.js`, and simpler to ship (no `.wasm` asset, no
  cross-origin-isolation headers for threads).
- `gif.js` — older, still works, web-worker-based, but slower.
- WASM options (`wasm-gif`, `gif-wasm-codec`) exist but are reported as less mature for
  *encoding* (memory issues noted), and don't clearly beat the JS options at our target
  size (600×180, 12–15fps, 2–3s ≈ 30–45 frames).
- **`gifenc` ships no worker manager.** It's an encoder only — moving frame generation +
  encoding off the main thread into a Web Worker, and marshalling frames across that
  boundary, is on us to build. Not a blocker, but it's implementation work the "just use
  gifenc" framing understates.
- **Still needs a local benchmark, not yet run:** actual encoding time at 30–45 frames/
  600×180, output file size against the ≤800KB target / ~1.5MB hard cap, palette
  stability across frames (flicker from independently-quantized palettes per frame vs a
  shared palette), and visual quality of the color quantization on our actual preset
  output (flat vector shapes, per DEC-003) rather than photos.
- **Decision:** still build the render pipeline on `gifenc` in a Web Worker — the
  published case for it over WASM is strong enough to proceed — but treat the specific
  numbers (speed, size, quality) as open until measured locally. Do this benchmark before
  or alongside first pipeline implementation, not before the clipboard spike below (which
  is the higher-priority gate).

Sources: [gifenc](https://github.com/mattdesl/gifenc), [gifenc npm](https://www.npmjs.com/package/gifenc), [gif.js](https://github.com/jnordberg/gif.js/), [wasm-gif](https://github.com/WenheLI/wasm-gif).

## 2. "Copy to email" (clipboard `text/html` with `<img src>`) — [NOT verified — PRIMARY PRODUCT GATE]
This is no longer treated as one risky implementation detail among several — it is the
**gate the whole product depends on**. If no copy strategy survives the full path below,
"Copy to email" is not a degraded feature, it's not a V1 feature, and the primary CTA
becomes "Download GIF" instead. Nothing about the editor or render pipeline should be
built until this gate has a documented, evidence-backed result.

**Full path under test** (not just "does paste work"):
```
browser clipboard → Gmail/Outlook composer → outgoing email → received email
```
Each hop can independently break the chain (e.g. paste succeeds in the composer but the
image doesn't survive send; or it survives send but Gmail's proxy serves a static frame
instead of the animated GIF).

Search evidence going in is **mixed and not conclusive enough to build on**:
- Rich-text paste of `text/html` into a contenteditable compose box (how Gmail/Outlook
  compose is implemented) is a standard, supported browser mechanism in principle.
- But available commentary specifically on Gmail indicates Gmail's paste handler tends
  to **intercept and re-host any pasted image** (blob or externally-linked) rather than
  leaving the original hotlink in place — consistent with animated GIFs playing in Gmail
  today (marketing email does this), but the re-hosting step is opaque and unverified
  for our specific path.
- No source confirms or denies that a **programmatic** `clipboard.write()` from an
  arbitrary web page is treated identically to a normal OS copy by Gmail's/Outlook's
  paste handlers. This is the actual unknown driving the spike design below.
- `ClipboardItem` + `text/html` writing needs Safari/Firefox version gating and a secure
  context + user gesture — solvable, adds a compatibility matrix.

**Spike design (framework-free, no editor/pipeline code):**
One persistent, publicly hosted animated GIF (not a blob URL, not base64, not
`image/gif` ClipboardItem data — those aren't the shipping mechanism per DEC-001, so
testing them would answer the wrong question). Three copy strategies tested against it:
1. `navigator.clipboard.write()` with both `text/html` and `text/plain` — the mechanism
   DEC-001 actually proposes to ship.
2. Native DOM/selection copy (`document.execCommand('copy')` or equivalent off a real
   selection range) — tests whether the browser's native rich-copy path behaves
   differently from a programmatic `ClipboardItem` write.
3. Manual selection + Cmd/Ctrl+C as a control — establishes the ceiling: if even a
   human manually copying the rendered image and pasting doesn't survive the full path,
   no JS-driven mechanism will either.

**Test matrix** — all 4 combinations first (Safari cannot be driven by any tool
available to the assistant; those cells need the user's hands or get marked
`[Not verified — needs manual run]`):

| Browser | Webmail | Strategy 1 | Strategy 2 | Strategy 3 |
|---|---|---|---|---|
| Chrome/macOS | Gmail Web | | | |
| Chrome/macOS | Outlook Web | | | |
| Safari/macOS | Gmail Web | | | |
| Safari/macOS | Outlook Web | | | |

Per cell, record: inline placement vs. attachment · animation plays in composer ·
animation plays after sending · renders correctly for the recipient in both Gmail and
Outlook · survives after the source tab is closed · whether the sent email kept the CDN
URL, proxied it, or converted it to an inline attachment. Screenshot each result.

**Fallback if the gate fails for all strategies/clients:** "Download GIF" becomes the
real primary CTA (drag the downloaded file into any compose window — universally
supported). "Copy to email" ships only for the client/strategy combinations that pass,
or is cut from V1 entirely if nothing passes. This does not block shipping — it decides
which button is primary and whether "Copy to email" ships at all.

Sources: [Clipboard.write() MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write), [Gmail image paste behavior](https://www.tutorialpedia.org/blog/how-does-the-paste-image-from-clipboard-functionality-work-in-gmail-and-google-chrome-12/), [w3c/clipboard-apis#44](https://github.com/w3c/clipboard-apis/issues/44).

## Status
Finding 1 (gifenc) needs a local benchmark before/alongside pipeline work. Finding 2
(clipboard gate) is now in progress — spike page + test matrix being built; no editor
or render pipeline code exists yet. Results recorded in
`decisions/DEC-004-clipboard-gate-results.md` once the matrix is run.
