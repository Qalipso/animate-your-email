import { useEffect, useRef, useState } from 'react'
import { Canvas, Textbox } from 'fabric'
import gsap from 'gsap'
import { PRESETS, sampleAt, type Preset } from './presets'
import { exportGif } from './gifExport'
import './App.css'

const WIDTH = 600
const HEIGHT = 180
const BASE_TOP = HEIGHT / 2

function App() {
  const [text, setText] = useState('Thank you for the meeting!')
  const [presetId, setPresetId] = useState<Preset['id']>('fade')
  const [status, setStatus] = useState('')
  const [isExporting, setIsExporting] = useState(false)

  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const fabricCanvasRef = useRef<Canvas | null>(null)
  const textboxRef = useRef<Textbox | null>(null)

  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]

  // Set up the Fabric canvas + text object once.
  useEffect(() => {
    if (!canvasElRef.current) return
    const canvas = new Canvas(canvasElRef.current, {
      width: WIDTH,
      height: HEIGHT,
      backgroundColor: '#ffffff',
      selection: false,
    })
    const textbox = new Textbox('', {
      left: WIDTH / 2,
      top: BASE_TOP,
      originX: 'center',
      originY: 'center',
      width: WIDTH - 80,
      fontSize: 40,
      fontFamily: '-apple-system, sans-serif',
      fill: '#1a1a1a',
      textAlign: 'center',
      selectable: false,
      evented: false,
    })
    canvas.add(textbox)
    fabricCanvasRef.current = canvas
    textboxRef.current = textbox
    return () => {
      canvas.dispose()
      fabricCanvasRef.current = null
      textboxRef.current = null
    }
  }, [])

  // Keep the text content in sync.
  useEffect(() => {
    const textbox = textboxRef.current
    const canvas = fabricCanvasRef.current
    if (!textbox || !canvas) return
    textbox.set({ text })
    canvas.requestRenderAll()
  }, [text])

  // Play the live entrance preview whenever text or preset changes.
  useEffect(() => {
    const textbox = textboxRef.current
    const canvas = fabricCanvasRef.current
    if (!textbox || !canvas) return

    const proxy = { ...preset.from }
    const tween = gsap.to(proxy, {
      opacity: preset.to.opacity,
      translateY: preset.to.translateY,
      duration: preset.entranceMs / 1000,
      ease: 'power3.out',
      onUpdate: () => {
        textbox.set({
          opacity: proxy.opacity,
          top: BASE_TOP + proxy.translateY,
        })
        canvas.requestRenderAll()
      },
    })
    return () => {
      tween.kill()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, presetId])

  async function handleDownloadGif() {
    const canvas = fabricCanvasRef.current
    const textbox = textboxRef.current
    if (!canvas || !textbox) return

    setIsExporting(true)
    setStatus('Rendering frames…')

    try {
      const ctx = canvas.getElement().getContext('2d')
      if (!ctx) throw new Error('no 2d context on fabric canvas element')

      const totalMs = preset.entranceMs + preset.holdMs
      const fps = 12

      const blob = exportGif(
        {
          width: WIDTH,
          height: HEIGHT,
          renderFrame: (tSec) => {
            const tMs = tSec * 1000
            // Hold on the final frame once the entrance animation has finished.
            const sample = sampleAt(preset, Math.min(tMs, preset.entranceMs))
            textbox.set({ opacity: sample.opacity, top: BASE_TOP + sample.translateY })
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
      // Restore the live preview's final resting state.
      textbox.set({ opacity: preset.to.opacity, top: BASE_TOP + preset.to.translateY })
      canvas.requestRenderAll()
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
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={p.id === presetId ? 'preset active' : 'preset'}
            onClick={() => setPresetId(p.id)}
          >
            {p.name}
          </button>
        ))}
      </div>

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
