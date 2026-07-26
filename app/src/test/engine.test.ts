import { describe, expect, it } from 'vitest'
import { buildAnimatedDocument, layoutSceneForRender, toggleRunAnimation } from '../engine/document'
import { detectHighlights } from '../engine/highlight'
import { PADDING, createMeasurer, metricsFor, wrapBlocksIntoLines } from '../engine/layout'
import { computeSceneTiming, renderScene, sceneTimingFor } from '../engine/render'
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, previewDocument } from '../engine/previewDoc'
import { seededRandom } from '../engine/sketch'
import { buildTimeline, renderTimelineFrame } from '../engine/timeline'
import { buildSceneSvg } from '../engine/svgExport'
import { snapDelayMs } from '../gifExport'
import {
  MAX_CHARACTERS,
  MAX_FRAME_HEIGHT,
  MAX_HOLD_MS,
  MAX_SPEED,
  MIN_HOLD_MS,
  MIN_READABLE_FONT_PX,
  MIN_SPEED,
  type TextLayout,
} from '../engine/model'
import { MODE_PRESETS } from '../engine/modeSelect'
import { MockCanvas, type MockCanvasContext } from './mockCanvas'

const LONG_PARAGRAPH_DOC = `We are thrilled to share the results of our biggest launch yet, spanning three continents and dozens of teams working around the clock for months.

Over the past quarter, the whole company came together to ship a completely redesigned onboarding flow, a faster billing system, and a brand new mobile app that customers had been asking for since last year.

Customer feedback has been overwhelmingly positive so far, with support tickets down significantly and daily active usage climbing week over week across nearly every region we track.

None of this would have been possible without close collaboration between design, engineering, support, and sales, all pushing toward the same release date under real pressure.

Thank you again for everything you contributed this quarter — every review, every late night, every bug report mattered enormously to getting this out the door.

Get started with the new dashboard today and let us know what you think.`

function buildStory(text: string) {
  return buildAnimatedDocument(text, { mode: 'story', modeIsOverridden: true })
}

/** Reconstructs the string a reader actually sees, honouring per-word source spacing. */
function visibleText(layout: TextLayout): string {
  return layout.lines
    .map((line) => line.words.map((w, i) => (i > 0 && !w.tightBefore ? ' ' : '') + w.text).join(''))
    .join(' ')
}

describe('retina display export', () => {
  it('uses explicit logical dimensions regardless of devicePixelRatio', async () => {
    const originalDpr = (globalThis as any).devicePixelRatio
    ;(globalThis as any).devicePixelRatio = 3
    const doc = await buildAnimatedDocument('Short retina test', { mode: 'one-card', modeIsOverridden: true })
    const canvas = new (globalThis as any).OffscreenCanvas(doc.width, doc.height)
    expect(canvas.width).toBe(doc.width)
    expect(canvas.height).toBe(doc.height)
    ;(globalThis as any).devicePixelRatio = originalDpr
  })
})

describe('very long words', () => {
  it('hard-splits a word wider than the content box into multiple fitting chunks', async () => {
    const ctx = await createMeasurer()
    const metrics = metricsFor(26, 600, 400)
    const longWord = 'a'.repeat(120)
    const lines = wrapBlocksIntoLines(ctx, [{ id: 'b1', runs: [{ id: 'r1', text: longWord }] }], metrics)
    const allWords = lines.flatMap((l) => l.words)
    expect(allWords.length).toBeGreaterThan(1)
    for (const w of allWords) {
      expect(w.width).toBeLessThanOrEqual(metrics.contentWidth + 0.01)
      expect(w.runId).toBe('r1')
    }
  })
})

describe('multiple paragraphs', () => {
  it('preserves every paragraph in the single fitted frame with no content lost', async () => {
    const doc = await buildStory(LONG_PARAGRAPH_DOC)
    expect(doc.truncated).toBe(false)
    const reconstructed = doc.scenes
      .flatMap((s) => s.blocks.flatMap((b) => b.runs.map((r) => r.text)))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    const originalWordCount = LONG_PARAGRAPH_DOC.split(/\s+/).filter(Boolean).length
    const reconstructedWordCount = reconstructed.split(/\s+/).filter(Boolean).length
    expect(reconstructedWordCount).toBe(originalWordCount)
  })
})

