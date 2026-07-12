import { useState } from 'react'
import { buildAnimatedDocument, layoutSceneForRender } from './engine/document'
import { computeSceneTiming, renderScene } from './engine/render'
import { buildTimeline, renderTimelineFrame, type Timeline } from './engine/timeline'
import { exportDocumentAsGif } from './engine/exportV2'
import type {
  AnimatedDocument,
  EmphasisPresetId,
  EntrancePresetId,
  Scene,
  TransitionPresetId,
} from './engine/model'
import './DebugPresets.css'

type PresetRole = 'entrance' | 'emphasis' | 'transition'

interface PresetDef {
  role: PresetRole
  id: EntrancePresetId | EmphasisPresetId | TransitionPresetId
  name: string
}

const ENTRANCE_PRESETS: PresetDef[] = [
  { role: 'entrance', id: 'fade', name: 'Fade' },
  { role: 'entrance', id: 'soft-rise', name: 'Soft Rise' },
  { role: 'entrance', id: 'blur-reveal', name: 'Blur Reveal' },
  { role: 'entrance', id: 'word-cascade', name: 'Word Cascade' },
]
const EMPHASIS_PRESETS: PresetDef[] = [
  { role: 'emphasis', id: 'marker-highlight', name: 'Marker Highlight' },
  { role: 'emphasis', id: 'underline-draw', name: 'Underline Draw' },
  { role: 'emphasis', id: 'soft-glow', name: 'Soft Glow' },
  { role: 'emphasis', id: 'gentle-pop', name: 'Gentle Pop' },
  { role: 'emphasis', id: 'shimmer', name: 'Shimmer' },
  { role: 'emphasis', id: 'weight-shift', name: 'Weight Shift' },
  { role: 'emphasis', id: 'burn', name: 'Burn' },
  { role: 'emphasis', id: 'wash-away', name: 'Wash Away' },
  { role: 'emphasis', id: 'bow-highlight', name: 'Pink Highlight + Bow' },
  { role: 'emphasis', id: 'glitch', name: 'Glitch' },
]
const TRANSITION_PRESETS: PresetDef[] = [
  { role: 'transition', id: 'crossfade', name: 'Crossfade' },
  { role: 'transition', id: 'slide-up', name: 'Slide Up' },
]
const ALL_PRESETS = [...ENTRANCE_PRESETS, ...EMPHASIS_PRESETS, ...TRANSITION_PRESETS]

interface Sample {
  id: string
  name: string
  text: string
  mode: 'one-card' | 'paragraph' | 'story'
}

const SAMPLES: Sample[] = [
  { id: 'short', name: 'Short', text: 'Thank you for the *great work* today!', mode: 'one-card' },
  {
    id: 'multiline',
    name: 'Multiline',
    text:
      'We are excited to share our [[quarterly results]] with the whole team.\n\n' +
      'Revenue grew significantly and customer satisfaction reached an all-time high this quarter.\n\n' +
      'Thank you for everything you contributed — every review, every late night, every bug report mattered.',
    mode: 'story',
  },
  { id: 'cyrillic', name: 'Cyrillic', text: 'Спасибо за [[отличную работу]] сегодня, с 12 июля 2026 года!', mode: 'one-card' },
  { id: 'emoji', name: 'Emoji', text: 'Great job team 🎉🚀 — you [[crushed it]] today 😊', mode: 'one-card' },
]

interface CellResult {
  status: 'idle' | 'running' | 'done' | 'error'
  firstFrame?: string
  midFrame?: string
  finalFrame?: string
  frameCount?: number
  exportDurationMs?: number
  fileSizeBytes?: number
  error?: string
}

function key(presetId: string, sampleId: string) {
  return `${presetId}:${sampleId}`
}

