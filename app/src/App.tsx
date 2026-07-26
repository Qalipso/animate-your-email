import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  applyEmphasisToWordRange,
  buildAnimatedDocument,
  findBlockIdForRun,
  layoutSceneForRender,
  toggleRunAnimation,
} from './engine/document'
import { cancelExport, exportDocumentAsGif, exportSceneAsPng, ExportCancelledError } from './engine/exportV2'
import { exportSceneAsSvg } from './engine/svgExport'
import { MODE_PRESETS, autoSelectMode } from './engine/modeSelect'
import { contentOffsetY, renderScene, sceneTimingFor } from './engine/render'
import { PADDING } from './engine/layout'
import type { AnimatedDocument, EmphasisPresetId, LayoutWord, OutputMode, TextLayout } from './engine/model'
import {
  DEFAULT_HOLD_MS,
  DEFAULT_SPEED,
  MAX_CHARACTERS,
  MAX_HOLD_MS,
  MAX_SPEED,
  MIN_HOLD_MS,
  MIN_SPEED,
} from './engine/model'
import './App.css'

const GENERATE_DEBOUNCE_MS = 400
/** Beat of stillness at the end of a preview loop before it starts over. */
const LOOP_PAUSE_MS = 700

/** A mode's un-shrunk type size, so the UI can tell the reader when the fitter stepped it down. */
const BASE_FONT_SIZE: Record<OutputMode, number> = {
  'one-card': MODE_PRESETS['one-card'].fontSize,
  paragraph: MODE_PRESETS.paragraph.fontSize,
  story: MODE_PRESETS.story.fontSize,
}

const TEMPLATE_OPTIONS: { id: OutputMode | 'auto'; name: string; hint: string }[] = [
  { id: 'auto', name: 'Auto', hint: 'Pick a size from the length of the text' },
  { id: 'one-card', name: 'Card', hint: 'Large type for a short line' },
  { id: 'paragraph', name: 'Paragraph', hint: 'Reading size for a paragraph' },
  { id: 'story', name: 'Story', hint: 'Compact type for long text' },
]

/**
 * `swatch` is the colour the effect actually paints with, so the picker previews the
 * result instead of being ten identical rows of text.
 */
const EMPHASIS_OPTIONS: { id: EmphasisPresetId; name: string; swatch: string }[] = [
  { id: 'marker-highlight', name: 'Marker Highlight', swatch: '#ffd64f' },
  { id: 'underline-draw', name: 'Underline Draw', swatch: '#2b6cff' },
  { id: 'soft-glow', name: 'Soft Glow', swatch: '#6d9dff' },
  { id: 'gentle-pop', name: 'Gentle Pop', swatch: '#1a1a1a' },
  { id: 'shimmer', name: 'Shimmer', swatch: '#c9d4e8' },
  { id: 'weight-shift', name: 'Weight Shift', swatch: '#4a4a4a' },
  { id: 'burn', name: 'Burn', swatch: '#c43e14' },
  { id: 'wash-away', name: 'Wash Away', swatch: '#789ab0' },
  { id: 'bow-highlight', name: 'Pink Highlight + Bow', swatch: '#ff85b2' },
  { id: 'glitch', name: 'Glitch', swatch: '#3cdcff' },
  { id: 'circle-annotation', name: 'Circle It', swatch: '#e0463a' },
  { id: 'box-annotation', name: 'Box It', swatch: '#2b6cff' },
  { id: 'bracket', name: 'Brackets', swatch: '#2b6cff' },
  { id: 'strike-through', name: 'Strike Through', swatch: '#e0463a' },
]

type StatusKind = 'info' | 'success' | 'error'
interface Status {
  kind: StatusKind
  text: string
}

/** A phrase the user has singled out and can now apply an effect to. */
interface EffectTarget {
  blockId: string
  firstRunId: string
  lastRunId: string
  label: string
}

/** Finds the line/word nearest a point — forgiving hit test used while extending a drag selection. */
function hitTestNearestWord(layout: TextLayout, x: number, y: number): number | null {
  if (layout.lines.length === 0) return null
  let bestLine = layout.lines[0]
  let bestLineDist = Infinity
  for (const line of layout.lines) {
    const dist = Math.abs(line.y + line.height / 2 - y)
    if (dist < bestLineDist) {
      bestLineDist = dist
      bestLine = line
    }
  }
  if (bestLine.words.length === 0) return null
  let bestWord: LayoutWord = bestLine.words[0]
  let bestWordDist = Infinity
  for (const w of bestLine.words) {
    const dist = Math.abs(w.x + w.width / 2 - x)
    if (dist < bestWordDist) {
      bestWordDist = dist
      bestWord = w
    }
  }
  let flatIdx = 0
  for (const line of layout.lines) {
    for (const w of line.words) {
      if (w === bestWord) return flatIdx
      flatIdx++
    }
  }
  return null
}

