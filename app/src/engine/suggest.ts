import type { AnimatedDocument, EmphasisPresetId, HighlightKind, TextRun } from './model'

/**
 * Picks an effect per phrase from what the phrase *is*.
 *
 * This is not a language model and does not pretend to be one — nothing leaves the browser,
 * which is a promise the product makes on its own front page. It is a set of rules over the
 * signals the highlight detector already extracted (kind, punctuation, position) plus a few
 * cheap lexical cues. That is enough to beat the current behaviour, which assigns an effect by
 * detector category alone and therefore gives every number the same treatment as every other
 * number, forever.
 *
 * The rules encode how a person actually marks up a page:
 *   a negation gets struck through, a quotation gets bracketed, a figure gets circled,
 *   a call to action gets the highlighter, and the closing line gets underlined.
 */

/** Words that flip a phrase's meaning — a person crosses these out rather than highlighting them. */
const NEGATION = /\b(no|not|never|none|nothing|don'?t|doesn'?t|didn'?t|won'?t|can'?t|cannot|isn'?t|aren'?t|wasn'?t|weren'?t|without|no longer|instead of)\b/i

/** Markers of enthusiasm — these want movement, not a ruled line. */
const EXCITED = /[!]|\b(amazing|incredible|huge|massive|thrilled|excited|delighted|congratulations|congrats|wow|finally|best|record|milestone)\b/i

/** Deadline / urgency language — worth a box, which reads as "note this". */
const URGENT = /\b(today|tomorrow|deadline|last chance|final|hurry|expires?|ends?|closing|due|asap|immediately)\b/i

export interface SuggestionRule {
  preset: EmphasisPresetId
  /** Why this was chosen — surfaced in the UI so the button is explicable, not magic. */
  reason: string
}

/**
 * Rotating alternatives, so a document with five figures does not get five identical circles.
 * Variety is picked by index, not at random, so the same document always suggests the same set.
 */
const VARIANTS: Record<string, EmphasisPresetId[]> = {
  emphasis: ['marker-highlight', 'underline-draw', 'bow-highlight', 'squiggle'],
  figure: ['circle-annotation', 'box-annotation', 'corner-marks'],
  quotation: ['bracket', 'underline-draw'],
  action: ['marker-highlight', 'arrow'],
  motion: ['gentle-pop', 'shimmer', 'soft-glow'],
}

function pick(group: keyof typeof VARIANTS, index: number): EmphasisPresetId {
  const options = VARIANTS[group]
  return options[index % options.length]
}

/**
 * The rule for one phrase. `index` is its position among the animated phrases, used only to
 * rotate between equally-good alternatives.
 */
export function suggestForPhrase(text: string, kind: HighlightKind, index: number): SuggestionRule {
  if (NEGATION.test(text)) {
    return { preset: 'strike-through', reason: 'reads as a negation' }
  }
  if (kind === 'quote') {
    return { preset: pick('quotation', index), reason: 'is a quotation' }
  }
  if (kind === 'number-date') {
    return { preset: pick('figure', index), reason: 'is a figure or a date' }
  }
  if (kind === 'cta') {
    return { preset: pick('action', index), reason: 'is a call to action' }
  }
  if (URGENT.test(text)) {
    return { preset: 'box-annotation', reason: 'carries a deadline' }
  }
  if (EXCITED.test(text)) {
    return { preset: pick('motion', index), reason: 'reads as enthusiastic' }
  }
  if (kind === 'final-sentence') {
    return { preset: 'underline-draw', reason: 'closes the message' }
  }
  if (kind === 'markup-primary') {
    return { preset: 'marker-highlight', reason: 'you marked it as primary' }
  }
  if (kind === 'markup-soft') {
    return { preset: 'underline-draw', reason: 'you marked it softly' }
  }
  if (kind === 'proper-noun') {
    return { preset: 'gentle-pop', reason: 'is a name' }
  }
  return { preset: pick('emphasis', index), reason: 'stands out in the sentence' }
}

export interface Suggestion {
  runId: string
  text: string
  from: EmphasisPresetId
  to: EmphasisPresetId
  reason: string
}

/**
 * Suggestions for every animated phrase in the document. Pure — returns what *would* change
 * without mutating anything, so the caller can show it before applying it.
 */
export function suggestEmphasis(doc: AnimatedDocument): Suggestion[] {
  const animated: TextRun[] = doc.scenes
    .flatMap((s) => s.blocks.flatMap((b) => b.runs))
    .filter((r) => r.highlight?.animated)

  return animated.map((run, index) => {
    const rule = suggestForPhrase(run.text, run.highlight!.kind, index)
    return {
      runId: run.id,
      text: run.text,
      from: run.highlight!.emphasisPreset,
      to: rule.preset,
      reason: rule.reason,
    }
  })
}

/** Applies suggestions in place, the same way the manual picker does. Returns how many changed. */
export function applySuggestions(doc: AnimatedDocument, suggestions: Suggestion[]): number {
  const byRunId = new Map(suggestions.map((s) => [s.runId, s]))
  let changed = 0
  for (const scene of doc.scenes) {
    for (const block of scene.blocks) {
      for (const run of block.runs) {
        const suggestion = run.highlight && byRunId.get(run.id)
        if (!suggestion) continue
        if (run.highlight!.emphasisPreset !== suggestion.to) changed++
        run.highlight!.emphasisPreset = suggestion.to
      }
    }
  }
  return changed
}
