import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, FabricText, Rect, Shadow } from 'fabric'
import gsap from 'gsap'
import { DEFAULT_PRESET_IDS, PRESETS } from './engine/presets'
import { sampleObject } from './engine/sample'
import { splitAndMeasure } from './engine/textSplit'
import type { Category, Preset } from './engine/types'
import { exportGif } from './gifExport'
import './App.css'

const WIDTH = 600
const HEIGHT = 180
const BASE_TOP = HEIGHT / 2
const FONT_SIZE = 40
const FONT_FAMILY = '-apple-system, sans-serif'
const CATEGORIES: Category[] = ['Clean', 'Typing', 'Editorial', 'Playful', 'Bold', 'Light & Color']

interface Scene {
  objects: FabricText[]
  decoration: Rect | null
  preset: Preset
}

/** Builds the fabric objects for one text render (single block, or one per word/character). */
function buildScene(canvas: Canvas, ctx: CanvasRenderingContext2D, text: string, preset: Preset): Scene {
  ctx.font = `${FONT_SIZE}px ${FONT_FAMILY}`
  const { segments, totalWidth } = splitAndMeasure(ctx, text || ' ', preset.split)
  const startX = (WIDTH - totalWidth) / 2

  const objects = segments.map((seg) => {
    const obj = new FabricText(seg.text, {
      left: startX + seg.x,
      top: BASE_TOP,
      originX: 'left',
      originY: 'center',
      fontSize: FONT_SIZE,
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
      top: BASE_TOP + FONT_SIZE / 2 + 6,
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
      height: FONT_SIZE + 10,
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
  const [drawerOpen, setDrawerOpen] = useState(false)
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
    const scene = buildScene(canvas, ctx, text, preset)
    sceneRef.current = scene
    baseXRef.current = scene.objects.map((o) => o.left ?? 0)
    baseYRef.current = BASE_TOP

    const startTime = performance.now()
    const count = scene.objects.length

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
        const progress = Math.min(1, Math.max(0, elapsed / preset.entranceMs))
        const eased = preset.ease(progress)
        scene.decoration.set({ opacity: eased, scaleX: eased })
      }
      canvas.requestRenderAll()

      // Stop re-rendering once the entrance has settled — nothing left to animate.
      if (elapsed < preset.entranceMs + 200) {
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
  }, [text, presetId])

  async function handleDownloadGif() {
    const canvas = fabricCanvasRef.current
    const scene = sceneRef.current
    if (!canvas || !scene) return

    setIsExporting(true)
    setStatus('Rendering frames…')

    try {
      const ctx = canvas.getElement().getContext('2d')
      if (!ctx) throw new Error('no 2d context on fabric canvas element')

      const totalMs = preset.entranceMs + preset.holdMs
      const fps = 12
      const count = scene.objects.length

      const blob = exportGif(
        {
          width: WIDTH,
          height: HEIGHT,
          renderFrame: (tSec) => {
            const tMs = Math.min(tSec * 1000, preset.entranceMs)
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
              const progress = Math.min(1, Math.max(0, tMs / preset.entranceMs))
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
