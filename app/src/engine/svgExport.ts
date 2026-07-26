import { layoutSceneForRender } from './document'
import { FONT_FAMILY, PADDING } from './layout'
import { materialFor, paintAxis, type Paint } from './materials'
import {
  buildPhrases,
  contentOffsetY,
  forEachSweptSegment,
  phrasePaintBox,
  sceneTimingFor,
  type Phrase,
} from './render'
import { seededRandom, sketchEllipsePaths, sketchLinePaths, sketchRectPaths } from './sketch'
import type { AnimatedDocument, EmphasisPresetId, Scene, TextLayout } from './model'

/**
 * A vector version of the same document.
 *
 * Why this is not "the GIF but better": SVG is blocked or stripped by essentially every mail
 * client (Gmail removes it outright, Outlook will not render it), so this is deliberately NOT
 * an email export. It is for the web — a page, a README, a link — where it is a fraction of
 * the size, stays sharp at any zoom, and keeps the words as real selectable text.
 *
 * The geometry comes from exactly the same functions the canvas renderer uses (layout ->
 * buildPhrases -> sketch*Paths), so the two backends cannot draw different shapes. Only the
 * *animation* mechanism differs: canvas draws a frame at time t, SVG declares CSS keyframes
 * over the same timeline.
 */

/**
 * Presets whose motion is a stroke being drawn, which CSS can express exactly via
 * stroke-dashoffset. Everything else is per-glyph or particle work whose *settled* state is
 * just the text — so an SVG renders those phrases at rest rather than faking them.
 */
const ANIMATABLE_IN_SVG: ReadonlySet<EmphasisPresetId> = new Set<EmphasisPresetId>([
  'marker-highlight',
  'bow-highlight',
  'underline-draw',
  'strike-through',
  'circle-annotation',
  'box-annotation',
  'bracket',
])

const INK = {
  marker: 'rgba(255, 214, 79, 0.62)',
  bow: 'rgba(255, 133, 178, 0.45)',
  blue: '#2b6cff',
  red: '#e0463a',
  text: '#1a1a1a',
  burnt: 'rgb(196,62,20)',
}

/** easeOutCubic, matching engine/easing.ts so the SVG accelerates like the canvas does. */
const EASE_OUT_CUBIC = 'cubic-bezier(0.215, 0.61, 0.355, 1)'

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

function round(v: number): number {
  return Math.round(v * 100) / 100
}

interface StrokeSpec {
  paths: string[]
  /** Backend-neutral material, resolved to a <linearGradient> below. */
  paint: Paint
  width: number
  cap: 'round' | 'butt'
}

