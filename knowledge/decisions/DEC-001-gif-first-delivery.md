---
type: decision
tags: [decision, architecture]
status: accepted
---
# DEC-001 — GIF is the delivery format; CSS is preview-only

## Decision
The app renders animated text as a **GIF** for anything sent to a recipient. CSS/Web
Animations API is used only for the live in-app preview and is never shipped in the email.

## Why
Email clients don't reliably support CSS animation:
- Gmail, Outlook, and Yahoo ignore or strip `animation`/`@keyframes`; only Apple Mail
  renders them (caniemail.com feature data).
- AMP for Email would allow real interactivity but requires each sender address to be
  individually registered with Google — incompatible with a self-serve, any-user app.
- Video attachments render unpredictably (often as a download/link, not inline).
- GIF is the one format that behaves like a normal `<img>` across virtually all clients,
  including Outlook 365 (animation playback there can depend on OS/client settings, but
  the static-fallback frame still degrades gracefully).

## Consequences
- Every "send"-facing export goes through: Template JSON → animation engine → Canvas2D
  frames → Web Worker → WASM GIF encoder → GIF Blob.
- GIF constraints shape the whole design budget: 600×180px, 2–3s, 12–15fps, ≤2 lines,
  ≤60 chars recommended, target ≤800KB (hard cap ~1.5MB).
- First frame must hold the full final text 100–200ms (in case a client shows only a
  static frame), and animation must not loop infinitely — hold → animate → hold, max 2
  repeats, then stop on the final readable text (also keeps it from reading as an ad
  banner, and satisfies WCAG's "no more than 3 flashes/sec" photosensitivity guidance).
- "Copy to email" V1 = upload the GIF to permanent/immutable object storage at a
  content-hash path (`/animations/{sha256}.gif`, dedupes identical renders) + copy an
  `<img>` HTML snippet (with `alt` text matching the rendered words, for accessibility)
  to the clipboard as both `text/html` and `text/plain`. Mobile gets a "Share to email"
  via the Web Share API. Gmail/Outlook draft-creation APIs are deliberately deferred to
  V2 — `gmail.compose` is a restricted OAuth scope requiring Google security assessment,
  which is the wrong first step for an unproven app.

## Not doing in V1
Full email editor, sending email from the app, accounts/teams, AI-generated effects,
a timeline editor, custom video upload, AMP for Email, Gmail/Outlook draft creation.
