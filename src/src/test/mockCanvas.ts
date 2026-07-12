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

export class MockCanvasContext {
  font = '16px sans-serif'
  fillStyle = '#000'
  strokeStyle = '#000'
  lineWidth = 1
  globalAlpha = 1
  globalCompositeOperation = 'source-over'
  filter = 'none'
  shadowColor = 'transparent'
  shadowBlur = 0
  textBaseline = 'alphabetic'
  canvas: MockCanvas

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

  fillRect() {}
  strokeRect() {}
  fillText() {}
  strokeText() {}
  beginPath() {}
  moveTo() {}
  lineTo() {}
  stroke() {}
  fill() {}
  save() {}
  restore() {}
  translate() {}
  scale() {}
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
