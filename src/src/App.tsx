import { useEffect, useMemo, useRef, useState } from 'react'
import { buildAnimatedDocument, layoutSceneForRender, toggleRunAnimation } from './engine/document'
import { exportAllScenesAsPngSequence, exportDocumentAsGif, exportSceneAsPng } from './engine/exportV2'
import { autoSelectMode } from './engine/modeSelect'
import { computeSceneTiming, renderScene } from './engine/render'
import { PADDING } from './engine/layout'
import type { AnimatedDocument, EntrancePresetId, OutputMode, TransitionPresetId } from './engine/model'
import { MAX_CHARACTERS } from './engine/model'
import './App.css'

const ENTRANCE_OPTIONS: { id: EntrancePresetId; name: string }[] = [
  { id: 'fade', name: 'Fade' },
  { id: 'soft-rise', name: 'Soft Rise' },
  { id: 'blur-reveal', name: 'Blur Reveal' },
  { id: 'word-cascade', name: 'Word Cascade' },
]

const TRANSITION_OPTIONS: { id: TransitionPresetId; name: string }[] = [
  { id: 'crossfade', name: 'Crossfade' },
  { id: 'slide-up', name: 'Slide Up' },
]

const MODE_OPTIONS: { id: OutputMode; name: string }[] = [
  { id: 'one-card', name: 'One Card' },
  { id: 'paragraph', name: 'Paragraph' },
  { id: 'story', name: 'Story' },
]

const SAMPLE_TEXT =
  'Thank you for joining us at the *product launch* today.\n\n' +
  'We announced [[three major updates]] and shared a live demo with over 200 attendees on July 12, 2026.\n\n' +
  'One customer told us "this is exactly what we needed" — and that stuck with the whole team.\n\n' +
  'Get started with the new features today.'

function App() {
  const [rawText, setRawText] = useState(SAMPLE_TEXT)
  const [modeOverride, setModeOverride] = useState<OutputMode | null>(null)
  const [entrance, setEntrance] = useState<EntrancePresetId>('fade')
  const [transition, setTransition] = useState<TransitionPresetId>('crossfade')
  const [doc, setDoc] = useState<AnimatedDocument | null>(null)
  const [sceneIndex, setSceneIndex] = useState(0)
  const [version, setVersion] = useState(0)
  const [status, setStatus] = useState('')
  const [isExporting, setIsExporting] = useState(false)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const effectiveMode = modeOverride ?? autoSelectMode(rawText)
  const scene = doc?.scenes[sceneIndex] ?? null
  const layout = useMemo(() => (doc && scene ? layoutSceneForRender(doc, scene) : null), [doc, scene, version])

  function handleGeneratePreview() {
    const built = buildAnimatedDocument(rawText, {
      mode: effectiveMode,
      modeIsOverridden: modeOverride !== null,
      entrance,
      transition,
    })
    setDoc(built)
    setSceneIndex(0)
    setVersion((v) => v + 1)
    setStatus(built.truncated ? `Preview ready — text was too long, kept the first ${built.scenes.length} scenes.` : 'Preview ready.')
  }

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

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!doc || !scene || !layout) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = e.clientX - rect.left - PADDING
    const y = e.clientY - rect.top - PADDING
    // word.y/word.height describe the word's line box (top-relative), not a text
    // baseline, so hit-testing is a plain box test against [y, y+height].
    for (const line of layout.lines) {
      for (const word of line.words) {
        if (x >= word.x && x <= word.x + word.width && y >= word.y && y <= word.y + word.height) {
          toggleRunAnimation(doc, word.runId)
          setVersion((v) => v + 1)
          return
        }
      }
    }
  }

  function handleChipToggle(runId: string) {
    if (!doc) return
    toggleRunAnimation(doc, runId)
    setVersion((v) => v + 1)
  }

  async function handleDownloadGif() {
    if (!doc) return
    setIsExporting(true)
    setStatus('Rendering GIF in the background…')
    try {
      const blob = await exportDocumentAsGif(doc, 12)
      triggerDownload(blob, 'animation.gif')
      setStatus(`Downloaded — ${(blob.size / 1024).toFixed(0)} KB`)
    } catch (err) {
      setStatus(`Export failed: ${(err as Error).message}`)
    } finally {
      setIsExporting(false)
    }
  }

  async function handleExportPng() {
    if (!doc || !scene) return
    setExportMenuOpen(false)
    const blob = await exportSceneAsPng(doc, scene)
    triggerDownload(blob, `scene-${sceneIndex + 1}.png`)
  }

  async function handleExportPngSequence() {
    if (!doc) return
    setExportMenuOpen(false)
    const files = await exportAllScenesAsPngSequence(doc)
    files.forEach((f) => triggerDownload(f.blob, f.name))
  }

  const animatedRuns = useMemo(() => {
    if (!scene) return []
    return scene.blocks.flatMap((b) => b.runs).filter((r) => r.highlight && r.highlight.kind !== 'content-word')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, version])

  return (
    <div className="app">
      <h1>Animate your email</h1>

      <textarea
        className="text-area"
        value={rawText}
        onChange={(e) => setRawText(e.target.value.slice(0, MAX_CHARACTERS))}
        placeholder="Paste your email or message…"
        rows={6}
      />
      <div className="char-count">{rawText.length} / {MAX_CHARACTERS}</div>

      <div className="controls-row">
        <label className="select-field">
          Output
          <select
            value={modeOverride ?? `auto:${effectiveMode}`}
            onChange={(e) => setModeOverride(e.target.value.startsWith('auto') ? null : (e.target.value as OutputMode))}
          >
            <option value={`auto:${effectiveMode}`}>Auto ({MODE_OPTIONS.find((m) => m.id === effectiveMode)?.name})</option>
            {MODE_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>

        <label className="select-field">
          Entrance
          <select value={entrance} onChange={(e) => setEntrance(e.target.value as EntrancePresetId)}>
            {ENTRANCE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>

        <label className="select-field">
          Transition
          <select value={transition} onChange={(e) => setTransition(e.target.value as TransitionPresetId)}>
            {TRANSITION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="actions">
        <button className="primary" onClick={handleGeneratePreview}>Generate Preview</button>
      </div>

      {doc && scene && (
        <>
          <div className="preview-frame">
            <canvas
              ref={canvasRef}
              width={doc.width}
              height={doc.height}
              onClick={handleCanvasClick}
              style={{ cursor: 'pointer' }}
            />
          </div>

          {doc.scenes.length > 1 && (
            <div className="scene-nav">
              <button className="preset" onClick={() => setSceneIndex((i) => Math.max(0, i - 1))} disabled={sceneIndex === 0}>‹ Prev</button>
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
              <button className="preset" onClick={() => setSceneIndex((i) => Math.min(doc.scenes.length - 1, i + 1))} disabled={sceneIndex === doc.scenes.length - 1}>Next ›</button>
            </div>
          )}

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

          <div className="actions export-actions">
            <button className="primary" onClick={handleDownloadGif} disabled={isExporting}>
              {isExporting ? 'Rendering…' : 'Download GIF'}
            </button>
            <div className="export-menu-wrap">
              <button className="preset" onClick={() => setExportMenuOpen((v) => !v)}>Export ▾</button>
              {exportMenuOpen && (
                <div className="export-menu">
                  <button onClick={handleExportPng}>PNG (current scene)</button>
                  <button onClick={handleExportPngSequence}>PNG sequence (all scenes)</button>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {status && <p className="status">{status}</p>}
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
