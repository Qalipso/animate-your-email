---
type: decision
tags: [decision, architecture, privacy]
status: accepted
---
# DEC-005 — Privacy-first delivery: don't default to remote-hosted GIF

Supersedes the "Copy to email" mechanism assumed by [[DEC-001-gif-first-delivery]] (a
CDN-hosted GIF referenced by a permanent `<img src>`). [[DEC-004-clipboard-gate-results]]
confirmed empirically that Gmail keeps that `<img src>` pointing at our external URL —
it does not fetch-and-re-host the image into its own infrastructure at send time. That
means a remote-hosted GIF is structurally the same shape as a tracking pixel: every time
any recipient's client renders the email, it requests our URL, and a server we control
is in a position to see that request happened (even if we choose not to log it).

## Why this matters beyond privacy purism
- Outlook explicitly ships "block external images" as an anti-tracking-pixel/web-beacon
  defense, and can proxy external images through its own infrastructure. Gmail has a
  similar "ask before displaying external images" option. **A remote GIF is not
  guaranteed to render for every recipient** — it depends on their client's external-image
  policy, independent of whether our clipboard mechanism itself works.
- It also means: corporate mail policies may block it outright, the email breaks forever
  if our hosting goes away, and we inherit hosting-infrastructure obligations (abuse
  moderation, retention/deletion requests, bandwidth cost, spam-hosting risk) for what
  should be a small client-side tool.

## Decision: local-first by default, hosting becomes optional and constrained
1. **Default V1 behavior:** the GIF is generated entirely client-side (Canvas → `gifenc`
   in a Web Worker → local Blob, per [[DEC-003-stack-and-roadmap]]) and nothing is
   uploaded anywhere unless the user explicitly chooses a hosted option. Text never
   leaves the browser. No account, no project storage, no server-side rendering for V1.
2. **Primary action becomes "Copy animation"**, not "Copy to email" via a CDN link. It
   still uses `navigator.clipboard.write()` (per DEC-002/004), but the payload is judged
   by whether the target composer inlines/embeds what was pasted well enough to not
   depend on our infrastructure afterward — which the current evidence says Gmail does
   *not* do for an HTML-fragment paste. This needs the still-pending Strategy 2/3 and
   Outlook results to know if any composer behaves differently.
3. **Universal fallback: "Download & insert."** Download the GIF file locally, prompt
   "drag the downloaded animation into your email." Works in every mail client
   unconditionally, and the resulting attachment is not subject to external-image
   blocking. This is the floor the product can always fall back to — per DEC-002's
   original fallback logic, now reframed as privacy-motivated as well as
   compatibility-motivated.
4. **Hosted image becomes an opt-in, later feature** ("Copy using hosted image"), not the
   default. If/when built, hard constraints apply: HTTPS only, `image/gif` only, no
   cookies, no query parameters, no recipient-specific or per-send URLs, content-addressed
   (`sha256`-named, matching DEC-001's dedup idea) so identical content always gets the
   identical URL, minimal/no access logging. The goal is that even if hosting exists, it
   cannot be used as a tracking mechanism.
5. **Explicit security/privacy promise for V1**, worth stating in-product: *"No mailbox
   access. No tracking. Your text is rendered locally."* This is also a differentiator —
   it's a stronger claim than competitors that route text through a backend.

## What does NOT change
[[DEC-003-stack-and-roadmap]]'s stack pick (Fabric.js + GSAP + gifenc) is unaffected —
rendering was already planned client-side. [[DEC-002-investigation-findings]]'s gifenc
benchmark is still needed. The clipboard test matrix in DEC-004 is still the gate;
this decision changes what a "pass" needs to mean (does the composer end up
self-contained, not whether paste-then-send merely succeeds).

## Open question this creates
Does *any* browser/client combination cause the composer to actually embed the pasted
image as its own asset (Gmail image-paste re-upload behavior, as documented for
blob/screenshot pastes) rather than keeping an external link? Strategy 2 (native
selection copy of a real rendered `<img>`, as opposed to Strategy 1's synthetic
`ClipboardItem`) was specifically designed to test this distinction and has not yet
produced a valid result (contaminated by concurrent clipboard use, see DEC-004). This is
now the single most important unresolved question before deciding whether "Copy
animation" is viable as V1's primary CTA at all, or whether V1 ships with "Download &
insert" as primary from day one.