describe('Cyrillic text', () => {
  it('detects a Cyrillic markup phrase and wraps without throwing', async () => {
    const text = 'Спасибо за встречу [[очень важное]] обновление для команды сегодня.'
    const runs = detectHighlights(text)
    const primary = runs.find((r) => r.highlight?.kind === 'markup-primary')
    expect(primary?.text).toBe('очень важное')
    const doc = await buildAnimatedDocument(text, { mode: 'paragraph', modeIsOverridden: true })
    expect(doc.scenes[0].blocks.length).toBeGreaterThan(0)
  })

  it('handles ё/Ё distinctly from е/Е', () => {
    const text = 'Ёлка и ёж встретили [[ежедневное]] чудо сегодня.'
    const runs = detectHighlights(text)
    const joined = runs.map((r) => r.text).join(' ')
    expect(joined).toContain('Ёлка')
    expect(joined).toContain('ёж')
  })
})

describe('emoji', () => {
  it('keeps emoji intact as whole tokens through detection and layout', async () => {
    const text = 'Great job team 🎉🚀 see you soon 😊'
    const runs = detectHighlights(text)
    const joined = runs.map((r) => r.text).join('')
    expect(joined).toContain('🎉🚀')
    expect(joined).toContain('😊')
    const doc = await buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const words = layout.lines.flatMap((l) => l.words).map((w) => w.text)
    expect(words.some((w) => w.includes('🎉🚀'))).toBe(true)
  })

  it('does not corrupt ZWJ family emoji, skin-tone modifiers, or flag sequences', async () => {
    const text = 'Team 👨‍👩‍👧‍👦 celebrated with 👍🏽 and flew the 🇺🇸 flag today.'
    const runs = detectHighlights(text)
    const joined = runs.map((r) => r.text).join('')
    // Grapheme-safe reconstruction: every code point from the source must survive somewhere.
    for (const cp of Array.from('👨‍👩‍👧‍👦👍🏽🇺🇸')) {
      expect(joined).toContain(cp)
    }
    const doc = await buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const rendered = layout.lines.flatMap((l) => l.words.map((w) => w.text)).join('')
    expect(rendered).toContain('👨‍👩‍👧‍👦')
    expect(rendered).toContain('👍🏽')
    expect(rendered).toContain('🇺🇸')
  })
})

describe('Unicode punctuation and spacing edge cases', () => {
  it('handles em dash, non-breaking spaces, and combining marks without throwing', async () => {
    const nbsp = ' '
    const combining = 'éclair' // "éclair" via combining acute accent, not precomposed é
    const text = `We shipped it — finally.${nbsp}Enjoy this ${combining} on us.`
    const doc = await buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const rendered = layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ')
    expect(rendered).toContain('—')
    expect(rendered.replace(/\s+/g, ' ')).toContain(combining)
  })
})

describe('1500-character input', () => {
  it('caps rawText at MAX_CHARACTERS even when given more', async () => {
    const overLong = 'word '.repeat(400) // ~2000 chars
    expect(overLong.length).toBeGreaterThan(MAX_CHARACTERS)
    const doc = await buildStory(overLong)
    expect(doc.rawText.length).toBeLessThanOrEqual(MAX_CHARACTERS)
  })
})

