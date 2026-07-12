import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, FabricText, Rect, Shadow } from 'fabric'
import gsap from 'gsap'
import { DEFAULT_PRESET_IDS, PRESETS } from './engine/presets'
import { sampleObject, totalEntranceMs } from './engine/sample'
import { splitAndMeasure } from './engine/textSplit'
import type { Category, Preset } from './engine/types'
import { exportGif } from './gifExport'
import './App.css'

const WIDTH = 600
const HEIGHT = 180
const BASE_TOP = HEIGHT / 2
const MIN_FONT_SIZE = 22
const MAX_FONT_SIZE = 64
const DEFAULT_FONT_SIZE = 40
const FONT_FAMILY = '-apple-system, sans-serif'
const CATEGORIES: Category[] = ['Clean', 'Typing', 'Editorial', 'Playful', 'Bold', 'Light & Color']

interface Scene {
  objects: FabricText[]
  decoration: Rect | null
  preset: Preset
}

/** Builds the fabric objects for one text render (single block, or one per word/character). */
function buildScene(
  canvas: Canvas,
  ctx: CanvasRenderingContext2D,
  text: string,
  preset: Preset,
  fontSize: number,
): Scene {
  ctx.font = `${fontSize}px ${FONT_FAMILY}`
  const { segments, totalWidth } = splitAndMeasure(ctx, text || ' ', preset.split)
  const startX = (WIDTH - totalWidth) / 2

  const objects = segments.map((seg) => {
    const obj = new FabricText(seg.text, {
      left: startX + seg.x,
      top: BASE_TOP,
      originX: 'left',
      originY: 'center',
      fontSize,
      fontFamily: FONT_FAMILY,
      fill: '#1a1a1a',
      selectable: false,
      evented: false,
    })
    canvas.add(obj)
    return obj
  })

  let decoration: Rect | null = null
  if (preset.decoration === 'underline') {
    decoration = new Rect({
      left: startX,
      top: BASE_TOP + fontSize / 2 + 6,
      width: totalWidth,
      height: 4,
      fill: '#2b6cff',
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
    })
    canvas.add(decoration)
  } else if (preset.decoration === 'highlightBar') {
    decoration = new Rect({
      left: startX - 6,
      top: BASE_TOP,
      width: totalWidth + 12,
      height: fontSize + 10,
      fill: '#ffe28a',
      originX: 'left',
      originY: 'center',
      selectable: false,
      evented: false,
    })
    canvas.add(decoration)
    canvas.sendObjectToBack(decoration)
  }

  return { objects, decoration, preset }
}

