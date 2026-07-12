import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  applyEmphasisToWordRange,
  buildAnimatedDocument,
  findBlockIdForRun,
  layoutSceneForRender,
  toggleRunAnimation,
} from './engine/document'
import { cancelExport, exportDocumentAsGif, exportScenesAsZip, exportSceneAsPng, ExportCancelledError } from './engine/exportV2'
import { autoSelectMode } from './engine/modeSelect'
import { computeSceneTiming, renderScene } from './engine/render'
import { PADDING } from './engine/layout'
import type {
  AnimatedDocument,
  EmphasisPresetId,
  LayoutWord,
  OutputMode,
  TextLayout,
  TransitionPresetId,
} from './engine/model'
import { MAX_CHARACTERS } from './engine/model'
import './App.css'

const GENERATE_DEBOUNCE_MS = 400

const TEMPLATE_OPTIONS: { id: OutputMode | 'auto'; name: string }[] = [
  { id: 'auto', name: 'Auto' },
  { id: 'one-card', name: 'Card' },
  { id: 'paragraph', name: 'Paragraph' },
  { id: 'story', name: 'Story' },
]

const EMPHASIS_OPTIONS: { id: EmphasisPresetId; name: string }[] = [
  { id: 'marker-highlight', name: 'Marker Highlight' },
  { id: 'underline-draw', name: 'Underline Draw' },
  { id: 'soft-glow', name: 'Soft Glow' },
  { id: 'gentle-pop', name: 'Gentle Pop' },
  { id: 'shimmer', name: 'Shimmer' },
  { id: 'weight-shift', name: 'Weight Shift' },
  { id: 'burn', name: 'Burn' },
  { id: 'wash-away', name: 'Wash Away' },
  { id: 'bow-highlight', name: 'Pink Highlight + Bow' },
  { id: 'glitch', name: 'Glitch' },
]

const TRANSITION_OPTIONS: { id: TransitionPresetId; name: string }[] = [
  { id: 'crossfade', name: 'Crossfade' },
  { id: 'slide-up', name: 'Slide Up' },
]

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