async function frameToDataUrl(width: number, height: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<string> {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
  draw(ctx)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  return URL.createObjectURL(blob)
}

/** Builds a single-scene test document for an entrance preset, or forces every animated run in the scene to a specific emphasis preset for emphasis-preset testing. Debug-only — production highlight detection always assigns the emphasis preset itself. */
async function buildEntranceOrEmphasisDoc(
  sample: Sample,
  role: 'entrance' | 'emphasis',
  presetId: string,
): Promise<AnimatedDocument> {
  const doc = await buildAnimatedDocument(sample.text, {
    mode: sample.mode,
    modeIsOverridden: true,
    entrance: role === 'entrance' ? (presetId as EntrancePresetId) : 'fade',
    transition: 'crossfade',
  })
  if (role === 'emphasis') {
    for (const scene of doc.scenes) {
      for (const block of scene.blocks) {
        for (const run of block.runs) {
          if (run.highlight) {
            run.highlight.animated = true
            run.highlight.emphasisPreset = presetId as EmphasisPresetId
          }
        }
      }
    }
  }
  return doc
}

/** Builds a synthetic 2-scene document (from two independently-built one-scene docs) to test a transition preset between genuinely different content. */
async function buildTransitionDoc(sample: Sample, presetId: string): Promise<AnimatedDocument> {
  const [a, b] = sample.text.split('\n\n')
  const docA = await buildAnimatedDocument(a || sample.text, { mode: 'one-card', modeIsOverridden: true, entrance: 'fade', transition: presetId as TransitionPresetId })
  const docB = await buildAnimatedDocument(b || 'Second scene.', { mode: 'one-card', modeIsOverridden: true, entrance: 'soft-rise', transition: presetId as TransitionPresetId })
  const sceneA: Scene = { ...docA.scenes[0], transition: presetId as TransitionPresetId }
  const sceneB: Scene = { ...docB.scenes[0] }
  return { ...docA, scenes: [sceneA, sceneB], truncated: false }
}

async function runCell(preset: PresetDef, sample: Sample): Promise<CellResult> {
  const t0 = performance.now()
  try {
    let doc: AnimatedDocument
    let timeline: Timeline | null = null
    let firstFrame: string
    let midFrame: string
    let finalFrame: string
    let totalMs: number

    if (preset.role === 'transition') {
      doc = await buildTransitionDoc(sample, preset.id)
      timeline = await buildTimeline(doc)
      totalMs = timeline.totalMs
      firstFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderTimelineFrame(ctx, doc, timeline!, 0))
      midFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderTimelineFrame(ctx, doc, timeline!, totalMs / 2))
      finalFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderTimelineFrame(ctx, doc, timeline!, totalMs))
    } else {
      doc = await buildEntranceOrEmphasisDoc(sample, preset.role, preset.id)
      const scene = doc.scenes[0]
      const layout = await layoutSceneForRender(doc, scene)
      const timing = computeSceneTiming(layout, scene.entrance)
      totalMs = timing.totalMs
      firstFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderScene(ctx, doc, layout, scene.entrance, 0, timing))
      midFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderScene(ctx, doc, layout, scene.entrance, totalMs / 2, timing))
      finalFrame = await frameToDataUrl(doc.width, doc.height, (ctx) => renderScene(ctx, doc, layout, scene.entrance, totalMs, timing))
    }

    const fps = 12
    const frameCount = Math.round((totalMs / 1000) * fps)
    const gifBlob = await exportDocumentAsGif(doc, fps)
    const exportDurationMs = performance.now() - t0

    return {
      status: 'done',
      firstFrame,
      midFrame,
      finalFrame,
      frameCount,
      exportDurationMs,
      fileSizeBytes: gifBlob.size,
    }
  } catch (err) {
    return { status: 'error', error: (err as Error).message }
  }
}

function DebugPresets() {
  const [results, setResults] = useState<Record<string, CellResult>>({})
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)

  async function runAll() {
    setRunning(true)
    setProgress(0)
    const total = ALL_PRESETS.length * SAMPLES.length
    let done = 0
    for (const preset of ALL_PRESETS) {
      for (const sample of SAMPLES) {
        const k = key(preset.id, sample.id)
        setResults((r) => ({ ...r, [k]: { status: 'running' } }))
        // Sequential on purpose: exportDocumentAsGif rejects a second concurrent export.
        const result = await runCell(preset, sample)
        setResults((r) => ({ ...r, [k]: result }))
        done += 1
        setProgress(done / total)
      }
    }
    setRunning(false)
  }

  function renderRole(role: PresetRole, presets: PresetDef[], label: string) {
    return (
      <section key={role} className="qa-section">
        <h2>{label}</h2>
        {presets.map((preset) => (
          <div key={preset.id} className="qa-row">
            <div className="qa-row-label">{preset.name}</div>
            <div className="qa-cells">
              {SAMPLES.map((sample) => {
                const r = results[key(preset.id, sample.id)]
                return (
                  <div key={sample.id} className="qa-cell">
                    <div className="qa-cell-label">{sample.name}</div>
                    {!r && <div className="qa-cell-empty">not run</div>}
                    {r?.status === 'running' && <div className="qa-cell-empty">running…</div>}
                    {r?.status === 'error' && <div className="qa-cell-error">error: {r.error}</div>}
                    {r?.status === 'done' && (
                      <>
                        <div className="qa-frames">
                          <img src={r.firstFrame} alt="first frame" title="first frame" />
                          <img src={r.midFrame} alt="midpoint frame" title="midpoint frame" />
                          <img src={r.finalFrame} alt="final frame" title="final frame" />
                        </div>
                        <div className="qa-stats">
                          {r.frameCount} frames · {r.exportDurationMs?.toFixed(0)}ms export ·{' '}
                          {((r.fileSizeBytes ?? 0) / 1024).toFixed(0)}KB
                        </div>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>
    )
  }

  return (
    <div className="qa-page">
      <h1>Preset visual QA matrix</h1>
      <p>
        Every entrance/emphasis/transition preset × short/multiline/Cyrillic/emoji samples. Each cell shows first/mid/final
        frame, frame count, export duration, and GIF file size — from the real render + export pipeline, not a mock.
      </p>
      <button className="qa-run-all" onClick={runAll} disabled={running}>
        {running ? `Running… ${(progress * 100).toFixed(0)}%` : 'Run all'}
      </button>

      {renderRole('entrance', ENTRANCE_PRESETS, 'Entrance')}
      {renderRole('emphasis', EMPHASIS_PRESETS, 'Emphasis')}
      {renderRole('transition', TRANSITION_PRESETS, 'Transition')}
    </div>
  )
}

export default DebugPresets
