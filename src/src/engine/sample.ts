import { DEFAULT_STATE, type ObjectState, type Preset } from './types'

/** Deterministic pseudo-random in [0,1), stable across preview ticks and export frames. */
function seededRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseHex(a)
  const pb = parseHex(b)
  if (!pa || !pb) return t < 0.5 ? a : b
  const r = Math.round(lerp(pa[0], pb[0], t))
  const g = Math.round(lerp(pa[1], pb[1], t))
  const bch = Math.round(lerp(pa[2], pb[2], t))
  return `rgb(${r}, ${g}, ${bch})`
}

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** How far into the entrance a given split segment starts, based on the stagger config. */
export function staggerDelayMs(preset: Preset, index: number, count: number): number {
  if (!preset.stagger || count <= 1) return 0
  const { order, amountMs } = preset.stagger
  const span = count - 1
  switch (order) {
    case 'forward':
      return (index / span) * amountMs
    case 'reverse':
      return ((span - index) / span) * amountMs
    case 'random':
      return seededRandom(index + 1) * amountMs
    case 'center-out': {
      const center = span / 2
      const maxDist = Math.max(center, span - center)
      return (Math.abs(index - center) / maxDist) * amountMs
    }
  }
}

/** Evaluates one split segment's full visual state at time tMs from animation start. Pure function — used identically by the live GSAP-driven preview and the deterministic GIF frame export, so what you preview is what you export. */
export function sampleObject(preset: Preset, index: number, count: number, tMs: number): ObjectState {
  const delay = (preset.delayMs ?? 0) + staggerDelayMs(preset, index, count)
  const localT = tMs - delay
  const progress = clamp01(localT / preset.entranceMs)
  const eased = preset.ease(progress)

  const from = { ...DEFAULT_STATE, ...preset.from }
  const to = { ...DEFAULT_STATE, ...preset.to }

  const state: ObjectState = {
    opacity: lerp(from.opacity, to.opacity, eased),
    x: lerp(from.x, to.x, eased),
    y: lerp(from.y, to.y, eased),
    scale: lerp(from.scale, to.scale, eased),
    rotate: lerp(from.rotate, to.rotate, eased),
    fill: lerpColor(from.fill, to.fill, eased),
    glowColor: eased < 0.5 ? from.glowColor : to.glowColor,
    glowBlur: lerp(from.glowBlur, to.glowBlur, eased),
  }

  if (preset.oscillation && localT >= 0) {
    const { channel, amplitude, cycles } = preset.oscillation
    const decay = 1 - eased // settles out as the entrance completes
    const wave = Math.sin(progress * Math.PI * 2 * cycles) * amplitude * decay
    state[channel] = state[channel] + wave
  }

  if (preset.colorFlicker && localT >= 0 && progress < 1) {
    const frameSeed = index * 31 + Math.floor(tMs / 60)
    state.fill = seededRandom(frameSeed) > 0.5 ? from.fill : to.fill
  }

  return state
}
