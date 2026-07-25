declare module 'gifenc' {
  export interface GifWriteFrameOptions {
    palette?: number[][]
    delay?: number
    transparent?: boolean
    transparentIndex?: number
    dispose?: number
  }

  export interface GifEncoderInstance {
    writeFrame: (index: Uint8Array, width: number, height: number, opts?: GifWriteFrameOptions) => void
    finish: () => void
    bytes: () => Uint8Array
  }

  /** Colour bucketing used by quantize/applyPalette. Both calls must agree or indices land on the wrong colours. */
  export type GifPaletteFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface QuantizeOptions {
    format?: GifPaletteFormat
    clearAlpha?: boolean
    clearAlphaColor?: number
    clearAlphaThreshold?: number
    oneBitAlpha?: boolean | number
    useSqrt?: boolean
  }

  export function GIFEncoder(opts?: { auto?: boolean }): GifEncoderInstance
  export function quantize(
    data: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions,
  ): number[][]
  export function applyPalette(
    data: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: GifPaletteFormat,
  ): Uint8Array
}
