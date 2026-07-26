// Regenerates ../samples/ by driving the real app in a real browser — same path a user
// takes (paste text -> Save GIF), no synthetic rendering and no hand-editing. Run it after
// any change to the render or export pipeline so the showcase never advertises behaviour the
// code no longer has:
//
//   npm run samples
//
// Writes samples/*.gif and samples/README.md, with the measurements taken from the files it
// just produced.

import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const APP = path.resolve(HERE, '..')
const SAMPLES = path.resolve(APP, '..', 'samples')
const PORT = 4179
const ORIGIN = `http://127.0.0.1:${PORT}`

/** Each sample is a real use case, not a preset showroom — the app picks emphasis itself. */
const SAMPLES_SPEC = [
  {
    file: '01-card-thank-you.gif',
    title: 'Short note (Card)',
    text: 'Thank you for the *great work* today!',
  },
  {
    file: '02-paragraph-launch-recap.gif',
    title: 'Paragraph with markup and a date',
    text:
      'We announced [[three major updates]] and shared a live demo with over 200 attendees on July 12, 2026. ' +
      'Get started with the new dashboard today.',
  },
  {
    file: '03-story-quarter-recap.gif',
    title: 'Multi-paragraph email, fitted to one frame',
    text:
      'Team, thank you for an extraordinary quarter.\n\n' +
      'We announced [[three major updates]], shipped a completely redesigned onboarding flow, and shared a live demo with over 200 attendees on July 12, 2026.\n\n' +
      'One customer told us "this is exactly what we needed" — and that stuck with the whole team.\n\n' +
      'Get started with the new dashboard today.',
  },
  {
    file: '04-cyrillic-and-emoji.gif',
    title: 'Non-Latin script and emoji',
    text: 'Спасибо за [[отличную работу]] сегодня 🎉 — встречаемся 12 августа 2026 года.',
  },
]

function startPreview() {
  const child = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: APP,
    stdio: 'ignore',
  })
  return child
}

async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`preview server never came up at ${url}`)
}

async function main() {
  const build = spawn('npm', ['run', 'build'], { cwd: APP, stdio: 'inherit' })
  await new Promise((resolve, reject) =>
    build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build failed (${code})`)))),
  )

  const server = startPreview()
  const browser = await chromium.launch()
  const rows = []

  try {
    await waitForServer(ORIGIN)
    await rm(SAMPLES, { recursive: true, force: true })
    await mkdir(SAMPLES, { recursive: true })

    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
    await page.goto(ORIGIN)

    for (const sample of SAMPLES_SPEC) {
      await page.locator('#source-text').fill(sample.text)
      await page.waitForTimeout(900) // debounced rebuild

      const meta = await page.locator('.frame-meta').textContent()
      const [, width, height, font] = meta.match(/(\d+) × (\d+) · (\d+)px/)

      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 60_000 }),
        page.getByRole('button', { name: /Save GIF/ }).click(),
      ])
      const target = path.join(SAMPLES, sample.file)
      await download.saveAs(target)

      const bytes = await readFile(target)
      if (bytes.subarray(0, 6).toString('latin1') !== 'GIF89a') {
        throw new Error(`${sample.file} is not a valid GIF89a`)
      }

      // Measure the produced file rather than assuming: frame count and duration come from
      // decoding it back, so the table below can never drift from reality.
      const measured = await page.evaluate(async (data) => {
        const dec = new ImageDecoder({ data: new Uint8Array(data), type: 'image/gif' })
        await dec.tracks.ready
        await dec.completed
        const frameCount = dec.tracks.selectedTrack.frameCount
        const { image } = await dec.decode({ frameIndex: 0 })
        return { frameCount, frameMs: image.duration / 1000 }
      }, [...bytes])

      rows.push({
        ...sample,
        width: Number(width),
        height: Number(height),
        font: Number(font),
        kb: (bytes.byteLength / 1024).toFixed(0),
        frames: measured.frameCount,
        seconds: ((measured.frameCount * measured.frameMs) / 1000).toFixed(1),
      })
      process.stdout.write(`  ✓ ${sample.file} (${rows.at(-1).kb} KB, ${measured.frameCount} frames)\n`)
    }

    await writeFile(path.join(SAMPLES, 'README.md'), renderReadme(rows))
  } finally {
    await browser.close()
    server.kill()
  }
}

function renderReadme(rows) {
  return `# Sample output

Generated by \`npm run samples\` (from \`app/\`), which drives the real app in a real browser —
paste text, press **Save GIF** — and writes whatever the app produced. Nothing here is
hand-picked, hand-edited, or rendered by a separate script, and the table is measured from
the files themselves by decoding them back.

Every sample is one frame containing the whole text, per
[[DEC-011-output-quality-and-one-frame]]: the frame grows to fit and the type only shrinks
once it hits the height ceiling. Rendering is supersampled 2× and encoded at a true 20fps
(50ms per frame) with one shared palette and inter-frame differencing.

| File | What it shows | Frame | Type | Frames | Duration | Size |
|---|---|---|---|---|---|---|
${rows
  .map(
    (r) =>
      `| \`${r.file}\` | ${r.title} | ${r.width}×${r.height} | ${r.font}px | ${r.frames} | ${r.seconds}s | ${r.kb} KB |`,
  )
  .join('\n')}

Regenerate after any render or export change:

\`\`\`bash
cd app && npm run samples
\`\`\`
`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
