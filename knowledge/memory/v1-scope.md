---
type: fact
tags: [scope, v1]
---
# V1 product scope

Single screen: text input, live CSS/WAAPI preview, horizontal template strip, **Copy to
email** (primary CTA) + **Download GIF** (secondary), one collapsible Customize panel
(font, color, background, speed, size). No timeline, no layers, no keyframe editor.

**30 presets**, 6 categories (Clean, Typing, Editorial, Playful, Bold, Light&Color),
built from **8 composable primitives** (opacity, translate, scale, rotate, blur, mask,
per-character stagger, color/glow) — not 30 separate render engines. Default 5 shown
first: Fade, Rise, Typewriter, Highlight, Pop.

Each preset is declarative (template JSON: duration, fps, split mode, stagger, enter/
exit curves, endHold, loops) so new presets don't require editor changes.

Full rationale for the GIF-vs-CSS delivery split: [[DEC-001-gif-first-delivery]].
