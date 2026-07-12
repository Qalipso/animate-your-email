# Sample generations

10 GIFs generated through the real app pipeline (`src/`) — Fabric.js render → `gifenc`
encode — spanning all 6 preset categories, at default settings (600×180, 12fps).
Not hand-picked best cases; generated in one batch to sanity-check output quality and
file size across the engine (see [[DEC-006-preset-engine-v1]]).

**Regenerated 2026-07-12** after fixing a real bug the first batch had — see
[[DEC-007-retina-canvas-export-bug]]: Fabric.js scales its canvas backing store by
`devicePixelRatio`, and GIF export was reading a fixed 600×180 pixel window from that
scaled buffer, capturing blank/near-empty content instead of the rendered text. Every
file below was verified frame-by-frame with explicit `PIL.Image.seek()` (not the
naive `ImageSequence.Iterator`, which misreported frames as identical) to confirm each
one actually animates and settles on correctly-sized, full-width text.

| File | Preset | Category | Size |
|---|---|---|---|
| `01-fade-thank-you.gif` | Fade | Clean | 94.2 KB |
| `02-rise-happy-holidays.gif` | Rise | Clean | 80.6 KB |
| `03-typewriter-welcome-aboard.gif` | Typewriter | Typing | 16.3 KB |
| `04-highlight-limited-time-offer.gif` | Highlight | Editorial | 66.2 KB |
| `05-pop-congrats-launch.gif` | Pop | Playful | 75.5 KB |
| `06-wave-see-you-at-conference.gif` | Wave | Playful | 83.6 KB |
| `07-glitch-system-update.gif` | Glitch | Bold | 87.8 KB |
| `08-neon-open-late-tonight.gif` | Neon | Light & Color | 77.9 KB |
| `09-bounce-you-got-the-job.gif` | Bounce | Playful | 58.2 KB |
| `10-stamp-approved.gif` | Stamp | Editorial | 45.4 KB |

All 10 are valid `GIF89a`, 600×180, well under the 800KB target from DEC-002 (largest
is 94KB). Generated via a scripted browser session driving the actual UI (text input →
preset select → Download GIF) and saved directly to disk via a local HTTP receiver —
not synthetic/fabricated output, not hand-edited.