function App() {
  const [text, setText] = useState('Thank you for the meeting!')
  const [presetId, setPresetId] = useState<Preset['id']>('fade')
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [status, setStatus] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const baseXRef = useRef<number[]>([])
  const baseYRef = useRef<number>(BASE_TOP)

  const preset = useMemo(() => PRESETS.find((p) => p.id === presetId) ?? PRESETS[0], [presetId])
  const defaultPresets = useMemo(
    () => DEFAULT_PRESET_IDS.map((id) => PRESETS.find((p) => p.id === id)!).filter(Boolean),
    [],
  )

  // Create the fabric canvas once.
  useEffect(() => {
    if (!canvasElRef.current) return
    const canvas = new Canvas(canvasElRef.current, {
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#ffffff',
      selection: false,
      // Fabric scales its backing canvas by devicePixelRatio by default (e.g. 1200x360
      // on a retina display for a "600x180" canvas). GIF export reads raw pixels from
      // this element at a fixed 600x180 window via getImageData, so a scaled backing
      // store would silently crop the export to its top-left quarter. Keeping the
      // backing store at exactly WIDTHxHEIGHT keeps preview and export pixel-identical.
      enableRetinaScaling: false,
    })
    fabricCanvasRef.current = canvas
    return () => {
      canvas.dispose()
      fabricCanvasRef.current = null
    }
  }, [])

  // Rebuild the scene (fabric objects) whenever text or preset changes, then play the
  // live entrance via a GSAP-ticker-driven loop that samples the same pure function used
  // for GIF export, so preview and export never drift apart.
  useEffect(() => {
    const canvas = fabricCanvasRef.current
    if (!canvas) return

    // Clear the previous scene's objects.
    if (sceneRef.current) {
      for (const obj of sceneRef.current.objects) canvas.remove(obj)
      if (sceneRef.current.decoration) canvas.remove(sceneRef.current.decoration)
    }

    const ctx = canvas.getElement().getContext('2d')
    if (!ctx) return
    const scene = buildScene(canvas, ctx, text, preset, fontSize)
    sceneRef.current = scene
    baseXRef.current = scene.objects.map((o) => o.left ?? 0)
    baseYRef.current = BASE_TOP

    const startTime = performance.now()
    const count = scene.objects.length
    const entranceSpanMs = totalEntranceMs(preset)

    const tick = () => {
      const elapsed = performance.now() - startTime
      scene.objects.forEach((obj, i) => {
        const s = sampleObject(preset, i, count, elapsed)
        obj.set({
          left: baseXRef.current[i] + s.x,
          top: baseYRef.current + s.y,
          opacity: s.opacity,
          scaleX: s.scale,
          scaleY: s.scale,
          angle: s.rotate,
          fill: s.fill,
          shadow: s.glowBlur > 0.1 ? new Shadow({ color: s.glowColor, blur: s.glowBlur, offsetX: 0, offsetY: 0 }) : undefined,
        })
      })
      if (scene.decoration) {
        const progress = Math.min(1, Math.max(0, elapsed / entranceSpanMs))
        const eased = preset.ease(progress)
        scene.decoration.set({ opacity: eased, scaleX: eased })
      }
      canvas.requestRenderAll()

      // Stop re-rendering once the full staggered entrance has settled — nothing left
      // to animate. Must wait for entranceSpanMs (entrance + stagger spread), not just
      // entranceMs, or multi-segment presets freeze mid-animation.
      if (elapsed < entranceSpanMs + 200) {
        canvas.requestRenderAll()
      } else {
        gsap.ticker.remove(tick)
      }
    }
    gsap.ticker.add(tick)

    return () => {
      gsap.ticker.remove(tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, presetId, fontSize])

  async function handleDownloadGif() {
    const canvas = fabricCanvasRef.current
    const scene = sceneRef.current
    if (!canvas || !scene) return

    setIsExporting(true)
    setStatus('Rendering frames…')

    try {
      const ctx = canvas.getElement().getContext('2d')
      if (!ctx) throw new Error('no 2d context on fabric canvas element')

      const entranceSpanMs = totalEntranceMs(preset)
      const totalMs = entranceSpanMs + preset.holdMs
      const fps = 12
      const count = scene.objects.length

      const blob = exportGif(
        {
          width: WIDTH,
          height: HEIGHT,
          renderFrame: (tSec) => {
            // Clamp to the full staggered entrance span (not bare entranceMs), or
            // later segments in multi-object presets never reach their final state.
            const tMs = Math.min(tSec * 1000, entranceSpanMs)
            scene.objects.forEach((obj, i) => {
              const s = sampleObject(preset, i, count, tMs)
              obj.set({
                left: baseXRef.current[i] + s.x,
                top: baseYRef.current + s.y,
                opacity: s.opacity,
                scaleX: s.scale,
                scaleY: s.scale,
                angle: s.rotate,
                fill: s.fill,
                shadow:
                  s.glowBlur > 0.1 ? new Shadow({ color: s.glowColor, blur: s.glowBlur, offsetX: 0, offsetY: 0 }) : undefined,
              })
            })
            if (scene.decoration) {
              const progress = Math.min(1, Math.max(0, tMs / entranceSpanMs))
              const eased = preset.ease(progress)
              scene.decoration.set({ opacity: eased, scaleX: eased })
            }
            canvas.renderAll()
            return ctx.getImageData(0, 0, WIDTH, HEIGHT)
          },
        },
        { fps, durationMs: totalMs },
      )

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${presetId}-animation.gif`
      a.click()
      URL.revokeObjectURL(url)

      setStatus(`Downloaded — ${(blob.size / 1024).toFixed(0)} KB`)
    } catch (err) {
      setStatus(`Export failed: ${(err as Error).message}`)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="app">
      <h1>Animate your email</h1>

      <input
        className="text-input"
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type your message…"
        maxLength={70}
      />

      <div className="preview-frame">
        <canvas ref={canvasElRef} width={WIDTH} height={HEIGHT} />
      </div>

      <div className="preset-strip">
        {defaultPresets.map((p) => (
          <button
            key={p.id}
            className={p.id === presetId ? 'preset active' : 'preset'}
            onClick={() => setPresetId(p.id)}
          >
            {p.name}
          </button>
        ))}
        <button className="preset" onClick={() => setDrawerOpen((v) => !v)}>
          {drawerOpen ? 'Less ▲' : 'More ▾'}
        </button>
      </div>

      {drawerOpen && (
        <div className="drawer">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="drawer-category">
              <h3>{cat}</h3>
              <div className="drawer-row">
                {PRESETS.filter((p) => p.category === cat).map((p) => (
                  <button
                    key={p.id}
                    className={p.id === presetId ? 'preset active' : 'preset'}
                    onClick={() => setPresetId(p.id)}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="customize-toggle">
        <button className="preset" onClick={() => setCustomizeOpen((v) => !v)}>
          {customizeOpen ? 'Customize ▲' : 'Customize ▾'}
        </button>
      </div>

      {customizeOpen && (
        <div className="drawer customize-panel">
          <label className="field">
            <span>
              Font size <span className="field-value">{fontSize}px</span>
            </span>
            <input
              type="range"
              min={MIN_FONT_SIZE}
              max={MAX_FONT_SIZE}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </label>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={handleDownloadGif} disabled={isExporting}>
          {isExporting ? 'Rendering…' : 'Download GIF'}
        </button>
      </div>

      {status && <p className="status">{status}</p>}
    </div>
  )
}

export default App
