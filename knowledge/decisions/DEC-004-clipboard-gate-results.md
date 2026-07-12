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

## Stage 1 — real browser × real webmail (not yet run)
Requires driving the user's actual logged-in Gmail/Outlook sessions and, to check
"after sending" and "received" behavior, sending at least one real test email. Blocked
on explicit user permission per session policy (sending messages / acting on real
accounts is not something to do without asking each time) — see chat for the request.

| Browser | Webmail | Strategy 1 | Strategy 2 | Strategy 3 |
|---|---|---|---|---|
| Chrome/macOS | Gmail Web | not run | not run | not run |
| Chrome/macOS | Outlook Web | not run | not run | not run |
| Safari/macOS | Gmail Web | **not automatable** | **not automatable** | not run (manual) |
| Safari/macOS | Outlook Web | **not automatable** | **not automatable** | not run (manual) |

**Safari constraint:** no tool available to this assistant can click or type inside
Safari — the computer-use toolset treats browsers as read-only ("read" tier: visible in
screenshots, clicks/typing blocked) specifically so email/banking-type actions in a
user's real browser aren't automated by an agent. The Safari cells can only be completed
by the user running the spike page by hand, or get recorded as
`[Not verified — needs manual run]` if skipped.

## Per-cell checklist (once run)
inline placement vs. attachment · animation plays in composer · animation plays after
sending · renders correctly for recipient in Gmail and Outlook · survives after source
tab closed · sent email kept the CDN URL / proxied it / converted to inline attachment.
Screenshot each result and link it here.

## Status
Stage 0 done. Stage 1 not started — awaiting explicit go-ahead to use real Gmail/Outlook
sessions (Chrome, via the user's browser) and to send a test email for the send/receive
legs. Safari legs need the user directly regardless. No editor or render pipeline code
has been written.
