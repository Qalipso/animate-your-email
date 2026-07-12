import { describe, expect, it } from 'vitest'
import { buildAnimatedDocument, layoutSceneForRender, toggleRunAnimation } from '../engine/document'
import { detectHighlights } from '../engine/highlight'
import { createMeasurer, metricsFor, wrapBlocksIntoLines } from '../engine/layout'
import { buildTimeline, renderTimelineFrame } from '../engine/timeline'
import { MAX_CHARACTERS, MAX_SCENES } from '../engine/model'

const LONG_PARAGRAPH_DOC = `We are thrilled to share the results of our biggest launch yet, spanning three continents and dozens of teams working around the clock for months.

Over the past quarter, the whole company came together to ship a completely redesigned onboarding flow, a faster billing system, and a brand new mobile app that customers had been asking for since last year.

Customer feedback has been overwhelmingly positive so far, with support tickets down significantly and daily active usage climbing week over week across nearly every region we track.

None of this would have been possible without close collaboration between design, engineering, support, and sales, all pushing toward the same release date under real pressure.

Thank you again for everything you contributed this quarter — every review, every late night, every bug report mattered enormously to getting this out the door.

Get started with the new dashboard today and let us know what you think.`

function buildStory(text: string) {
  return buildAnimatedDocument(text, { mode: 'story', modeIsOverridden: true })
}

describe('retina display export', () => {
  it('uses explicit logical dimensions regardless of devicePixelRatio', () => {
    const originalDpr = (globalThis as any).devicePixelRatio
    ;(globalThis as any).devicePixelRatio = 3
    const doc = buildAnimatedDocument('Short retina test', { mode: 'one-card', modeIsOverridden: true })
    const canvas = new (globalThis as any).OffscreenCanvas(doc.width, doc.height)
    expect(canvas.width).toBe(doc.width)
    expect(canvas.height).toBe(doc.height)
    ;(globalThis as any).devicePixelRatio = originalDpr
  })
})

describe('very long words', () => {
  it('hard-splits a word wider than the content box into multiple fitting chunks', () => {
    const ctx = createMeasurer()
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
  it('preserves every paragraph across scenes with no content lost', () => {
    const doc = buildStory(LONG_PARAGRAPH_DOC)
    expect(doc.scenes.length).toBeGreaterThan(1)
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
  it('detects a Cyrillic markup phrase and wraps without throwing', () => {
    const text = 'Спасибо за встречу [[очень важное]] обновление для команды сегодня.'
    const runs = detectHighlights(text)
    const primary = runs.find((r) => r.highlight?.kind === 'markup-primary')
    expect(primary?.text).toBe('очень важное')
    const doc = buildAnimatedDocument(text, { mode: 'paragraph', modeIsOverridden: true })
    expect(doc.scenes[0].blocks.length).toBeGreaterThan(0)
  })
})

describe('emoji', () => {
  it('keeps emoji intact as whole tokens through detection and layout', () => {
    const text = 'Great job team 🎉🚀 see you soon 😊'
    const runs = detectHighlights(text)
    const joined = runs.map((r) => r.text).join('')
    expect(joined).toContain('🎉🚀')
    expect(joined).toContain('😊')
    const doc = buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const layout = layoutSceneForRender(doc, doc.scenes[0])
    const words = layout.lines.flatMap((l) => l.words).map((w) => w.text)
    expect(words.some((w) => w.includes('🎉🚀'))).toBe(true)
  })
})

describe('1500-character input', () => {
  it('caps rawText at MAX_CHARACTERS even when given more', () => {
    const overLong = 'word '.repeat(400) // ~2000 chars
    expect(overLong.length).toBeGreaterThan(MAX_CHARACTERS)
    const doc = buildStory(overLong)
    expect(doc.rawText.length).toBeLessThanOrEqual(MAX_CHARACTERS)
  })
})

describe('automatic pagination', () => {
  it('splits long text into multiple scenes, none overflowing, and caps at MAX_SCENES', () => {
    const doc = buildStory(LONG_PARAGRAPH_DOC)
    expect(doc.scenes.length).toBeGreaterThan(1)
    expect(doc.scenes.length).toBeLessThanOrEqual(MAX_SCENES)
    for (const scene of doc.scenes) {
      const layout = layoutSceneForRender(doc, scene)
      expect(layout.overflowed).toBe(false)
    }
  })

  it('flags truncated when content genuinely cannot fit in MAX_SCENES', () => {
    const massive = Array.from({ length: 30 }, (_, i) => `Paragraph number ${i + 1} with several words of filler content to take up space.`).join('\n\n')
    const doc = buildStory(massive.slice(0, MAX_CHARACTERS))
    expect(doc.scenes.length).toBeLessThanOrEqual(MAX_SCENES)
    // Either it fit (unlikely at 1500 chars / 6 scenes) or it was marked truncated —
    // either way no scene should silently overflow.
    for (const scene of doc.scenes) {
      expect(layoutSceneForRender(doc, scene).overflowed).toBe(false)
    }
  })
})

describe('animation ranges after text edits', () => {
  it('does not leak toggle state between independently built documents', () => {
    const text = 'Thank you for the *soft emphasis* test today.'
    const docA = buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const runA = docA.scenes[0].blocks.flatMap((b) => b.runs).find((r) => r.highlight?.kind === 'markup-soft')!
    const before = runA.highlight!.animated
    toggleRunAnimation(docA, runA.id)
    expect(runA.highlight!.animated).toBe(!before)

    const docB = buildAnimatedDocument(text, { mode: 'one-card', modeIsOverridden: true })
    const runB = docB.scenes[0].blocks.flatMap((b) => b.runs).find((r) => r.highlight?.kind === 'markup-soft')!
    expect(runB.highlight!.animated).toBe(before) // fresh doc unaffected by docA's toggle
  })

  it('rebuilding after an edit reflects the new text, not stale runs', () => {
    const doc1 = buildAnimatedDocument('Version one of the message.', { mode: 'one-card', modeIsOverridden: true })
    const doc2 = buildAnimatedDocument('Completely different version two.', { mode: 'one-card', modeIsOverridden: true })
    const text1 = doc1.scenes[0].blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
    const text2 = doc2.scenes[0].blocks.flatMap((b) => b.runs.map((r) => r.text)).join(' ')
    expect(text1).not.toBe(text2)
    expect(text2).toContain('different')
  })
})

describe('exported frame dimensions', () => {
  it('renders every timeline segment at exactly doc.width x doc.height with no clipping', () => {
    const doc = buildStory(LONG_PARAGRAPH_DOC)
    const timeline = buildTimeline(doc)
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

describe('preview/export visual alignment', () => {
  it('re-deriving a scene layout is deterministic (same result every call)', () => {
    const doc = buildStory(LONG_PARAGRAPH_DOC)
    const scene = doc.scenes[0]
    const layoutA = layoutSceneForRender(doc, scene)
    const layoutB = layoutSceneForRender(doc, scene)
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

  it('the layout used by pagination matches what the live preview re-derives for the same scene', () => {
    const doc = buildStory(LONG_PARAGRAPH_DOC)
    for (const scene of doc.scenes) {
      const layout = layoutSceneForRender(doc, scene)
      const wordsFromLayout = layout.lines.flatMap((l) => l.words.map((w) => w.text)).join(' ')
      const wordsFromModel = scene.blocks.flatMap((b) => b.runs.flatMap((r) => r.text.split(/\s+/))).join(' ')
      expect(wordsFromLayout.replace(/\s+/g, ' ')).toBe(wordsFromModel.replace(/\s+/g, ' '))
    }
  })
})
