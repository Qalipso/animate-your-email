import { readFile } from 'node:fs/promises'
import { expect, test, type Download, type Page } from '@playwright/test'

/**
 * These tests drive the real UI and inspect the file it actually produced. They deliberately
 * do not import the engine: the point is to catch a regression in the *shipped bundle* —
 * worker URL resolution, asset base, encoder settings — not to re-test the unit-tested
 * internals a second time.
 */

async function saveAndRead(page: Page, trigger: () => Promise<void>): Promise<Buffer> {
  const [download]: [Download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), trigger()])
  const path = await download.path()
  return readFile(path!)
}

/** Decodes an image in the page with WebCodecs and returns per-frame RGBA + durations. */
async function decodeInPage(page: Page, bytes: Buffer, type: string, frameIndices: number[] | 'all') {
  return page.evaluate(
    async ({ data, type, frameIndices }) => {
      const dec = new ImageDecoder({ data: new Uint8Array(data), type })
      await dec.tracks.ready
      await dec.completed
      const frameCount = dec.tracks.selectedTrack!.frameCount
      const indices = frameIndices === 'all' ? [...Array(frameCount).keys()] : (frameIndices as number[])

      const canvas = new OffscreenCanvas(1, 1)
      const out: { index: number; durationUs: number | null; darkPixels: number; width: number; height: number; digest: number[] }[] = []
      for (const index of indices) {
        const { image } = await dec.decode({ frameIndex: index })
        canvas.width = image.displayWidth
        canvas.height = image.displayHeight
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0)
        const { data: px } = ctx.getImageData(0, 0, canvas.width, canvas.height)
        let dark = 0
        for (let i = 0; i < px.length; i += 4) {
          if (px[i] < 128 && px[i + 1] < 128 && px[i + 2] < 128) dark++
        }
        // Coarse row digest, enough to tell "same picture" from "different picture"
        // without shipping megabytes of pixels back to Node.
        const digest: number[] = []
        for (let row = 0; row < canvas.height; row += Math.max(1, Math.floor(canvas.height / 16))) {
          let sum = 0
          for (let x = 0; x < canvas.width; x++) {
            const i = (row * canvas.width + x) * 4
            sum += px[i] + px[i + 1] + px[i + 2]
          }
          digest.push(Math.round(sum / canvas.width))
        }
        out.push({ index, durationUs: image.duration, darkPixels: dark, width: canvas.width, height: canvas.height, digest })
      }
      return { frameCount, frames: out }
    },
    { data: [...bytes], type, frameIndices },
  )
}

test('Save GIF produces a valid, animated, correctly-timed GIF', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.preview-frame canvas').first()).toBeVisible()

  const bytes = await saveAndRead(page, () => page.getByRole('button', { name: /Save GIF/ }).click())

  // GIF89a header, and a size that is plausible for an animation but not email-hostile.
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a')
  expect(bytes.byteLength).toBeGreaterThan(5_000)
  expect(bytes.byteLength).toBeLessThan(1_500_000)

  const { frameCount, frames } = await decodeInPage(page, bytes, 'image/gif', 'all')
  expect(frameCount).toBeGreaterThan(10)

  // Every delay is a whole centisecond and identical: GIF stores delays in 1/100s, so a
  // frame rate that doesn't divide evenly silently plays at a different speed than rendered.
  const durations = new Set(frames.map((f) => f.durationUs))
  expect([...durations]).toEqual([50_000])

  // No blank frames anywhere — a blank frame is what the old retina/stagger bugs produced.
  for (const f of frames) {
    expect(f.darkPixels, `frame ${f.index} is blank`).toBeGreaterThan(0)
  }
})

test('the text is fully readable in the very first frame, not revealed over time', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.preview-frame canvas').first()).toBeVisible()
  const bytes = await saveAndRead(page, () => page.getByRole('button', { name: /Save GIF/ }).click())

  const { frameCount } = await decodeInPage(page, bytes, 'image/gif', [0])
  const { frames } = await decodeInPage(page, bytes, 'image/gif', [0, frameCount - 1])
  const [first, last] = frames

  // The product's central promise (DEC-010): only the effect layer animates, the base text is
  // there from frame one. If a future preset reintroduces a reveal, the first frame will be
  // visibly emptier than the last and this fails.
  expect(first.darkPixels).toBeGreaterThan(last.darkPixels * 0.85)
  expect(first.width).toBe(last.width)
  expect(first.height).toBe(last.height)
})

test('the GIF’s settled frame matches the still PNG export', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.preview-frame canvas').first()).toBeVisible()

  const gif = await saveAndRead(page, () => page.getByRole('button', { name: /Save GIF/ }).click())
  const png = await saveAndRead(page, () => page.getByRole('button', { name: /Save a still PNG/ }).click())

  const gifDecoded = await decodeInPage(page, gif, 'image/gif', 'all')
  const lastGif = gifDecoded.frames[gifDecoded.frames.length - 1]
  const pngDecoded = await decodeInPage(page, png, 'image/png', [0])
  const still = pngDecoded.frames[0]

  expect(lastGif.width).toBe(still.width)
  expect(lastGif.height).toBe(still.height)

  // Same renderer, same settled time — the only expected difference is the GIF's 255-colour
  // quantization, which cannot move a row's mean brightness far.
  expect(lastGif.digest.length).toBe(still.digest.length)
  const worstRow = Math.max(...lastGif.digest.map((v, i) => Math.abs(v - still.digest[i])))
  expect(worstRow).toBeLessThan(12)
})
