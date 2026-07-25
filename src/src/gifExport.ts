import { GIFEncoder, quantize, applyPalette } from 'gifenc'

export interface FrameSource {
  width: number
  height: number
  /** Called for each sampled frame; must synchronously render and return RGBA pixel data at output resolution. */
  renderFrame: (t: number) => ImageData
}

export interface GifExportOptions {
  fps: number
  durationMs: number
  /** 0..1, reported across both the palette pass and the encode pass. */
  onProgress?: (fraction: number) => void
}

/**
 * GIF frame delays are stored in hundredths of a second, so any delay that isn't a multiple
 * of 10ms is silently rounded by the encoder — 12fps (83.33ms) became 80ms, i.e. the file
 * actually played at 12.5fps while every frame had been rendered against a 12fps clock.
 * Snapping the delay first, then deriving each frame's render time from that same delay,
 * keeps rendered time and played-back time identical.
 */
export function snapDelayMs(fps: number): number {
  return Math.max(20, Math.round(1000 / fps / 10) * 10)
}

/** Frames sampled to build the shared palette. More frames = better colour coverage, linearly more work. */
const PALETTE_SAMPLE_FRAMES = 10
/** Take every Nth pixel when sampling for the palette — full frames would cost tens of MB. */
const PALETTE_PIXEL_STRIDE = 3

/**
 * Builds ONE palette for the whole animation from a spread of sampled frames.
 *
 * Quantizing each frame independently (the previous behaviour) gave every frame its own
 * 256-colour table, which both bloated the file by 768 bytes per frame and made the image
 * crawl: a colour that survives quantization in frame N can be merged away in frame N+1,
 * so anti-aliased glyph edges visibly shimmer even where nothing is animating. A shared
 * palette removes both problems.
 */
function buildGlobalPalette(
  source: FrameSource,
  frameCount: number,
  delayMs: number,
  onProgress?: (f: number) => void,
) {
  const sampleCount = Math.min(PALETTE_SAMPLE_FRAMES, frameCount)
  const pixelsPerFrame = source.width * source.height
  const sampledPerFrame = Math.ceil(pixelsPerFrame / PALETTE_PIXEL_STRIDE)
  const sample = new Uint8Array(sampledPerFrame * sampleCount * 4)
  let out = 0

  for (let s = 0; s < sampleCount; s++) {
    const frameIndex = sampleCount === 1 ? 0 : Math.round((s * (frameCount - 1)) / (sampleCount - 1))
    const { data } = source.renderFrame((frameIndex * delayMs) / 1000)
    for (let p = 0; p < pixelsPerFrame; p += PALETTE_PIXEL_STRIDE) {
      const i = p * 4
      sample[out++] = data[i]
      sample[out++] = data[i + 1]
      sample[out++] = data[i + 2]
      sample[out++] = 255
    }
    onProgress?.((s + 1) / sampleCount)
  }

  // 255, not 256: one index is reserved below as the inter-frame transparency key.
  return quantize(sample.subarray(0, out), 255, { format: 'rgb565' })
}

/** Samples `renderFrame` at a fixed, centisecond-exact frame delay and encodes the result as a GIF Blob. */
export function exportGif(source: FrameSource, options: GifExportOptions): Blob {
  const { width, height } = source
  const delayMs = snapDelayMs(options.fps)
  const frameCount = Math.max(1, Math.round(options.durationMs / delayMs))
  const { onProgress } = options

  // The palette pass is ~10 renders; the encode pass is `frameCount` renders plus the
  // (dominant) LZW encode. Weighting the palette pass at 20% of the bar keeps it honest.
  const palette = buildGlobalPalette(source, frameCount, delayMs, (f) => onProgress?.(f * 0.2))

  // Inter-frame differencing. Most of a text animation is unchanged white page and static
  // glyphs; writing every frame in full made a 2-scene story export ~1.9 MB, well past what
  // an email client will happily carry. Pixels identical to the previous frame are written
  // as a transparent index and composited over what is already on screen (dispose: 1), which
  // both collapses to long LZW runs and is the standard way animated GIFs are encoded.
  //
  // The transparent index is the first slot applyPalette can never return (it only maps into
  // `palette`), and `paletteForWrite` is one entry longer purely so the emitted colour table
  // is guaranteed to cover that index.
  const transparentIndex = palette.length
  const paletteForWrite = [...palette, [0, 0, 0]]

  const gif = GIFEncoder()
  let previous: Uint8Array | null = null

  for (let i = 0; i < frameCount; i++) {
    const { data } = source.renderFrame((i * delayMs) / 1000)
    const index = applyPalette(data, palette, 'rgb565')

    let frameIndex = index
    if (previous) {
      // Compared on palette indices rather than raw RGBA: sub-quantization-step noise that
      // resolves to the same colour is genuinely no change, and skipping it too is free.
      frameIndex = new Uint8Array(index)
      for (let p = 0; p < frameIndex.length; p++) {
        if (frameIndex[p] === previous[p]) frameIndex[p] = transparentIndex
      }
    }
    previous = index

    // The palette is written once, as the global colour table. gifenc emits a *local*
    // table for any later frame that also passes `palette`, so subsequent frames must
    // omit it — they resolve their indices against the global table instead.
    gif.writeFrame(frameIndex, width, height, {
      delay: delayMs,
      dispose: 1, // leave the composited result in place for the next frame to draw over
      transparent: i > 0,
      transparentIndex,
      ...(i === 0 ? { palette: paletteForWrite } : {}),
    })
    onProgress?.(0.2 + (0.8 * (i + 1)) / frameCount)
  }

  gif.finish()
  const bytes = gif.bytes()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type: 'image/gif' })
}
