---
type: decision
tags: [decision, investigation, risk]
status: accepted
---
# DEC-002 — Investigation findings: GIF encoder choice + "Copy to email" is unverified, needs a spike

Web research pass (2026-07-11) against the two riskiest technical assumptions behind
[[DEC-001-gif-first-delivery]], before writing implementation code.

## 1. GIF encoding: use `gifenc` (pure JS), not WASM — [Verified, multiple sources]
The original concept doc assumed a WASM GIF encoder. Current consensus (2026) is that a
pure-JS encoder run inside a Web Worker outperforms available WASM options for this
workload:
- `gifenc` (mattdesl) — fast, includes its own color quantizer, commonly cited as 2x+
  faster than the older `gif.js`, and simpler to ship (no `.wasm` asset, no
  cross-origin-isolation headers for threads).
- `gif.js` — older, still works, web-worker-based, but slower.
- WASM options (`wasm-gif`, `gif-wasm-codec`) exist but are reported as less mature for
  *encoding* (memory issues noted), and don't clearly beat the JS options at our target
  size (600×180, 12–15fps, 2–3s ≈ 30–45 frames).
- **Decision:** build the render pipeline on `gifenc` in a Web Worker. Drop the WASM
  requirement from DEC-001's stated pipeline — it added complexity with no proven payoff
  at this frame/size budget. Revisit only if profiling shows JS quantization is the
  bottleneck.

Sources: [gifenc](https://github.com/mattdesl/gifenc), [gifenc npm](https://www.npmjs.com/package/gifenc), [gif.js](https://github.com/jnordberg/gif.js/), [wasm-gif](https://github.com/WenheLI/wasm-gif).

## 2. "Copy to email" (clipboard `text/html` with `<img src>`) — [NOT verified — top risk]
DEC-001's V1 mechanism assumes: write `text/html` (containing `<img src="https://cdn/…gif">`)
+ `text/plain` to the clipboard via `navigator.clipboard.write()`, then the user pastes
into Gmail/Outlook compose and the image comes through.

Search evidence is **mixed and not conclusive enough to build on without an empirical
test**:
- Rich-text paste of `text/html` into a contenteditable compose box (how Gmail/Outlook
  compose is implemented) is a standard, supported browser mechanism in principle.
- But available commentary specifically on Gmail indicates Gmail's paste handler tends
  to **intercept and re-host any pasted image** (blob or externally-linked) to its own
  infrastructure rather than leaving the original hotlink in place — which is actually
  *consistent* with known real-world behavior that animated GIFs sent through Gmail do
  play (marketing email does this today), but the re-hosting step is opaque and not
  something we can assert works from our own clipboard-write path without testing it.
- No source directly confirms or denies that a **programmatic** `clipboard.write()` from
  an arbitrary web page (as opposed to a normal OS copy from a rendered page) is treated
  identically by Gmail's/Outlook's paste handlers. This is the actual unknown.
- Browser support caveat: `ClipboardItem` + `text/html` writing needs Safari/Firefox
  version gating (Firefox default-on only from v126+; both require a secure context and
  a user-gesture-triggered call) — solvable, but adds a compatibility matrix.

**Decision:** treat "Copy to email" as **unproven**, not as a settled V1 mechanism.
The first implementation task (before building the full render pipeline) must be a
throwaway spike: a static page with one button that clipboard-writes `text/html` +
`text/plain` containing a real hosted animated GIF `<img>`, tested by hand-pasting into
(a) Gmail web compose, (b) Outlook web compose, (c) Outlook desktop if available. Record
the actual result in this file.

**Fallback if the spike fails:** "Download GIF" becomes the real primary CTA (drag the
downloaded file into any compose window — universally supported), and "Copy to email"
either ships in a degraded form (plain-text URL only, or a "right-click the animation
below → Copy Image" fallback affordance) or is deferred to V1.1. This does not block
shipping — it changes which button is primary.

Sources: [Clipboard.write() MDN](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write), [Gmail image paste behavior](https://www.tutorialpedia.org/blog/how-does-the-paste-image-from-clipboard-functionality-work-in-gmail-and-google-chrome-12/), [w3c/clipboard-apis#44](https://github.com/w3c/clipboard-apis/issues/44).

## Status
Both findings feed into implementation planning, not yet executed. No code written.
