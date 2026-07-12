import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export interface FrameSource {
  width: number
  height: number
  /** Called for each sampled frame; must synchronously render and return RGBA pixel data. */
  renderFrame: (t: number) => ImageData
}

export interface GifExportOptions {
  fps: number
  durationMs: number
  delayMs?: number
}

/** Samples `renderFrame` at a fixed fps across `durationMs` and encodes the result as a GIF Blob. */
export function exportGif(source: FrameSource, options: GifExportOptions): Blob {
  const { width, height } = source
  const frameCount = Math.round((options.durationMs / 1000) * options.fps)
  const frameDelay = options.delayMs ?? Math.round(1000 / options.fps)

  const gif = GIFEncoder()

  for (let i = 0; i < frameCount; i++) {
    const t = i / options.fps
    const { data } = source.renderFrame(t)
    const palette = quantize(data, 256)
    const index = applyPalette(data, palette)
    gif.writeFrame(index, width, height, { palette, delay: frameDelay })
  }

  gif.finish()
  const bytes = gif.bytes()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type: 'image/gif' })
}
