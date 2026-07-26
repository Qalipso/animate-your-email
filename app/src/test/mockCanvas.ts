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

/** A fillRect the renderer issued, so tests can assert on painted geometry, not just that nothing threw. */
export interface RecordedRect {
  x: number
  y: number
  w: number
  h: number
  fillStyle: string
}

export class MockCanvasContext {
  font = '16px sans-serif'
  fillStyle = '#000'
  strokeStyle = '#000'
  lineWidth = 1
  lineCap = 'butt'
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
  beginPath() {}
  closePath() {}
  moveTo() {}
  lineTo() {}
  arc() {}
  stroke() {}
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
}
