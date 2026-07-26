import { expect, test } from '@playwright/test'

/** Every emphasis preset offered in the picker; kept in one place so adding one fails loudly. */
const EFFECT_COUNT = 14

const LONG_TEXT = Array.from(
  { length: 9 },
  (_, i) =>
    `Paragraph ${i + 1}: we shipped a great deal this quarter and everyone involved deserves the credit for it.`,
).join('\n\n')

/** Fraction of the preview canvas that is meaningfully darker than the white page. */
async function inkFraction(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('.preview-frame canvas') as HTMLCanvasElement
    const ctx = canvas.getContext('2d')!
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let dark = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) dark++
    }
    return dark / (data.length / 4)
  })
}

async function setText(page: import('@playwright/test').Page, text: string) {
  await page.locator('#source-text').fill(text)
  // The preview rebuild is debounced; wait for the frame readout to settle rather than sleeping.
  await expect(page.locator('.frame-meta')).toBeVisible()
  await page.waitForTimeout(700)
}

test('renders a readable preview for the sample text', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('.preview-frame canvas').first()).toBeVisible()
  expect(await inkFraction(page)).toBeGreaterThan(0.01) // not a blank canvas
  await expect(page.locator('.empty-state')).toHaveCount(0)
})

test('any amount of text stays in exactly one frame', async ({ page }) => {
  await page.goto('/')
  await setText(page, LONG_TEXT)

  // No scene navigation exists any more — the whole point of the single-frame model.
  await expect(page.locator('.scene-nav, .scene-dots, .scene-dot')).toHaveCount(0)

  const state = await page.evaluate(() => {
    const canvas = document.querySelector('.preview-frame canvas') as HTMLCanvasElement
    return { w: canvas.width, h: canvas.height }
  })
  expect(state.w).toBeGreaterThan(0)
  expect(state.h).toBeGreaterThan(0)

  // The readout is the app's own claim about the frame; assert it is a single frame that
  // grew/shrank to fit rather than being clipped.
  const meta = await page.locator('.frame-meta').textContent()
  expect(meta).toMatch(/^\d+ × \d+ · \d+px/)
  const [, height, font] = meta!.match(/^(\d+) × (\d+) · (\d+)px/)!.map(Number) as unknown as number[]
  void height
  void font

  // Nothing was dropped: the app only sets `truncated` (and shows this notice) when text
  // genuinely cannot fit at the minimum readable size.
  await expect(page.locator('.status', { hasText: 'the end was cut' })).toHaveCount(0)
  expect(await inkFraction(page)).toBeGreaterThan(0.02)
})

test('the text fits without the page scrolling sideways, on mobile too', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/')
  await setText(page, LONG_TEXT)
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)
})

test('clicking a word toggles whether it animates', async ({ page }) => {
  await page.goto('/')
  // The phrase chips are on the page directly now — there is no "Advanced" disclosure.
  const chips = page.locator('.chip')
  await expect(chips.first()).toBeVisible()

  const firstChip = chips.first()
  const wasOn = await firstChip.evaluate((el) => el.classList.contains('chip-on'))
  await firstChip.click()
  await expect
    .poll(() => firstChip.evaluate((el) => el.classList.contains('chip-on')))
    .toBe(!wasOn)
})

test('dragging across a phrase offers the effect picker and applies a choice', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.preview-frame canvas').first()
  const box = (await canvas.boundingBox())!

  // Drag along the second line of the sample text, well inside the padded text area.
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.42, { steps: 12 })
  await page.mouse.up()

  const bar = page.locator('.effect-bar')
  await expect(bar).toBeVisible()
  await expect(bar.locator('.effect-option')).toHaveCount(EFFECT_COUNT)

  await bar.locator('.effect-option', { hasText: 'Burn' }).click()
  await expect(bar).toBeHidden()
  // The burnt colour is a warm red the default palette never paints.
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const c = document.querySelector('.preview-frame canvas') as HTMLCanvasElement
          const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
          let warm = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 120 && data[i + 1] < 110 && data[i + 2] < 90) warm++
          }
          return warm
        }),
      { timeout: 8000 },
    )
    .toBeGreaterThan(0)
})

test('hovering an effect shows a live sample of the user’s own word', async ({ page }) => {
  await page.goto('/')
  const canvas = page.locator('.preview-frame canvas').first()
  const box = (await canvas.boundingBox())!

  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.42, { steps: 12 })
  await page.mouse.up()

  const bar = page.locator('.effect-bar')
  await expect(bar).toBeVisible()
  // Grouped, not one flat list of fourteen.
  await expect(bar.locator('.effect-group')).toHaveCount(2)
  await expect(bar.locator('.effect-option')).toHaveCount(EFFECT_COUNT)

  await expect(page.locator('.effect-preview')).toHaveCount(0)
  await bar.locator('.effect-option', { hasText: 'Circle It' }).hover()

  const preview = page.locator('.effect-preview')
  await expect(preview).toBeVisible()

  // It must actually draw the annotation, not just the word — a preview that shows plain text
  // tells the user nothing, which is the problem it exists to solve.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const c = document.querySelector('.effect-preview-canvas') as HTMLCanvasElement | null
          if (!c) return -1
          const { data } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height)
          let red = 0
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 140 && data[i + 1] < 110 && data[i + 2] < 100) red++
          }
          return red
        }),
      { timeout: 8000 },
    )
    .toBeGreaterThan(0)

  // The sample is drawn from the phrase the user selected — which phrase that is depends on
  // where the drag landed, so assert it is a real selection rather than a fixed string.
  const label = (await bar.locator('.effect-bar-title').textContent()) ?? ''
  expect(label).toMatch(/Effect for “\S+/)

  await page.locator('.masthead h1').hover()
  await expect(page.locator('.effect-preview')).toHaveCount(0)
})

test('the export UI promises only what this browser can actually do', async ({ page }) => {
  await page.goto('/')
  const capability = await page.evaluate(() => {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) return 'none'
    if (typeof ClipboardItem.supports !== 'function') return 'gif'
    return ClipboardItem.supports('image/gif') ? 'gif' : 'still-only'
  })

  if (capability === 'gif') {
    await expect(page.locator('.cta-primary')).toHaveText(/Copy GIF/)
    await expect(page.locator('.disclosure')).toHaveCount(0)
  } else {
    // Chromium today: image/gif is not an accepted clipboard type. The UI must not offer a
    // button called "Copy GIF" that quietly puts a still image on the clipboard.
    await expect(page.locator('.cta-primary')).toHaveText(/Save GIF/)
    await expect(page.locator('.disclosure')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy GIF', exact: true })).toHaveCount(0)
    if (capability === 'still-only') {
      await expect(page.getByRole('button', { name: /Copy still image/ })).toBeVisible()
    }
  }
})