/** Every stroke an annotation is made of, at its finished shape. Progress is animated in CSS. */
function annotationStrokes(phrase: Phrase, ox: number, oy: number, fontSize: number): StrokeSpec[] {
  const rand = seededRandom(`${phrase.runId}:${phrase.preset}`)
  const markerRand = seededRandom(`${phrase.runId}:marker`)
  const stroke = Math.max(2, fontSize * 0.055)
  const roughness = fontSize * 0.05
  const out: StrokeSpec[] = []

  if (phrase.preset === 'marker-highlight' || phrase.preset === 'bow-highlight') {
    const paths: string[] = []
    forEachSweptSegment(phrase, 1, (seg, sweptTo) => {
      const y = oy + seg.y + fontSize * 0.53
      paths.push(
        ...sketchLinePaths(ox + seg.x0 - 1, y, ox + sweptTo + 1, y, 1, markerRand, {
          roughness: fontSize * 0.045,
          passes: 2,
        }),
      )
    })
    out.push({
      paths,
      paint: materialFor(phrase.preset, phrase.preset === 'marker-highlight' ? INK.marker : INK.bow),
      width: fontSize * 0.82,
      cap: 'round',
    })
    return out
  }

  if (phrase.preset === 'underline-draw' || phrase.preset === 'strike-through') {
    const paths: string[] = []
    const dy = phrase.preset === 'underline-draw' ? fontSize * 0.78 + fontSize * 0.14 : fontSize * 0.52
    forEachSweptSegment(phrase, 1, (seg, sweptTo) => {
      const y = oy + seg.y + dy
      paths.push(...sketchLinePaths(ox + seg.x0, y, ox + sweptTo, y, 1, rand, { roughness, passes: 2 }))
    })
    out.push({
      paths,
      paint: materialFor(phrase.preset, phrase.preset === 'underline-draw' ? INK.blue : INK.red),
      width: stroke,
      cap: 'round',
    })
    return out
  }

  if (phrase.preset === 'circle-annotation') {
    const paths: string[] = []
    for (const seg of phrase.segments) {
      const w = seg.x1 - seg.x0
      paths.push(
        ...sketchEllipsePaths(
          ox + seg.x0 + w / 2,
          oy + seg.y + fontSize * 0.5,
          w / 2 + fontSize * 0.28,
          fontSize * 0.66,
          1,
          rand,
          { roughness: roughness * 1.4, passes: 2 },
        ),
      )
    }
    out.push({ paths, paint: materialFor(phrase.preset, INK.red), width: stroke, cap: 'round' })
    return out
  }

  if (phrase.preset === 'box-annotation') {
    const paths: string[] = []
    for (const seg of phrase.segments) {
      const padX = fontSize * 0.24
      const padY = fontSize * 0.1
      paths.push(
        ...sketchRectPaths(
          ox + seg.x0 - padX,
          oy + seg.y - padY,
          seg.x1 - seg.x0 + padX * 2,
          fontSize * 1.05 + padY,
          1,
          rand,
          { roughness: roughness * 1.9, passes: 2 },
        ),
      )
    }
    out.push({ paths, paint: materialFor(phrase.preset, INK.blue), width: stroke, cap: 'round' })
    return out
  }

  if (phrase.preset === 'bracket') {
    const paths: string[] = []
    for (const seg of phrase.segments) {
      const top = oy + seg.y + fontSize * 0.04
      const bottom = top + fontSize * 0.98
      const arm = fontSize * 0.22
      const left = ox + seg.x0 - fontSize * 0.34
      const right = ox + seg.x1 + fontSize * 0.34
      for (const [x, dir] of [
        [left, 1],
        [right, -1],
      ] as [number, number][]) {
        paths.push(...sketchLinePaths(x, top, x, bottom, 1, rand, { roughness, passes: 2 }))
        paths.push(...sketchLinePaths(x, top, x + arm * dir, top, 1, rand, { roughness, passes: 1 }))
        paths.push(...sketchLinePaths(x, bottom, x + arm * dir, bottom, 1, rand, { roughness, passes: 1 }))
      }
    }
    out.push({ paths, paint: materialFor(phrase.preset, INK.blue), width: stroke, cap: 'round' })
    return out
  }

  return out
}

export interface SvgExportResult {
  svg: string
  /** Presets present in the document that this format renders at rest instead of animating. */
  staticPresets: EmphasisPresetId[]
}