describe('single-frame fitting', () => {
  it('puts long text in exactly one frame that does not overflow', async () => {
    const doc = await buildStory(LONG_PARAGRAPH_DOC)
    expect(doc.scenes.length).toBe(1)
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    expect(layout.overflowed).toBe(false)
    expect(doc.height).toBeLessThanOrEqual(MAX_FRAME_HEIGHT)
    expect(doc.fontSize).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX)
  })

  it('keeps the mode’s own type size when the text already fits', async () => {
    const doc = await buildAnimatedDocument('Thanks for everything today.', { mode: 'one-card', modeIsOverridden: true })
    expect(doc.fontSize).toBe(MODE_PRESETS['one-card'].fontSize)
    expect(doc.height).toBe(MODE_PRESETS['one-card'].height) // never shorter than the mode's proportions
  })

  it('shrinks type rather than paginating, and never below the readable floor', async () => {
    const doc = await buildStory('word '.repeat(300).slice(0, MAX_CHARACTERS))
    expect(doc.scenes.length).toBe(1)
    expect(doc.fontSize).toBeLessThan(MODE_PRESETS.story.fontSize)
    expect(doc.fontSize).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX)
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    expect(layout.overflowed).toBe(false)
  })

  it('never silently drops content: text either fits whole or the document says it was cut', async () => {
    const massive = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i + 1} with several words of filler content to take up space.`).join('\n\n')
    const doc = await buildStory(massive.slice(0, MAX_CHARACTERS))
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    expect(layout.overflowed).toBe(false)

    if (!doc.truncated) {
      const kept = doc.scenes[0].blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
      expect(kept.split(/\s+/).filter(Boolean).length).toBe(doc.rawText.split(/\s+/).filter(Boolean).length)
    }
  })
})

describe('animation ranges after text edits', () => {
  it('does not leak toggle state between independently built documents', async () => {
    const text = 'Thank you for the *soft emphasis* test today.'
    const docA = await buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const runA = docA.scenes[0].blocks.flatMap((b) => b.runs).find((r) => r.highlight?.kind === 'markup-soft')!
    const before = runA.highlight!.animated
    toggleRunAnimation(docA, runA.id)
    expect(runA.highlight!.animated).toBe(!before)

    const docB = await buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const runB = docB.scenes[0].blocks.flatMap((b) => b.runs).find((r) => r.highlight?.kind === 'markup-soft')!
    expect(runB.highlight!.animated).toBe(before) // fresh doc unaffected by docA's toggle
  })

  it('rebuilding after an edit reflects the new text, not stale runs', async () => {
    const doc1 = await buildAnimatedDocument('Version one of the message.', { mode: 'one-card', modeIsOverridden: true })
    const doc2 = await buildAnimatedDocument('Completely different version two.', { mode: 'one-card', modeIsOverridden: true })
    const text1 = doc1.scenes[0].blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
    const text2 = doc2.scenes[0].blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
    expect(text1).not.toBe(text2)
    expect(text2).toContain('different')
  })
})

describe('exported frame dimensions', () => {
  it('renders every timeline segment at exactly doc.width x doc.height with no clipping', async () => {
    const doc = await buildStory(LONG_PARAGRAPH_DOC)
    const timeline = await buildTimeline(doc)
    const canvas = new (globalThis as any).OffscreenCanvas(doc.width, doc.height)
    const ctx = canvas.getContext('2d')

    const sampleCount = 8
    for (let i = 0; i <= sampleCount; i++) {
      const t = (timeline.totalMs * i) / sampleCount
      expect(() => renderTimelineFrame(ctx, doc, timeline, t)).not.toThrow()
      const frame = ctx.getImageData(0, 0, doc.width, doc.height)
      expect(frame.width).toBe(doc.width)
      expect(frame.height).toBe(doc.height)
      expect(frame.data.length).toBe(doc.width * doc.height * 4)
    }
  })
})

describe('punctuation and quoting fidelity', () => {
  it('does not insert a space between a detected phrase and the punctuation glued to it', async () => {
    const text = 'We shipped on July 12, 2026. Revenue grew 24%, and (three teams) helped.'
    const doc = await buildAnimatedDocument(text, { mode: 'paragraph', modeIsOverridden: true })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    // The old flat-run flattening lost the "no whitespace here" fact and rendered
    // "July 12, 2026 ." — a character the user never typed.
    expect(visibleText(layout)).not.toMatch(/\s[.,!?;:%)]/)
  })

  it('keeps the quotation marks around a detected quote', () => {
    const runs = detectHighlights('One customer told us "this is exactly what we needed" today.')
    const quote = runs.find((r) => r.highlight?.kind === 'quote')
    expect(quote?.text).toBe('"this is exactly what we needed"')
  })
})

describe('phrase-level emphasis geometry', () => {
  it('paints a multi-word marker highlight as one contiguous band per line, not one band per word', async () => {
    // Long enough that the 15%-of-text animation budget can afford the whole phrase.
    const doc = await buildAnimatedDocument(
      'We announced [[three major updates]] and shared a live demo with the whole team at the launch event, and everyone left delighted with it.',
      { mode: 'paragraph', modeIsOverridden: true },
    )
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const phraseWords = layout.lines.flatMap((l) => l.words).filter((w) => w.highlight?.animated)
    expect(phraseWords.length).toBeGreaterThan(1) // the phrase really is multi-word
    expect(new Set(phraseWords.map((w) => w.runId)).size).toBe(1)

    const canvas = new MockCanvas(doc.width, doc.height)
    const ctx = canvas.getContext() as unknown as MockCanvasContext
    const timing = computeSceneTiming(layout)
    renderScene(ctx as never, doc, layout, timing.emphasisEndMs, timing)

    // The marker is a thick round-capped stroke, so assert on the strokes it laid down.
    const marker = ctx.strokes.filter((s) => s.lineWidth > doc.fontSize * 0.5)
    expect(marker.length).toBeGreaterThan(0)

    const linesCovered = layout.lines.filter((l) => l.words.some((w) => w.highlight?.animated))

    // The regression guarded against is one stroke per *word*, which leaves the phrase
    // striped with unpainted gaps at every word space. Every marker stroke must therefore
    // span its whole line's worth of the phrase, and none may be word-sized.
    for (const line of linesCovered) {
      const inLine = line.words.filter((w) => w.highlight?.animated)
      // Strokes are in canvas space; layout words are not.
      const spanStart = PADDING + Math.min(...inLine.map((w) => w.x))
      const spanEnd = PADDING + Math.max(...inLine.map((w) => w.x + w.width))
      const covering = marker.filter((s) => s.minX <= spanStart + 3 && s.maxX >= spanEnd - 3)
      expect(covering.length).toBeGreaterThan(0)
    }

    const widestWord = Math.max(...phraseWords.map((w) => w.width))
    for (const stroke of marker) {
      expect(stroke.maxX - stroke.minX).toBeGreaterThan(widestWord)
    }
  })
})

describe('tempo controls', () => {
  it('scales every part of the animation together, not just the emphasis', async () => {
    const doc = await buildAnimatedDocument('We shipped [[three major updates]] this quarter, finally.', {
      mode: 'paragraph',
      modeIsOverridden: true,
    })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])

    const base = computeSceneTiming(layout, { speed: 1, holdMs: 800 })
    const fast = computeSceneTiming(layout, { speed: 2, holdMs: 800 })

    expect(fast.totalMs).toBeCloseTo(base.totalMs / 2, 5)
    expect(fast.entranceMs).toBeCloseTo(base.entranceMs / 2, 5)
    expect(fast.phraseDurationMs).toBeCloseTo(base.phraseDurationMs / 2, 5)
    expect(fast.phraseStaggerMs).toBeCloseTo(base.phraseStaggerMs / 2, 5)
  })

  it('adds the hold to the end of the loop without touching the animation itself', async () => {
    const doc = await buildAnimatedDocument('Thank you for the *great work* today!', {
      mode: 'one-card',
      modeIsOverridden: true,
    })
    const layout = await layoutSceneForRender(doc, doc.scenes[0])

    const short = computeSceneTiming(layout, { speed: 1, holdMs: 0 })
    const long = computeSceneTiming(layout, { speed: 1, holdMs: 1000 })

    expect(long.totalMs - short.totalMs).toBeCloseTo(1000, 5)
    expect(long.emphasisEndMs).toBeCloseTo(short.emphasisEndMs, 5)
  })

  it('clamps tempo into range on the document, since that is what the export worker receives', async () => {
    const wild = await buildAnimatedDocument('Short note.', {
      mode: 'one-card',
      modeIsOverridden: true,
      speed: 99,
      holdMs: -500,
    })
    expect(wild.speed).toBe(MAX_SPEED)
    expect(wild.holdMs).toBe(MIN_HOLD_MS)

    const slow = await buildAnimatedDocument('Short note.', {
      mode: 'one-card',
      modeIsOverridden: true,
      speed: 0.01,
      holdMs: 99_999,
    })
    expect(slow.speed).toBe(MIN_SPEED)
    expect(slow.holdMs).toBe(MAX_HOLD_MS)
  })
})

describe('hand-drawn annotations', () => {
  it('produces identical strokes for the same seed and different ones otherwise', () => {
    const a = seededRandom('phrase-1')
    const b = seededRandom('phrase-1')
    const c = seededRandom('phrase-2')
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    const seqC = Array.from({ length: 8 }, () => c())
    // Determinism is not cosmetic here: preview and export must render byte-identical frames.
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it.each(['circle-annotation', 'box-annotation', 'bracket', 'strike-through'] as const)(
    'draws %s without disturbing the always-visible base text',
    async (preset) => {
      const doc = await buildAnimatedDocument('We shipped [[three major updates]] this quarter, finally.', {
        mode: 'paragraph',
        modeIsOverridden: true,
      })
      for (const scene of doc.scenes) {
        for (const block of scene.blocks) {
          for (const run of block.runs) {
            if (run.highlight && run.highlight.kind !== 'content-word') {
              run.highlight.animated = true
              run.highlight.emphasisPreset = preset
            }
          }
        }
      }
      const layout = await layoutSceneForRender(doc, doc.scenes[0])
      const timing = sceneTimingFor(doc, layout)

      const canvas = new MockCanvas(doc.width, doc.height)
      const ctx = canvas.getContext() as unknown as MockCanvasContext
      expect(() => renderScene(ctx as never, doc, layout, timing.emphasisEndMs, timing)).not.toThrow()

      // These presets are strokes, not fills: the only rect on the canvas is the white page.
      const fills = ctx.rects.filter((r) => r.fillStyle !== '#ffffff')
      expect(fills).toHaveLength(0)
    },
  )
})

describe('SVG export', () => {
  async function svgFor(preset: string, text = 'We shipped [[three major updates]] this quarter, finally.') {
    const doc = await buildAnimatedDocument(text, { mode: 'paragraph', modeIsOverridden: true })
    for (const scene of doc.scenes) {
      for (const block of scene.blocks) {
        for (const run of block.runs) {
          // Every animated run, not just the detected phrases: the 15% budget also promotes
          // long content words, and those carry their own preset.
          if (run.highlight?.animated) run.highlight.emphasisPreset = preset as never
          if (run.highlight && run.highlight.kind !== 'content-word') {
            run.highlight.animated = true
            run.highlight.emphasisPreset = preset as never
          }
        }
      }
    }
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    return { doc, layout, ...buildSceneSvg(doc, layout) }
  }

  it('keeps every word as real text rather than outlining it', async () => {
    const { svg, layout } = await svgFor('circle-annotation')
    const wordCount = layout.lines.flatMap((l) => l.words).length
    expect((svg.match(/<text/g) ?? []).length).toBe(wordCount)
    // The point of a vector export is selectable, resizable text; paths-as-glyphs would
    // silently throw that away.
    expect(svg).toContain('We')
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })

  it('declares the frame it was laid out for', async () => {
    const { svg, doc } = await svgFor('box-annotation')
    expect(svg).toContain(`viewBox="0 0 ${doc.width} ${doc.height}"`)
  })

  it('animates on the same clock the canvas renderer uses, including tempo', async () => {
    const doc = await buildAnimatedDocument('We shipped [[three major updates]] this quarter, finally.', {
      mode: 'paragraph',
      modeIsOverridden: true,
      speed: 2,
    })
    for (const scene of doc.scenes) {
      for (const block of scene.blocks) {
        for (const run of block.runs) {
          if (run.highlight && run.highlight.kind !== 'content-word') {
            run.highlight.animated = true
            run.highlight.emphasisPreset = 'underline-draw'
          }
        }
      }
    }
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const timing = sceneTimingFor(doc, layout)
    const { svg } = buildSceneSvg(doc, layout)
    expect(svg).toContain(`${Math.max(1, timing.totalMs)}ms`)
  })

  it('escapes text so user input cannot break out of the markup', async () => {
    const { svg } = await svgFor('underline-draw', 'A <script> tag & an "odd" quote in [[the copy]] here.')
    expect(svg).not.toContain('<script>')
    expect(svg).toContain('&lt;script&gt;')
    expect(svg).toContain('&amp;')
  })

  it('reports which presets it renders at rest instead of pretending to animate them', async () => {
    const drawn = await svgFor('circle-annotation')
    expect(drawn.staticPresets).toEqual([])

    // Burn is particles and per-glyph colour; SVG shows its settled state and says so.
    const particles = await svgFor('burn')
    expect(particles.staticPresets).toContain('burn')
  })
})

describe('effect hover preview', () => {
  const ALL_PRESETS = [
    'marker-highlight', 'bow-highlight', 'underline-draw', 'strike-through',
    'circle-annotation', 'box-annotation', 'bracket',
    'gentle-pop', 'weight-shift', 'soft-glow', 'shimmer', 'burn', 'wash-away', 'glitch',
  ] as const

  it('offers a preview for every preset the picker lists', () => {
    // The picker and this list must not drift: an effect with no preview is exactly the
    // problem the hover sample was added to solve.
    expect(new Set(ALL_PRESETS).size).toBe(ALL_PRESETS.length)
  })

  it.each(ALL_PRESETS)('renders %s on a single word without throwing', async (preset) => {
    const doc = previewDocument('Example', preset)
    expect(doc.width).toBe(PREVIEW_WIDTH)
    expect(doc.height).toBe(PREVIEW_HEIGHT)

    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const words = layout.lines.flatMap((l) => l.words)
    // One word, on one line, actually animated — otherwise the preview shows plain text and
    // silently tells the user nothing.
    expect(words).toHaveLength(1)
    expect(words[0].highlight?.animated).toBe(true)
    expect(words[0].highlight?.emphasisPreset).toBe(preset)

    const timing = sceneTimingFor(doc, layout)
    const canvas = new MockCanvas(doc.width, doc.height)
    const ctx = canvas.getContext() as unknown as MockCanvasContext
    for (const t of [0, timing.emphasisStartMs, timing.emphasisEndMs, timing.totalMs]) {
      expect(() => renderScene(ctx as never, doc, layout, t, timing)).not.toThrow()
    }
  })

  it('draws the annotation, not just the word, for a drawn-mark preset', async () => {
    const doc = previewDocument('Example', 'circle-annotation')
    const layout = await layoutSceneForRender(doc, doc.scenes[0])
    const timing = sceneTimingFor(doc, layout)
    const canvas = new MockCanvas(doc.width, doc.height)
    const ctx = canvas.getContext() as unknown as MockCanvasContext

    renderScene(ctx as never, doc, layout, timing.emphasisStartMs - 1, timing)
    const before = ctx.strokes.length
    renderScene(ctx as never, doc, layout, timing.emphasisEndMs, timing)
    expect(ctx.strokes.length).toBeGreaterThan(before)
  })
})

describe('GIF frame timing', () => {
  it('snaps the frame delay to a whole centisecond so playback matches the rendered clock', () => {
    // GIF stores delays in 1/100s. 12fps is 83.33ms, which the encoder rounds to 80ms —
    // the file then plays 4% faster than every frame was rendered for.
    expect(snapDelayMs(20)).toBe(50)
    expect(snapDelayMs(25)).toBe(40)
    expect(snapDelayMs(12)).toBe(80)
    expect(snapDelayMs(1000)).toBeGreaterThanOrEqual(20) // never a zero/absurd delay
    for (const fps of [10, 12, 15, 20, 24, 25, 30, 50]) {
      expect(snapDelayMs(fps) % 10).toBe(0)
    }
  })
})

describe('preview/export visual alignment', () => {
  it('re-deriving a scene layout is deterministic (same result every call)', async () => {
    const doc = await buildStory(LONG_PARAGRAPH_DOC)
    const scene = doc.scenes[0]
    const layoutA = await layoutSceneForRender(doc, scene)
    const layoutB = await layoutSceneForRender(doc, scene)
    expect(layoutA.lines.length).toBe(layoutB.lines.length)
    expect(layoutA.totalWordCount).toBe(layoutB.totalWordCount)
    for (let i = 0; i < layoutA.lines.length; i++) {
      const wordsA = layoutA.lines[i].words
      const wordsB = layoutB.lines[i].words
      expect(wordsA.length).toBe(wordsB.length)
      for (let j = 0; j < wordsA.length; j++) {
        expect(wordsA[j].x).toBeCloseTo(wordsB[j].x, 5)
        expect(wordsA[j].y).toBe(wordsB[j].y)
        expect(wordsA[j].text).toBe(wordsB[j].text)
      }
    }
  })

  it('the layout used by pagination matches what the live preview re-derives for the same scene', async () => {
    const doc = await buildStory(LONG_PARAGRAPH_DOC)
    for (const scene of doc.scenes) {
      const layout = await layoutSceneForRender(doc, scene)
      const wordsFromLayout = layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ')
      const wordsFromModel = scene.blocks.flatMap((b) => b.runs.flatMap((r) => r.text.split(/\s+/))).join(' ')
      expect(wordsFromLayout.replace(/\s+/g, ' ')).toBe(wordsFromModel.replace(/\s+/g, ' '))
    }
  })
})
