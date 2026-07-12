import type { EmphasisPresetId, HighlightKind, TextRun } from './model'
import { MAX_ANIMATED_FRACTION } from './model'

/**
 * Deterministic highlight detection — no LLM. Scans raw text for phrase-level markup
 * and heuristic categories (in the priority order the product spec lists), resolves
 * overlaps by priority, then caps total animated coverage to MAX_ANIMATED_FRACTION of
 * the text. Every remaining word becomes its own clickable TextRun (default
 * animated:false) so "click any word to toggle" has something to click.
 */

interface Candidate {
  start: number
  end: number
  kind: HighlightKind
  priority: number
  /** For markup kinds, the delimiters are stripped from the rendered text. */
  renderedText: string
}

const PRESET_BY_KIND: Record<HighlightKind, EmphasisPresetId> = {
  'markup-soft': 'soft-glow',
  'markup-primary': 'marker-highlight',
  quote: 'underline-draw',
  'number-date': 'weight-shift',
  'proper-noun': 'gentle-pop',
  'final-sentence': 'shimmer',
  cta: 'marker-highlight',
  'content-word': 'gentle-pop',
}

const CTA_PHRASES = [
  'click here', 'learn more', 'sign up', 'get started', 'shop now', 'read more',
  'join now', 'register now', 'book now', 'order now', 'contact us', 'apply now',
  'download now', 'try it free', 'start your trial', 'see more', 'find out more',
  'don’t miss out', 'act now', 'reserve your spot', 'get yours today',
]

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const MARKUP_SOFT_RE = /\*([^*\n]{1,120})\*/g
const MARKUP_PRIMARY_RE = /\[\[([^\]\n]{1,120})\]\]/g
const QUOTE_RE = /["“]([^"”\n]{2,120})["”]/g
const NUMBER_DATE_RE =
  /\$\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?%|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?\b|\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,?\s*\d{4})?\b|\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b|\b\d{4}\b|\b\d[\d,]*(?:\.\d+)?\b/g
// \p{Lu}\p{Ll} (uppercase letter + lowercase letters) works for any script's cased
// letters via Unicode property escapes — covers Latin and Cyrillic names alike.
const PROPER_NOUN_RE = /\p{Lu}\p{Ll}+(?:[\s ]\p{Lu}\p{Ll}+){0,2}/gu
const CTA_RE = new RegExp('\\b(' + CTA_PHRASES.map(escapeRegExp).join('|') + ')\\b', 'gi')
const SENTENCE_SPLIT_RE = /(?<=[.!?])\s+/

function findAll(re: RegExp, text: string, kind: HighlightKind, priority: number): Candidate[] {
  const out: Candidate[] = []
  let m: RegExpExecArray | null
  re.lastIndex = 0
  while ((m = re.exec(text))) {
    // The candidate span always covers the FULL match (m.index..m.index+m[0].length),
    // even for delimited markup where renderedText is just the inner captured group —
    // the delimiters must be consumed as part of the span, not left as literal text in
    // the surrounding plain-text gap.
    const captured = m[1] ?? m[0]
    const start = m.index
    const end = m.index + m[0].length
    out.push({ start, end, kind, priority, renderedText: captured })
    if (m[0].length === 0) re.lastIndex++
  }
  return out
}

function findProperNouns(text: string): Candidate[] {
  const candidates = findAll(PROPER_NOUN_RE, text, 'proper-noun', 5)
  const sentenceStarts = new Set<number>([0])
  let idx = 0
  for (const s of text.split(SENTENCE_SPLIT_RE)) {
    idx += s.length
    // skip whitespace to find the next sentence's real start
    while (idx < text.length && /\s/.test(text[idx])) idx++
    sentenceStarts.add(idx)
  }
  return candidates.filter((c) => {
    const isSentenceStart = sentenceStarts.has(c.start)
    const isMultiWord = /\s/.test(c.renderedText)
    return !isSentenceStart || isMultiWord
  })
}

function findFinalSentence(text: string): Candidate[] {
  const sentences = text.split(SENTENCE_SPLIT_RE).filter((s) => s.trim().length > 0)
  if (sentences.length === 0) return []
  const last = sentences[sentences.length - 1]
  const start = text.lastIndexOf(last)
  if (start < 0) return []
  return [{ start, end: start + last.length, kind: 'final-sentence', priority: 6, renderedText: last }]
}

function resolveOverlaps(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => a.priority - b.priority || a.start - b.start)
  const accepted: Candidate[] = []
  for (const c of sorted) {
    const overlaps = accepted.some((a) => c.start < a.end && c.end > a.start)
    if (!overlaps && c.end > c.start) accepted.push(c)
  }
  return accepted.sort((a, b) => a.start - b.start)
}

let runCounter = 0
function nextRunId(): string {
  runCounter += 1
  return `run-${runCounter}`
}

/** Splits a plain-text gap into individually clickable per-word runs, marking newlines as paragraph breaks. */
function wordRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  for (const token of text.split(/(\s+)/)) {
    if (token.length === 0) continue
    if (/^\s+$/.test(token)) {
      if (token.includes('\n')) runs.push({ id: nextRunId(), text: '', isBreak: true })
      continue
    }
    runs.push({
      id: nextRunId(),
      text: token,
      highlight: { kind: 'content-word', priority: 8, animated: false, emphasisPreset: 'gentle-pop' },
    })
  }
  return runs
}

export function detectHighlights(text: string): TextRun[] {
  const candidates = resolveOverlaps([
    ...findAll(MARKUP_SOFT_RE, text, 'markup-soft', 1),
    ...findAll(MARKUP_PRIMARY_RE, text, 'markup-primary', 2),
    ...findAll(QUOTE_RE, text, 'quote', 3),
    ...findAll(NUMBER_DATE_RE, text, 'number-date', 4),
    ...findProperNouns(text),
    ...findFinalSentence(text),
    ...findAll(CTA_RE, text, 'cta', 7),
  ])

  const runs: TextRun[] = []
  let cursor = 0
  for (const c of candidates) {
    if (c.start > cursor) runs.push(...wordRuns(text.slice(cursor, c.start)))
    runs.push({
      id: nextRunId(),
      text: c.renderedText,
      highlight: { kind: c.kind, priority: c.priority, animated: true, emphasisPreset: PRESET_BY_KIND[c.kind] },
    })
    cursor = c.end
  }
  if (cursor < text.length) runs.push(...wordRuns(text.slice(cursor)))

  applyGlobalCap(runs, text.length)
  return runs
}

function applyGlobalCap(runs: TextRun[], totalLength: number) {
  const budget = Math.floor(totalLength * MAX_ANIMATED_FRACTION)
  const phraseRuns = runs.filter((r) => r.highlight && r.highlight.kind !== 'content-word')
  phraseRuns.sort((a, b) => a.highlight!.priority - b.highlight!.priority || b.text.length - a.text.length)

  let used = 0
  for (const r of phraseRuns) {
    if (used + r.text.length <= budget) {
      used += r.text.length
    } else {
      r.highlight!.animated = false
    }
  }

  // If budget remains, fill with the longest content words (spec's last-priority tier).
  if (used < budget) {
    const contentWords = runs
      .filter((r) => r.highlight?.kind === 'content-word' && r.text.length >= 7)
      .sort((a, b) => b.text.length - a.text.length)
    for (const r of contentWords) {
      if (used + r.text.length > budget) break
      r.highlight!.animated = true
      used += r.text.length
    }
  }
}