export function buildSceneSvg(doc: AnimatedDocument, layout: TextLayout): SvgExportResult {
  const timing = sceneTimingFor(doc, layout)
  const ox = PADDING
  const oy = contentOffsetY(doc, layout)
  const phrases = buildPhrases(layout)
  const total = Math.max(1, timing.totalMs)

  const keyframes: string[] = []
  const strokeMarkup: string[] = []
  const defs: string[] = []
  const staticPresets = new Set<EmphasisPresetId>()
  const isMarkerInk = new Set<number>()

  phrases.forEach((phrase, i) => {
    if (!ANIMATABLE_IN_SVG.has(phrase.preset)) {
      staticPresets.add(phrase.preset)
      return
    }
    const start = timing.emphasisStartMs + phrase.animatedIndex * timing.phraseStaggerMs
    const end = start + timing.phraseDurationMs
    const startPct = round((start / total) * 100)
    const endPct = round((Math.min(end, total) / total) * 100)

    // pathLength="1" lets the dash animation be declared without knowing the real arc length,
    // which is not computable outside a DOM.
    keyframes.push(
      `@keyframes draw-${i}{0%,${startPct}%{stroke-dashoffset:1}${endPct}%,100%{stroke-dashoffset:0}}`,
    )

    const box = phrasePaintBox(phrase, ox, oy, doc.fontSize)
    const specs = annotationStrokes(phrase, ox, oy, doc.fontSize)
    specs.forEach((spec, specIndex) => {
      let paint: string
      if (spec.paint.kind === 'solid') {
        paint = spec.paint.colour
      } else {
        // userSpaceOnUse over the same box the canvas gradient uses, so both backends shade
        // the stroke identically.
        const id = `ink-${i}-${specIndex}`
        const a = paintAxis(spec.paint, box)
        defs.push(
          `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${round(a.x1)}" y1="${round(
            a.y1,
          )}" x2="${round(a.x2)}" y2="${round(a.y2)}">` +
            spec.paint.stops
              .map((st) => `<stop offset="${round(st.at * 100)}%" stop-color="${st.colour}"/>`)
              .join('') +
            `</linearGradient>`,
        )
        paint = `url(#${id})`
      }
      const isMarker = phrase.preset === 'marker-highlight' || phrase.preset === 'bow-highlight'
      for (const d of spec.paths) {
        if (isMarker) isMarkerInk.add(strokeMarkup.length)
        strokeMarkup.push(
          `<path d="${d}" pathLength="1" fill="none" stroke="${paint}" stroke-width="${round(
            spec.width,
          )}" stroke-linecap="${spec.cap}" style="stroke-dasharray:1;animation:draw-${i} ${total}ms ${EASE_OUT_CUBIC} infinite"/>`,
        )
      }
    })
  })

  const words = layout.lines.flatMap((l) => l.words)
  const textMarkup = words
    .map((w) => {
      // Burn is the one non-annotation preset whose *settled* look is not plain text: the
      // glyph stays burnt. Everything else rests as ordinary text, which is why rendering
      // them statically is faithful rather than a fudge.
      const burnt = w.highlight?.animated && w.highlight.emphasisPreset === 'burn'
      return `<text x="${round(ox + w.x)}" y="${round(oy + w.y + doc.fontSize * 0.78)}" fill="${
        burnt ? INK.burnt : INK.text
      }">${escapeXml(w.text)}</text>`
    })
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${doc.width} ${doc.height}" width="${doc.width}" height="${doc.height}" role="img" aria-label="${escapeXml(
      doc.rawText.slice(0, 300),
    )}">` +
    `<style>text{font-family:${FONT_FAMILY};font-size:${doc.fontSize}px;dominant-baseline:alphabetic}` +
    `@media (prefers-reduced-motion:reduce){path{animation:none!important;stroke-dashoffset:0!important}}` +
    keyframes.join('') +
    `</style>` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') +
    `<rect width="${doc.width}" height="${doc.height}" fill="#ffffff"/>` +
    // Marker ink sits under the glyphs; the drawn annotations sit over them, matching the
    // canvas renderer's three-pass layering. Tracked by index rather than by sniffing the
    // markup, which stopped working once the colour became a gradient reference.
    strokeMarkup.filter((_, idx) => isMarkerInk.has(idx)).join('') +
    textMarkup +
    strokeMarkup.filter((_, idx) => !isMarkerInk.has(idx)).join('') +
    `</svg>`

  return { svg, staticPresets: [...staticPresets] }
}

export async function exportSceneAsSvg(doc: AnimatedDocument, scene: Scene): Promise<SvgExportResult> {
  const layout = await layoutSceneForRender(doc, scene)
  return buildSceneSvg(doc, layout)
}
