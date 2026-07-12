# Sample generations

10 GIFs generated through the real app pipeline (`src/`) — Fabric.js render → `gifenc`
encode — spanning all 6 preset categories, at default settings (600×180, 12fps).
Not hand-picked best cases; generated in one batch to sanity-check output quality and
file size across the engine (see [[DEC-006-preset-engine-v1]]).

**Regenerated twice on 2026-07-12** after fixing two real bugs found via user report +
follow-up verification:
- [[DEC-007-retina-canvas-export-bug]]: Fabric.js scaled the canvas backing store by
  `devicePixelRatio`, so GIF export's fixed 600×180 pixel read captured a blank corner
  instead of the rendered text.
- [[DEC-008-stagger-timing-bug]]: staggered presets (Typewriter, Wave, Bounce, Glitch,
  etc.) froze partway through — both the live preview and the GIF export stopped at one
  segment's own animation duration instead of the full stagger spread, cutting the
  entrance off mid-word.

Every file below was verified frame-by-frame with explicit `PIL.Image.seek()` (the
naive `ImageSequence.Iterator` misreports frames as identical) — confirmed each one
animates progressively and settles on the complete, correctly-sized phrase in its final
frame, not a partial or blank one.

| File | Preset | Category | Size |
|---|---|---|---|
| `01-fade-thank-you.gif` | Fade | Clean | 94.2 KB |
| `02-rise-happy-holidays.gif` | Rise | Clean | 80.6 KB |
| `03-typewriter-welcome-aboard.gif` | Typewriter | Typing | 79.4 KB |
| `04-highlight-limited-time-offer.gif` | Highlight | Editorial | 66.2 KB |
| `05-pop-congrats-launch.gif` | Pop | Playful | 92.7 KB |
| `06-wave-see-you-at-conference.gif` | Wave | Playful | 109.3 KB |
| `07-glitch-system-update.gif` | Glitch | Bold | 101.7 KB |
| `08-neon-open-late-tonight.gif` | Neon | Light & Color | 79.7 KB |
| `09-bounce-you-got-the-job.gif` | Bounce | Playful | 75.9 KB |
| `10-stamp-approved.gif` | Stamp | Editorial | 46.5 KB |

All 10 are valid `GIF89a`, 600×180, still under the 800KB target from DEC-002 (largest
is 109KB — sizes rose from the first regeneration because the staggered presets now
actually render every character/word instead of freezing early). Generated via a
scripted browser session driving the actual UI (text input → preset select →
Download GIF) and saved directly to disk via a local HTTP receiver — not
synthetic/fabricated output, not hand-edited.