/** Exact box hit test — used for a plain click/right-click so clicking blank space does nothing. */
function hitTestWordStrict(layout: TextLayout, x: number, y: number): number | null {
  let flatIdx = 0
  for (const line of layout.lines) {
    for (const w of line.words) {
      if (x >= w.x && x <= w.x + w.width && y >= w.y && y <= w.y + w.height) return flatIdx
      flatIdx++
    }
  }
  return null
}

const SAMPLE_TEXT =
  'Thank you for joining us at the *product launch* today.\n\n' +
  'We announced [[three major updates]] and shared a live demo with over 200 attendees on July 12, 2026.\n\n' +
  'One customer told us "this is exactly what we needed" — and that stuck with the whole team.\n\n' +
  'Get started with the new features today.'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

type ClipboardCapability = 'gif' | 'still-only' | 'none'

/**
 * What this browser will actually accept on the clipboard, resolved once up front so the
 * buttons can be labelled for what they really do.
 *
 * The Async Clipboard API's image write is limited to a small allowlist, and `image/gif` is
 * not on it in Chromium (verified: `ClipboardItem.supports('image/gif') === false`, Chrome
 * 148). Offering a button called "Copy GIF" that quietly puts a *still* PNG on the clipboard
 * is the single most misleading thing this app could do — a user pastes it into an email and
 * finds out much later. So the capability decides which action is primary and what it is
 * called, before the click rather than in a status message after it.
 */
function detectClipboardCapability(): ClipboardCapability {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return 'none'
  // No supports() to ask (older Safari): stay optimistic — the write path surfaces a real failure.
  if (typeof ClipboardItem.supports !== 'function') return 'gif'
  if (ClipboardItem.supports('image/gif')) return 'gif'
  return ClipboardItem.supports('image/png') ? 'still-only' : 'none'
}

