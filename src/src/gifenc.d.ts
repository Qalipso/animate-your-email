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

  export function GIFEncoder(opts?: { auto?: boolean }): GifEncoderInstance
  export function quantize(data: Uint8Array | Uint8ClampedArray, maxColors: number): number[][]
  export function applyPalette(data: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array
}
