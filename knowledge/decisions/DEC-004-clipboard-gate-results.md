---
type: decision
tags: [decision, investigation, risk, results]
status: in-progress
---
# DEC-004 — Clipboard gate: test matrix results (in progress)

Live results for the spike defined in [[DEC-002-investigation-findings]] §2. Spike page:
`spike/clipboard-gate/index.html`, served locally over HTTP (Clipboard API requires a
secure context; `localhost` qualifies) at the time of testing. Test GIF: public, at
`https://raw.githubusercontent.com/Qalipso/animate-your-email/main/spike/clipboard-gate/test-animation.gif`
(repo made public 2026-07-11 specifically to host this — see commit history — a
user-approved decision, not the final CDN plan from DEC-001).

## Stage 0 — mechanical sanity check (no email client involved)
Confirms the JS write calls succeed without throwing, in the assistant's sandboxed
Chromium browser, before touching any real account.

| Strategy | Result |
|---|---|
| 1 — `navigator.clipboard.write()` (text/html + text/plain) | ✅ Wrote without error |
| 2 — native DOM/selection copy (`execCommand('copy')`) | ✅ Returned `true`, no error |
| 3 — manual selection + Cmd/Ctrl+C | N/A — no JS involved by design; only testable by a human |

Clipboard **read-back** (for self-verification of payload) failed with
`NotAllowedError: Read permission denied` in the sandboxed browser — expected, unrelated
to whether Gmail/Outlook can read a normal user-gesture clipboard write. Not a signal
about the actual gate.

**This stage does not answer the actual question.** It only rules out "the code throws."
Whether Gmail/Outlook composers accept the paste, whether it survives sending, and how
it renders for a recipient are all still open.

## Stage 1 — real browser × real webmail (Chrome/Gmail Strategy 1 run; rest pending)
User authorized driving the real Chrome session via `claude-in-chrome` and sending test
emails to self. Run against `quadwailt@gmail.com`, both compose and receiving side (same
account).

| Browser | Webmail | Strategy 1 | Strategy 2 | Strategy 3 |
|---|---|---|---|---|
| Chrome/macOS | Gmail Web | ✅ see below | ✅ see below (same result as Strategy 1) | not run |
| Chrome/macOS | Outlook Web | not run | not run | not run |
| Safari/macOS | Gmail Web | **not automatable** | **not automatable** | not run (manual) |
| Safari/macOS | Outlook Web | **not automatable** | **not automatable** | not run (manual) |

### Chrome/macOS × Gmail Web × Strategy 1 — RESULT: passes the composer/send legs, but confirms the tracking-pixel-shaped risk
1. **Paste into composer:** inline placement, full-size rendered image, no attachment
   chip. Pass.
2. **Send:** succeeded without any warning/stripping from Gmail.
3. **Raw MIME of the sent message** (via Показать оригинал / Show original):
   ```
   Content-Type: text/html; charset="UTF-8"
   <div dir="ltr"><img src="https://raw.githubusercontent.com/Qalipso/animate-your-email/main/spike/clipboard-gate/test-animation.gif" width="600" alt="CLIP TEST animated GIF" style="display: block; max-width: 100%; height: auto; border: 0px;"></div>
   ```
   **Gmail preserved our external URL verbatim — it did NOT download and re-host the
   image as its own asset.** This directly contradicts the "ideal scenario" (Gmail
   fetches the GIF and embeds it as a safe inline asset) and confirms the risk raised in
   chat: a remote-hosted GIF in an email is structurally identical to a tracking pixel —
   every time any recipient (or Gmail's own preview fetch) opens the email, their client
   requests our URL. Alt text was preserved correctly.
4. **Rendering in the received copy:** displayed inline correctly. Animation-over-time
   not conclusively confirmed — two screenshots ~2s apart both showed frame 1; this could
   be Gmail's image proxy serving a cached/re-encoded copy, a timing artifact, or genuine
   non-animation. **Needs a longer-interval re-check, not yet done.**
5. Not yet checked: whether Gmail served the image directly from
   `raw.githubusercontent.com` (visible in a network trace) or through Gmail's own image
   proxy (`googleusercontent.com`) when *displaying* it — this matters for whether Gmail's
   proxy caching masks or preserves the tracking-pixel-shaped exposure. Not measured this
   round.

**Product implication:** this is the empirical evidence behind the pivot discussed in
chat — remote-CDN-by-default should NOT be the V1 architecture. See updated direction
below.

### Chrome/macOS × Gmail Web × Strategy 2 — RESULT: same as Strategy 1
First attempt was inconclusive: the compose body ended up with unrelated pasted text (a
bio/résumé line) because the OS clipboard was overwritten mid-test by the user
interacting with the same real, shared browser/clipboard concurrently (confirmed
separately — see the "hey hey" email sent by the user testing manually in parallel).
Draft discarded, not sent. **Operational finding:** testing on a live, actively-used
Chrome profile has a real clipboard race condition between the assistant and the user —
mitigated by doing recipient/subject setup first, then copy-then-paste back-to-back with
no intervening steps.

Retried with tight timing — succeeded. Raw MIME of the sent message:
```
<div dir="ltr"><img id="gmail-native-copy-gif" width="300" height="90"
alt="CLIP TEST animated GIF"
src="https://raw.githubusercontent.com/Qalipso/animate-your-email/main/spike/clipboard-gate/test-animation.gif"
style="..."></div>
```
**Identical outcome to Strategy 1:** external URL preserved verbatim, no re-hosting.
Native DOM/selection copy (`execCommand`) and the synthetic `ClipboardItem` write behave
the same way in Gmail Web/Chrome — neither causes Gmail to fetch-and-embed the image.
This resolves DEC-005's open question **for Gmail Web/Chrome specifically**: no copy
strategy tested so far produces a self-contained (re-hosted) result. Both are equally
subject to the tracking-pixel-shaped exposure described in DEC-005.

## Per-cell checklist (once run)
inline placement vs. attachment · animation plays in composer · animation plays after
sending · renders correctly for recipient in Gmail and Outlook · survives after source
tab closed · sent email kept the CDN URL / proxied it / converted to inline attachment.
Screenshot each result and link it here.

## Status
Stage 0 done. Stage 1: Chrome×Gmail×Strategy 1 done with a conclusive and important
result (external URL preserved, not re-hosted). Chrome×Gmail×Strategy 2 inconclusive
(clipboard race). Outlook Web, Strategy 3, and both Safari cells not yet run. No editor
or render pipeline code has been written.
