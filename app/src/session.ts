import type { OutputMode } from './engine/model'

/**
 * The typed message, kept across reloads.
 *
 * Until now a refresh, a crash, or a closed tab lost the message outright — for a tool whose
 * whole input is something a person composed by hand, that is the worst thing it could do.
 * Storage is local only; nothing here changes the promise that nothing leaves the browser.
 */

const KEY = 'animate-your-email:draft:v1'

export interface Draft {
  text: string
  mode: OutputMode | null
  speed: number
  holdMs: number
}

/**
 * Every access is guarded. localStorage throws rather than returning null in a private window
 * with storage disabled, and in a cross-origin iframe — losing the draft is bad, but taking the
 * whole app down to save it would be worse.
 */
function storage(): Storage | null {
  try {
    const s = window.localStorage
    const probe = '__aye__'
    s.setItem(probe, probe)
    s.removeItem(probe)
    return s
  } catch {
    return null
  }
}

export function loadDraft(): Draft | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Draft>
    if (typeof parsed.text !== 'string' || parsed.text.trim() === '') return null
    return {
      text: parsed.text,
      // Anything unrecognised falls back rather than being trusted: this is data the user
      // could have edited by hand, and a bad mode would break the build.
      mode:
        parsed.mode === 'one-card' || parsed.mode === 'paragraph' || parsed.mode === 'story'
          ? parsed.mode
          : null,
      speed: typeof parsed.speed === 'number' && Number.isFinite(parsed.speed) ? parsed.speed : 1,
      holdMs: typeof parsed.holdMs === 'number' && Number.isFinite(parsed.holdMs) ? parsed.holdMs : 800,
    }
  } catch {
    return null
  }
}

export function saveDraft(draft: Draft): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(KEY, JSON.stringify(draft))
  } catch {
    // Quota exceeded on a very long draft — the app keeps working, the draft just isn't kept.
  }
}

export function clearDraft(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(KEY)
  } catch {
    /* nothing useful to do */
  }
}
