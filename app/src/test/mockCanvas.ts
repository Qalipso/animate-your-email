// A minimal, deterministic stand-in for CanvasRenderingContext2D / OffscreenCanvas so
// the engine's layout and render logic can be tested under plain Node (no browser, no
// jsdom canvas native bindings). measureText uses a fixed per-character-width formula
// tied to the current font size — not pixel-accurate to any real font, but deterministic
// and monotonic (longer text/bigger font -> wider), which is all the layout logic needs.

function parseFontSize(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font)
  return m ? Number(m[1]) : 16
}

class MockGradient {
  addColorStop() {}
}

/**
 * Stand-in for Path2D. The renderer now hands geometry to the canvas as SVG path data (the
 * same strings the SVG exporter emits), so the mock has to understand `d` well enough for
 * tests to assert on what was drawn — the coordinates are all that matters here.
 */
export class MockPath2D {
  readonly d: string
  readonly points: { x: number; y: number }[]

  constructor(d = '') {
    this.d = d
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number)
    this.points = []
    // Commands used by the sketch primitives are M/L (one point) and Q (control + end);
    // taking every coordinate pair covers both, and control points sit within the stroke's
    // own extent so they don't distort the measured span.
    for (let i = 0; i + 1 < nums.length; i += 2) {
      this.points.push({ x: nums[i], y: nums[i + 1] })
    }
  }
}

/** A fillRect the renderer issued, so tests can assert on painted geometry, not just that nothing threw. */
export interface RecordedRect {
  x: number
  y: number
  w: number
  h: number
  fillStyle: string
}

/** A stroked path, reduced to its extent — enough to assert what a hand-drawn annotation covered. */
export interface RecordedStroke {
  x0: number
  y0: number
  x1: number
  y1: number
  minX: number
  maxX: number
  strokeStyle: string
  lineWidth: number
}

export class MockCanvasContext {
  font = '16px sans-serif'
  fillStyle = '#000'
  strokeStyle = '#000'
  lineWidth = 1
  lineCap = 'butt'
  lineJoin = 'miter'
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  filter = 'none'
  shadowColor = 'transparent'
  shadowBlur = 0
  textBaseline = 'alphabetic'
  imageSmoothingEnabled = true
  imageSmoothingQuality = 'low'
  canvas: MockCanvas
  readonly rects: RecordedRect[] = []
  readonly strokes: RecordedStroke[] = []
  private path: { x: number; y: number }[] = []

  constructor(canvas: MockCanvas) {
    this.canvas = canvas
  }

  measureText(text: string) {
    const size = parseFontSize(this.font)
    // Roughly monospace-ish average glyph width; consistent across scripts (uses
    // code-point count via Array.from so multi-byte chars like Cyrillic/emoji count once).
    const width = Array.from(text).length * size * 0.55
    return { width } as TextMetrics
  }

  fillRect(x: number, y: number, w: number, h: number) {
    this.rects.push({ x, y, w, h, fillStyle: String(this.fillStyle) })
  }
  clearRect() {}
  strokeRect() {}
  fillText() {}
  strokeText() {}
  beginPath() {
    this.path = []
  }
  closePath() {}
  moveTo(x: number, y: number) {
    this.path.push({ x, y })
  }
  lineTo(x: number, y: number) {
    this.path.push({ x, y })
  }
  quadraticCurveTo(_cx: number, _cy: number, x: number, y: number) {
    this.path.push({ x, y })
  }
  bezierCurveTo(_a: number, _b: number, _c: number, _d: number, x: number, y: number) {
    this.path.push({ x, y })
  }
  ellipse() {}
  arc() {}
  stroke(path?: MockPath2D) {
    const pts = path ? path.points : this.path
    if (pts.length === 0) return
    const xs = pts.map((p) => p.x)
    const first = pts[0]
    const last = pts[pts.length - 1]
    this.strokes.push({
      x0: first.x,
      y0: first.y,
      x1: last.x,
      y1: last.y,
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      strokeStyle: String(this.strokeStyle),
      lineWidth: this.lineWidth,
    })
  }
  fill() {}
  save() {}
  restore() {}
  translate() {}
  scale() {}
  setTransform() {}
  rotate() {}
  createLinearGradient() {
    return new MockGradient() as unknown as CanvasGradient
  }
  drawImage() {}
  getImageData(_x: number, _y: number, w: number, h: number) {
    return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h } as ImageData
  }
}

export class MockCanvas {
  width: number
  height: number
  private ctx: MockCanvasContext

  constructor(width = 10, height = 10) {
    this.width = width
    this.height = height
    this.ctx = new MockCanvasContext(this)
  }

  getContext() {
    return this.ctx
  }

  async convertToBlob() {
    return { size: 1, type: 'image/png' } as unknown as Blob
  }
}

export function installCanvasPolyfill() {
  ;(globalThis as any).OffscreenCanvas = MockCanvas
  ;(globalThis as any).Path2D = MockPath2D
}