function App() {
  const [rawText, setRawText] = useState(SAMPLE_TEXT)
  const [modeOverride, setModeOverride] = useState<OutputMode | null>(null)
  const [doc, setDoc] = useState<AnimatedDocument | null>(null)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState<Status | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [layout, setLayout] = useState<TextLayout | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [effectTarget, setEffectTarget] = useState<EffectTarget | null>(null)
  const [isLooping, setIsLooping] = useState(() => !prefersReducedMotion())
  const [clipboard] = useState(detectClipboardCapability)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [holdMs, setHoldMs] = useState(DEFAULT_HOLD_MS)
  const [replayNonce, setReplayNonce] = useState(0)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const anchorIndexRef = useRef<number | null>(null)
  // Mirrors `selection` state for use inside handlers that fire in quick succession
  // (mousedown -> mousemove -> mouseup -> contextmenu): React state updates are batched,
  // so a handler later in the same gesture can otherwise read a stale `selection` from
  // before the drag. The ref is always current; `selection` state exists only to drive
  // the overlay-redraw effect.
  const selectionRef = useRef<{ start: number; end: number } | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  // Guards against an in-flight generation from an earlier (superseded) text/template
  // change resolving after a newer one and clobbering it with stale content.
  const generationIdRef = useRef(0)
  // Read by the (deliberately un-debounced-on-tempo) build effect so a rebuild triggered by a
  // text or template change picks up the current slider values without the sliders themselves
  // being build dependencies — see handleSpeedChange.
  const speedRef = useRef(speed)
  const holdRef = useRef(holdMs)
  speedRef.current = speed
  holdRef.current = holdMs

  const effectiveMode = modeOverride ?? autoSelectMode(rawText)
  // Documents are always a single frame — everything the user pasted has to be readable at
  // once, so the builder fits it rather than paginating (see fitIntoOneFrame).
  const scene = doc?.scenes[0] ?? null

  const updateSelection = useCallback((next: { start: number; end: number } | null) => {
    selectionRef.current = next
    setSelection(next)
  }, [])

  const clearTargeting = useCallback(() => {
    updateSelection(null)
    setEffectTarget(null)
    setContextMenu(null)
  }, [updateSelection])

  // Auto-generate the preview whenever the text or template settings change — no
  // separate "Generate" step. Debounced so it doesn't rebuild on every keystroke.
  useEffect(() => {
    if (!rawText.trim()) {
      setDoc(null)
      setIsGenerating(false)
      return
    }
    setIsGenerating(true)
    const timer = setTimeout(() => {
      const genId = ++generationIdRef.current
      buildAnimatedDocument(rawText, {
        mode: effectiveMode,
        modeIsOverridden: modeOverride !== null,
        speed: speedRef.current,
        holdMs: holdRef.current,
      }).then((built) => {
        if (generationIdRef.current !== genId) return // superseded by a newer change
        setDoc(built)
        setVersion((v) => v + 1)
        setStatus(
          built.truncated
            ? {
                kind: 'info',
                text: 'Even at the smallest readable size this much text does not fit in one image — the end was cut. Shorten it to keep everything.',
              }
            : null,
        )
        setIsGenerating(false)
      })
    }, GENERATE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, effectiveMode, modeOverride])

  // Re-derive the current scene's layout whenever the doc, scene, or a toggle
  // (`version`) changes. Async because layoutSceneForRender awaits font readiness.
  useEffect(() => {
    let cancelled = false
    // Word indices in `selection`/`effectTarget` are only valid for the layout they were
    // computed against, so any rebuild has to drop them.
    clearTargeting()
    if (!doc || !scene) {
      setLayout(null)
      return
    }
    layoutSceneForRender(doc, scene).then((l) => {
      if (!cancelled) setLayout(l)
    })
    return () => {
      cancelled = true
    }
  }, [doc, scene, version, clearTargeting])

  /**
   * Sizes a canvas's backing store to the device pixel ratio and returns a context whose
   * transform is in layout units. Without this the preview is rendered at 1 CSS pixel per
   * logical pixel and then scaled up by the display, which is exactly the soft, fuzzy text
   * the preview is supposed to be proving isn't there.
   */
  const prepareCanvas = useCallback((canvas: HTMLCanvasElement, width: number, height: number, dpr: number) => {
    const deviceWidth = Math.round(width * dpr)
    const deviceHeight = Math.round(height * dpr)
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth
      canvas.height = deviceHeight
    }
    const ctx = canvas.getContext('2d')
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }, [])

  // Live preview: play the current scene's animation, driven by the exact same
  // renderScene()/sceneTimingFor() used for export.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !doc || !scene || !layout) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const ctx = prepareCanvas(canvas, doc.width, doc.height, dpr)
    if (!ctx) return

    const timing = sceneTimingFor(doc, layout)
    const loopMs = timing.totalMs + LOOP_PAUSE_MS
    let start = performance.now()

    function tick() {
      let elapsed = performance.now() - start
      if (isLooping && elapsed >= loopMs) {
        start = performance.now()
        elapsed = 0
      }
      renderScene(ctx!, doc!, layout!, elapsed, timing, 0, 0, dpr)
      if (isLooping || elapsed < timing.totalMs) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [doc, scene, layout, isLooping, replayNonce, prepareCanvas])

  // Selection highlight overlay — a separate, non-interactive canvas drawn only for the
  // live editor. Kept entirely out of renderScene()/renderTimelineFrame() so selection UI
  // can never leak into the shared preview/export rendering codepath (see DEC-009).
  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || !doc) return
    const dpr = Math.min(3, window.devicePixelRatio || 1)
    const ctx = prepareCanvas(canvas, doc.width, doc.height, dpr)
    if (!ctx) return
    ctx.clearRect(0, 0, doc.width, doc.height)
    if (!selection || !layout) return
    const flat = layout.lines.flatMap((l) => l.words)
    const lo = Math.min(selection.start, selection.end)
    const hi = Math.max(selection.start, selection.end)
    if (lo === hi) return
    const offsetY = contentOffsetY(doc, layout)
    ctx.fillStyle = 'rgba(43, 108, 255, 0.25)'
    for (let i = lo; i <= hi; i++) {
      const w = flat[i]
      if (!w) continue
      ctx.fillRect(PADDING + w.x - 2, offsetY + w.y, w.width + 4, w.height)
    }
  }, [selection, layout, doc, prepareCanvas])

  // Dismiss the context menu on an outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return
    function handlePointerDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.context-menu')) setContextMenu(null)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') clearTargeting()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu, clearTargeting])

  // Clamp the menu into the viewport — with 10 presets it can otherwise render partly
  // (or entirely) below the fold with no way to reach the rest, since it's
  // position:fixed and scrolling the page doesn't move it. useLayoutEffect so the
  // reposition happens before paint, with no visible jump.
  useLayoutEffect(() => {
    const el = contextMenuRef.current
    if (!el || !contextMenu) return
    const margin = 8
    const rect = el.getBoundingClientRect()
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)
    el.style.left = `${Math.min(contextMenu.x, maxLeft)}px`
    el.style.top = `${Math.min(contextMenu.y, maxTop)}px`
  }, [contextMenu])

  /**
   * Canvas coordinates in layout units. The canvas is laid out responsively (its CSS width
   * is whatever the column allows), so the client-to-layout ratio has to be measured rather
   * than assumed to be 1 — otherwise every hit test is wrong on any screen narrower than
   * the document.
   */
  function localCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const ratio = rect.width > 0 && doc ? doc.width / rect.width : 1
    const offsetY = doc && layout ? contentOffsetY(doc, layout) : PADDING
    return {
      x: (e.clientX - rect.left) * ratio - PADDING,
      y: (e.clientY - rect.top) * ratio - offsetY,
    }
  }

  /** Resolves a word-index range into an effect target, clamped to the anchor word's block. */
  function buildEffectTarget(lo: number, hi: number): EffectTarget | null {
    if (!doc || !layout) return null
    const flat = layout.lines.flatMap((l) => l.words)
    const firstWord = flat[lo]
    if (!firstWord) return null
    const blockId = findBlockIdForRun(doc, firstWord.runId)
    if (!blockId) return null
    // Clamp to the anchor word's block — no cross-paragraph merges.
    let lastWord = firstWord
    let lastIndex = lo
    for (let i = hi; i >= lo; i--) {
      const w = flat[i]
      if (w && findBlockIdForRun(doc, w.runId) === blockId) {
        lastWord = w
        lastIndex = i
        break
      }
    }
    const label = flat
      .slice(lo, lastIndex + 1)
      .map((w) => w.text)
      .join(' ')
    return { blockId, firstRunId: firstWord.runId, lastRunId: lastWord.runId, label }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!layout || e.button !== 0) return
    const { x, y } = localCoords(e)
    const idx = hitTestWordStrict(layout, x, y)
    if (idx === null) return
    draggingRef.current = true
    anchorIndexRef.current = idx
    updateSelection({ start: idx, end: idx })
    setContextMenu(null)
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!draggingRef.current || !layout || anchorIndexRef.current === null) return
    const { x, y } = localCoords(e)
    const idx = hitTestNearestWord(layout, x, y)
    if (idx === null) return
    updateSelection({ start: anchorIndexRef.current, end: idx })
  }

  function handleMouseUp() {
    if (!draggingRef.current) return
    draggingRef.current = false
    const current = selectionRef.current
    if (!current || !doc || !layout) return
    // A plain click (no real drag across words) keeps the single-word toggle behaviour.
    if (current.start === current.end) {
      const flat = layout.lines.flatMap((l) => l.words)
      const word = flat[current.start]
      if (word) {
        toggleRunAnimation(doc, word.runId)
        setVersion((v) => v + 1)
      }
      updateSelection(null)
      return
    }
    // A real drag selects a phrase and offers the effect picker inline, so choosing an
    // effect no longer depends on knowing that right-click does something.
    const lo = Math.min(current.start, current.end)
    const hi = Math.max(current.start, current.end)
    setEffectTarget(buildEffectTarget(lo, hi))
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!doc || !layout) return
    const current = selectionRef.current
    let lo: number
    let hi: number
    if (current && current.start !== current.end) {
      lo = Math.min(current.start, current.end)
      hi = Math.max(current.start, current.end)
    } else {
      const { x, y } = localCoords(e)
      const idx = hitTestWordStrict(layout, x, y)
      if (idx === null) return
      lo = idx
      hi = idx
      updateSelection({ start: idx, end: idx })
    }
    const target = buildEffectTarget(lo, hi)
    if (!target) return
    setEffectTarget(target)
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  function handleChooseEmphasis(preset: EmphasisPresetId) {
    if (!doc || !effectTarget) return
    applyEmphasisToWordRange(doc, effectTarget.blockId, effectTarget.firstRunId, effectTarget.lastRunId, preset)
    setVersion((v) => v + 1)
    clearTargeting()
  }

  /**
   * Tempo is applied to the existing document rather than triggering a rebuild.
   * buildAnimatedDocument re-runs highlight detection from scratch, which would throw away
   * every word the user toggled and every effect they picked — an unacceptable thing for a
   * slider to do. Mutate-and-bump-version is the same path the word toggles already use.
   */
  function handleSpeedChange(next: number) {
    setSpeed(next)
    if (doc) {
      doc.speed = next
      setVersion((v) => v + 1)
    }
  }

  function handleHoldChange(next: number) {
    setHoldMs(next)
    if (doc) {
      doc.holdMs = next
      setVersion((v) => v + 1)
    }
  }

  function handleChipToggle(runId: string) {
    if (!doc) return
    toggleRunAnimation(doc, runId)
    setVersion((v) => v + 1)
  }

  /** Copies the animated GIF. Only offered when the clipboard will actually accept image/gif. */
  async function handleCopyAnimated() {
    if (!doc) return
    setIsCopying(true)
    setExportProgress(0)
    setStatus({ kind: 'info', text: 'Preparing GIF to copy…' })
    try {
      const gifPromise = exportDocumentAsGif(doc, undefined, setExportProgress)
      // Passing a Promise (not an already-resolved Blob) keeps this write() call
      // itself synchronous within the click handler, which Safari requires to honor
      // the user gesture for clipboard permission — write() awaits it internally.
      await navigator.clipboard.write([new ClipboardItem({ 'image/gif': gifPromise })])
      const blob = await gifPromise
      setStatus({ kind: 'success', text: `Copied the animated GIF — ${formatSize(blob.size)}. Paste it into your email.` })
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setStatus({ kind: 'info', text: 'Export cancelled.' })
      } else {
        setStatus({ kind: 'error', text: `Copy failed: ${(err as Error).message}` })
      }
    } finally {
      setIsCopying(false)
      setExportProgress(null)
    }
  }

  /**
   * Copies the settled frame as a PNG. Deliberately a separate, differently-labelled action
   * from copying the GIF: this pastes a still, and the button has to say so before the click,
   * not explain it afterwards.
   */
  async function handleCopyStill() {
    if (!doc || !scene) return
    setIsCopying(true)
    try {
      const pngPromise = exportSceneAsPng(doc, scene)
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
      const blob = await pngPromise
      setStatus({ kind: 'success', text: `Copied a still image — ${formatSize(blob.size)}. It will not be animated.` })
    } catch (err) {
      setStatus({ kind: 'error', text: `Copy failed: ${(err as Error).message}` })
    } finally {
      setIsCopying(false)
    }
  }

  async function handleSaveGif() {
    if (!doc) return
    setIsExporting(true)
    setExportProgress(0)
    setStatus({ kind: 'info', text: 'Rendering GIF in the background…' })
    try {
      const blob = await exportDocumentAsGif(doc, undefined, setExportProgress)
      triggerDownload(blob, 'animation.gif')
      setStatus({ kind: 'success', text: `Saved — ${formatSize(blob.size)}.` })
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setStatus({ kind: 'info', text: 'Export cancelled.' })
      } else {
        setStatus({ kind: 'error', text: `Export failed: ${(err as Error).message}` })
      }
    } finally {
      setIsExporting(false)
      setExportProgress(null)
    }
  }

  /**
   * Vector export. Kept visibly apart from the email actions: mail clients strip SVG, so
   * offering it beside "Save GIF" as an equal option would be telling the user something
   * false about where they can use it.
   */
  async function handleExportSvg() {
    if (!doc || !scene) return
    const { svg, staticPresets } = await exportSceneAsSvg(doc, scene)
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    triggerDownload(blob, 'animation.svg')
    const names = staticPresets
      .map((id) => EMPHASIS_OPTIONS.find((o) => o.id === id)?.name ?? id)
      .join(', ')
    setStatus({
      kind: 'success',
      text: staticPresets.length
        ? `Saved SVG — ${formatSize(blob.size)}. For the web, not email. ${names} ${staticPresets.length > 1 ? 'are' : 'is'} drawn at rest — only drawn-stroke effects animate in SVG.`
        : `Saved SVG — ${formatSize(blob.size)}. For the web, not email — mail clients strip SVG.`,
    })
  }

  async function handleExportPng() {
    if (!doc || !scene) return
    const blob = await exportSceneAsPng(doc, scene)
    triggerDownload(blob, 'still.png')
    setStatus({ kind: 'success', text: `Saved a still PNG — ${formatSize(blob.size)}.` })
  }

  const animatedRuns = useMemo(() => {
    if (!scene) return []
    return scene.blocks.flatMap((b) => b.runs).filter((r) => r.highlight && r.highlight.kind !== 'content-word')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, version])

  const busy = isCopying || isExporting
  const nearCharLimit = rawText.length > MAX_CHARACTERS * 0.9
  // Shown next to the sliders so the tempo choice is tied to the number that actually
  // matters: how long the exported loop will be.
  const previewDurationMs = useMemo(
    () => (doc && layout ? sceneTimingFor(doc, layout).totalMs : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, layout, version],
  )

  const effectPicker = (onPick: (id: EmphasisPresetId) => void) =>
    EMPHASIS_OPTIONS.map((o) => (
      <button key={o.id} type="button" className="effect-option" onClick={() => onPick(o.id)}>
        <span className="effect-swatch" style={{ background: o.swatch }} aria-hidden="true" />
        {o.name}
      </button>
    ))

  return (
    <div className="app">
      <header className="masthead">
        <h1>Animate your email</h1>
        <p className="tagline">
          Paste your text, pick what should stand out, and get an animated GIF for your email — however much
          you paste, it fits in one frame. Everything runs in this browser; nothing is uploaded.
        </p>
      </header>

      <div className="workspace">
        <section className="panel compose-panel" aria-label="Compose">
          <div className="field">
            <label className="field-label" htmlFor="source-text">
              Your text
            </label>
            <textarea
              id="source-text"
              className="text-area"
              value={rawText}
              onChange={(e) => setRawText(e.target.value.slice(0, MAX_CHARACTERS))}
              placeholder="Paste your email or message…"
              rows={8}
            />
            <div className="field-footer">
              <span className="field-hint">
                Wrap a phrase in <code>*stars*</code> or <code>[[brackets]]</code> to force emphasis.
              </span>
              <span className={nearCharLimit ? 'char-count char-count-warn' : 'char-count'}>
                {rawText.length} / {MAX_CHARACTERS}
              </span>
            </div>
          </div>

          <div className="field">
            <span className="field-label">Template</span>
            <div className="template-picker" role="group" aria-label="Template">
              {TEMPLATE_OPTIONS.map((t) => {
                const active = t.id === 'auto' ? modeOverride === null : modeOverride === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    title={t.hint}
                    aria-pressed={active}
                    className={active ? 'template-option active' : 'template-option'}
                    onClick={() => setModeOverride(t.id === 'auto' ? null : t.id)}
                  >
                    {t.name}
                  </button>
                )
              })}
            </div>
            {modeOverride === null && doc && (
              <p className="field-hint">
                Auto picked <strong>{TEMPLATE_OPTIONS.find((t) => t.id === doc.mode)?.name}</strong> for this text.
              </p>
            )}
          </div>

          {animatedRuns.length > 0 && (
            <div className="field">
              <span className="field-label">Animated phrases</span>
              <div className="chip-row">
                {animatedRuns.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    aria-pressed={r.highlight!.animated}
                    className={r.highlight!.animated ? 'chip chip-on' : 'chip'}
                    onClick={() => handleChipToggle(r.id)}
                    title={`Detected as: ${r.highlight!.kind}`}
                  >
                    {r.text}
                  </button>
                ))}
              </div>
              <span className="field-hint">Tap one to stop it animating.</span>
            </div>
          )}
        </section>

        <section className="panel preview-panel" aria-label="Preview">
          {doc && scene ? (
            <>
              <div
                className="preview-frame"
                style={{ '--frame-aspect': doc.width / doc.height } as React.CSSProperties}
              >
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onContextMenu={handleContextMenu}
                  aria-label="Animation preview — click a word to toggle its emphasis"
                />
                <canvas ref={overlayCanvasRef} className="selection-overlay" aria-hidden="true" />
              </div>

              <div className="preview-toolbar">
                <span className="frame-meta">
                  {doc.width} × {doc.height} · {doc.fontSize}px
                  {doc.fontSize < BASE_FONT_SIZE[doc.mode] && ' · fitted to one frame'}
                </span>

                <div className="playback">
                  <button className="ghost-button" onClick={() => setReplayNonce((n) => n + 1)}>
                    ↻ Replay
                  </button>
                  <label className="loop-toggle">
                    <input type="checkbox" checked={isLooping} onChange={(e) => setIsLooping(e.target.checked)} />
                    Loop
                  </label>
                </div>
              </div>

              {/* Tempo lives next to the preview, not behind a disclosure: it changes what you
                  are looking at, and the total duration it produces is what decides whether the
                  GIF is email-friendly. */}
              <div className="sliders">
                <label className="slider">
                  <span className="slider-label">
                    Speed <output>{speed.toFixed(1)}×</output>
                  </span>
                  <input
                    type="range"
                    aria-label="Speed"
                    min={MIN_SPEED}
                    max={MAX_SPEED}
                    step={0.1}
                    value={speed}
                    onChange={(e) => handleSpeedChange(Number(e.target.value))}
                  />
                </label>
                <label className="slider">
                  <span className="slider-label">
                    Hold at end <output>{(holdMs / 1000).toFixed(1)}s</output>
                  </span>
                  <input
                    type="range"
                    aria-label="Hold at end"
                    min={MIN_HOLD_MS}
                    max={MAX_HOLD_MS}
                    step={100}
                    value={holdMs}
                    onChange={(e) => handleHoldChange(Number(e.target.value))}
                  />
                </label>
                {previewDurationMs !== null && (
                  <span className="slider-readout">Loop runs {(previewDurationMs / 1000).toFixed(1)}s</span>
                )}
              </div>

              {effectTarget ? (
                <div className="effect-bar">
                  <div className="effect-bar-head">
                    <span className="effect-bar-title">
                      Effect for “{truncate(effectTarget.label, 42)}”
                    </span>
                    <button className="ghost-button" onClick={clearTargeting}>
                      Cancel
                    </button>
                  </div>
                  <div className="effect-grid">{effectPicker(handleChooseEmphasis)}</div>
                </div>
              ) : (
                <p className="hint">
                  <strong>Click</strong> a word to animate or un-animate it. <strong>Drag</strong> across a phrase to
                  pick an effect for it.
                </p>
              )}

              {/* Which action leads depends on what the browser can really do, not on what
                  reads best — see detectClipboardCapability. */}
              <div className="actions">
                {clipboard === 'gif' ? (
                  <>
                    <button className="cta-primary" onClick={handleCopyAnimated} disabled={busy}>
                      {isCopying ? 'Copying…' : 'Copy GIF'}
                    </button>
                    <button className="cta-secondary" onClick={handleSaveGif} disabled={busy}>
                      {isExporting ? 'Saving…' : 'Save GIF'}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="cta-primary" onClick={handleSaveGif} disabled={busy}>
                      {isExporting ? 'Saving…' : 'Save GIF'}
                    </button>
                    {clipboard === 'still-only' && (
                      <button className="cta-secondary" onClick={handleCopyStill} disabled={busy}>
                        {isCopying ? 'Copying…' : 'Copy still image'}
                      </button>
                    )}
                  </>
                )}
                {busy && (
                  <button className="ghost-button" onClick={cancelExport}>
                    Cancel
                  </button>
                )}
              </div>

              {clipboard !== 'gif' && (
                <p className="disclosure">
                  This browser can’t put an <strong>animated</strong> GIF on the clipboard — only still
                  images. Save the GIF and attach or drag it into your email to keep the animation.
                </p>
              )}

              {busy && (
                <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((exportProgress ?? 0) * 100)}>
                  <div className="progress-bar" style={{ transform: `scaleX(${exportProgress ?? 0})` }} />
                </div>
              )}

              <div className="export-menu-wrap">
                <button className="ghost-button" onClick={handleExportPng} disabled={busy}>
                  Save a still PNG
                </button>
                <button className="ghost-button" onClick={handleExportSvg} disabled={busy}>
                  Save animated SVG (for the web, not email)
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-art" aria-hidden="true" />
              <p>{isGenerating ? 'Generating preview…' : 'Paste some text to see it animate.'}</p>
            </div>
          )}

          {status && (
            <p className={`status status-${status.kind}`} role={status.kind === 'error' ? 'alert' : 'status'}>
              {status.text}
            </p>
          )}
        </section>
      </div>

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {effectPicker(handleChooseEmphasis)}
        </div>
      )}
    </div>
  )
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default App