function App() {
  const [rawText, setRawText] = useState(SAMPLE_TEXT)
  const [modeOverride, setModeOverride] = useState<OutputMode | null>(null)
  const [transition, setTransition] = useState<TransitionPresetId>('crossfade')
  const [doc, setDoc] = useState<AnimatedDocument | null>(null)
  const [sceneIndex, setSceneIndex] = useState(0)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [layout, setLayout] = useState<TextLayout | null>(null)
  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    blockId: string
    firstRunId: string
    lastRunId: string
  } | null>(null)

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

  const effectiveMode = modeOverride ?? autoSelectMode(rawText)
  const scene = doc?.scenes[sceneIndex] ?? null

  // Auto-generate the preview whenever the text or template settings change — no
  // separate "Generate" step. Debounced so it doesn't rebuild on every keystroke.
  useEffect(() => {
    if (!rawText.trim()) {
      setDoc(null)
      setStatus('')
      setIsGenerating(false)
      return
    }
    setIsGenerating(true)
    const timer = setTimeout(() => {
      const genId = ++generationIdRef.current
      buildAnimatedDocument(rawText, {
        mode: effectiveMode,
        modeIsOverridden: modeOverride !== null,
        entrance: 'fade',
        transition,
      }).then((built) => {
        if (generationIdRef.current !== genId) return // superseded by a newer change
        setDoc(built)
        setSceneIndex(0)
        setVersion((v) => v + 1)
        setStatus(built.truncated ? `Kept the first ${built.scenes.length} scenes — text was too long to fit more.` : '')
        setIsGenerating(false)
      })
    }, GENERATE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, effectiveMode, modeOverride, transition])

  // Re-derive the current scene's layout whenever the doc, scene, or a toggle
  // (`version`) changes. Async because layoutSceneForRender awaits font readiness.
  useEffect(() => {
    let cancelled = false
    // Word indices in `selection`/`contextMenu` are only valid for the layout they were
    // computed against — scene navigation invalidates them just as much as a text edit.
    updateSelection(null)
    setContextMenu(null)
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
  }, [doc, scene, version])

  // Live preview: play the current scene's animation once and settle, driven by the
  // exact same renderScene()/computeSceneTiming() used for export.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !doc || !scene || !layout) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const timing = computeSceneTiming(layout, scene.entrance)
    const start = performance.now()

    function tick() {
      const elapsed = performance.now() - start
      renderScene(ctx!, doc!, layout!, scene!.entrance, elapsed, timing)
      if (elapsed < timing.totalMs) {
        rafRef.current = requestAnimationFrame(tick)
      }
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [doc, scene, layout])

  // Selection highlight overlay — a separate, non-interactive canvas drawn only for the
  // live editor. Kept entirely out of renderScene()/renderTimelineFrame() so selection UI
  // can never leak into the shared preview/export rendering codepath (see DEC-009).
  useEffect(() => {
    const canvas = overlayCanvasRef.current
    if (!canvas || !doc) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    if (!selection || !layout) return
    const flat = layout.lines.flatMap((l) => l.words)
    const lo = Math.min(selection.start, selection.end)
    const hi = Math.max(selection.start, selection.end)
    if (lo === hi) return
    ctx.fillStyle = 'rgba(43, 108, 255, 0.25)'
    for (let i = lo; i <= hi; i++) {
      const w = flat[i]
      if (!w) continue
      ctx.fillRect(PADDING + w.x - 2, PADDING + w.y, w.width + 4, w.height)
    }
  }, [selection, layout, doc])

  // Dismiss the context menu on an outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return
    function handlePointerDown(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest('.context-menu')) {
        setContextMenu(null)
        updateSelection(null)
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setContextMenu(null)
        updateSelection(null)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

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

  function localCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - PADDING, y: e.clientY - rect.top - PADDING }
  }

  function updateSelection(next: { start: number; end: number } | null) {
    selectionRef.current = next
    setSelection(next)
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
    // A plain click (no real drag across words) keeps the old single-word toggle behavior.
    if (current && current.start === current.end && doc && layout) {
      const flat = layout.lines.flatMap((l) => l.words)
      const word = flat[current.start]
      if (word) {
        toggleRunAnimation(doc, word.runId)
        setVersion((v) => v + 1)
      }
      updateSelection(null)
    }
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    e.preventDefault()
    if (!doc || !layout) return
    const flat = layout.lines.flatMap((l) => l.words)
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
    }
    const firstWord = flat[lo]
    if (!firstWord) return
    const blockId = findBlockIdForRun(doc, firstWord.runId)
    if (!blockId) return
    // Clamp to the anchor word's block — no cross-paragraph merges.
    let lastWord = firstWord
    for (let i = hi; i >= lo; i--) {
      const w = flat[i]
      if (w && findBlockIdForRun(doc, w.runId) === blockId) {
        lastWord = w
        break
      }
    }
    setContextMenu({ x: e.clientX, y: e.clientY, blockId, firstRunId: firstWord.runId, lastRunId: lastWord.runId })
  }

  function handleChooseEmphasis(preset: EmphasisPresetId) {
    if (!doc || !contextMenu) return
    applyEmphasisToWordRange(doc, contextMenu.blockId, contextMenu.firstRunId, contextMenu.lastRunId, preset)
    setVersion((v) => v + 1)
    setContextMenu(null)
    updateSelection(null)
  }

  function handleChipToggle(runId: string) {
    if (!doc) return
    toggleRunAnimation(doc, runId)
    setVersion((v) => v + 1)
  }

  /** Primary action: generate the GIF and copy it straight to the clipboard for pasting into an email. */
  async function handleCopyGif() {
    if (!doc || !scene) return
    setIsCopying(true)
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
        throw new Error('Copying images isn’t supported in this browser — use Save GIF instead.')
      }
      // Verified in-browser (Chromium): the Async Clipboard API's image write only
      // accepts image/png and image/svg+xml — image/gif is rejected outright, so an
      // animated GIF genuinely cannot be put on the clipboard from a web page today.
      // Fall back to copying this scene's settled frame as a static PNG instead of
      // just failing, and say so plainly rather than silently pasting something that
      // quietly isn't animated.
      const gifSupported = typeof ClipboardItem.supports !== 'function' || ClipboardItem.supports('image/gif')
      if (gifSupported) {
        setStatus('Preparing GIF to copy…')
        const gifPromise = exportDocumentAsGif(doc, 12)
        // Passing a Promise (not an already-resolved Blob) keeps this write() call
        // itself synchronous within the click handler, which Safari requires to honor
        // the user gesture for clipboard permission — write() awaits it internally.
        await navigator.clipboard.write([new ClipboardItem({ 'image/gif': gifPromise })])
        const blob = await gifPromise
        setStatus(`Copied — ${(blob.size / 1024).toFixed(0)} KB. Paste it into your email.`)
      } else {
        setStatus('This browser can’t copy animated GIFs — copying a static image instead…')
        const pngPromise = exportSceneAsPng(doc, scene)
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngPromise })])
        const blob = await pngPromise
        setStatus(`Copied a static image — ${(blob.size / 1024).toFixed(0)} KB. This browser can’t copy animated GIFs to the clipboard; use Save GIF for the animated file.`)
      }
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setStatus('Export cancelled.')
      } else {
        setStatus(`Copy failed: ${(err as Error).message}`)
      }
    } finally {
      setIsCopying(false)
    }
  }

  async function handleSaveGif() {
    if (!doc) return
    setIsExporting(true)
    setStatus('Rendering GIF in the background…')
    try {
      const blob = await exportDocumentAsGif(doc, 12)
      triggerDownload(blob, 'animation.gif')
      setStatus(`Saved — ${(blob.size / 1024).toFixed(0)} KB.`)
    } catch (err) {
      if (err instanceof ExportCancelledError) {
        setStatus('Export cancelled.')
      } else {
        setStatus(`Export failed: ${(err as Error).message}`)
      }
    } finally {
      setIsExporting(false)
    }
  }

  function handleCancelExport() {
    cancelExport()
  }

  async function handleExportPng() {
    if (!doc || !scene) return
    setExportMenuOpen(false)
    const blob = await exportSceneAsPng(doc, scene)
    triggerDownload(blob, `scene-${sceneIndex + 1}.png`)
  }

  async function handleExportZip() {
    if (!doc) return
    setExportMenuOpen(false)
    const blob = await exportScenesAsZip(doc)
    triggerDownload(blob, 'scenes.zip')
  }

  const animatedRuns = useMemo(() => {
    if (!scene) return []
    return scene.blocks.flatMap((b) => b.runs).filter((r) => r.highlight && r.highlight.kind !== 'content-word')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, version])

  const busy = isCopying || isExporting

  return (
    <div className="app">
      <h1>Animate your email</h1>

      <textarea
        className="text-area"
        value={rawText}
        onChange={(e) => setRawText(e.target.value.slice(0, MAX_CHARACTERS))}
        placeholder="Paste your email or message…"
        rows={5}
      />
      <div className="char-count">{rawText.length} / {MAX_CHARACTERS}</div>

      <div className="template-picker">
        {TEMPLATE_OPTIONS.map((t) => {
          const active = t.id === 'auto' ? modeOverride === null : modeOverride === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={active ? 'template-option active' : 'template-option'}
              onClick={() => setModeOverride(t.id === 'auto' ? null : t.id)}
            >
              {t.name}
            </button>
          )
        })}
      </div>

      {doc && scene ? (
        <>
          <div className="preview-frame">
            <canvas
              ref={canvasRef}
              width={doc.width}
              height={doc.height}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onContextMenu={handleContextMenu}
              style={{ cursor: 'pointer' }}
            />
            <canvas ref={overlayCanvasRef} width={doc.width} height={doc.height} className="selection-overlay" />
          </div>
          <p className="hint">Click a word to toggle it, or drag + right-click to choose an effect for a phrase.</p>

          {doc.scenes.length > 1 && (
            <div className="scene-nav">
              <button className="scene-arrow" onClick={() => setSceneIndex((i) => Math.max(0, i - 1))} disabled={sceneIndex === 0} aria-label="Previous scene">‹</button>
              <div className="scene-dots">
                {doc.scenes.map((s, i) => (
                  <button
                    key={s.id}
                    className={i === sceneIndex ? 'scene-dot active' : 'scene-dot'}
                    onClick={() => setSceneIndex(i)}
                    aria-label={`Scene ${i + 1}`}
                  />
                ))}
              </div>
              <button className="scene-arrow" onClick={() => setSceneIndex((i) => Math.min(doc.scenes.length - 1, i + 1))} disabled={sceneIndex === doc.scenes.length - 1} aria-label="Next scene">›</button>
            </div>
          )}

          <div className="actions primary-actions">
            <button className="cta-primary" onClick={handleCopyGif} disabled={busy}>
              {isCopying ? 'Copying…' : 'Copy GIF'}
            </button>
            <button className="cta-secondary" onClick={handleSaveGif} disabled={busy}>
              {isExporting ? 'Saving…' : 'Save GIF'}
            </button>
            {busy && (
              <button className="cta-text" onClick={handleCancelExport}>Cancel</button>
            )}
          </div>

          <div className="export-menu-wrap">
            <button className="cta-text" onClick={() => setExportMenuOpen((v) => !v)}>More export options ▾</button>
            {exportMenuOpen && (
              <div className="export-menu">
                <button onClick={handleExportPng}>PNG (current scene)</button>
                <button onClick={handleExportZip}>ZIP (all scenes, PNG)</button>
              </div>
            )}
          </div>

          <details className="customize">
            <summary>Customize</summary>
            <div className="customize-body">
              <label className="select-field">
                Transition between scenes
                <select value={transition} onChange={(e) => setTransition(e.target.value as TransitionPresetId)}>
                  {TRANSITION_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </label>

              {animatedRuns.length > 0 && (
                <div className="chip-row">
                  {animatedRuns.map((r) => (
                    <button
                      key={r.id}
                      className={r.highlight!.animated ? 'chip chip-on' : 'chip'}
                      onClick={() => handleChipToggle(r.id)}
                      title={r.highlight!.kind}
                    >
                      {r.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </details>
        </>
      ) : (
        <p className="hint empty-state">{isGenerating ? 'Generating preview…' : 'Paste some text above to get started.'}</p>
      )}

      {status && <p className="status">{status}</p>}

      {contextMenu && (
        <div ref={contextMenuRef} className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {EMPHASIS_OPTIONS.map((o) => (
            <button key={o.id} onClick={() => handleChooseEmphasis(o.id)}>{o.name}</button>
          ))}
        </div>
      )}
    </div>
  )
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
