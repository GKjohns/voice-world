// Headless realtime-voice check (Sprint 3): Chromium with a fake mic that plays a wav, against the running
// dev server. Clicks the mic, screenshots each pill state the first time it appears, turns the camera away
// right after speech starts (so "there" must resolve to the speech-start snapshot, not the live gaze), and
// then forces the token route to fail to shoot the browser-speech fallback.
// Usage: node scripts/voice-shoot.mjs [--wav bench/fixtures/session.wav] [--url http://localhost:3091/] [--out dir]
// PNGs go to --out (default: OS temp); convert keepers to .webp by hand.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const url = opt('--url', 'http://localhost:3091/')
const wav = resolve(opt('--wav', 'bench/fixtures/session.wav'))
const outDir = resolve(opt('--out', resolve(tmpdir(), 'conjure-voice-shots')))
const width = 1440
const height = 900
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`,
    '--autoplay-policy=no-user-gesture-required'
  ]
})
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, permissions: ['microphone'] })
const page = await context.newPage()
const voiceLog = []
page.on('console', (m) => {
  const t = m.text()
  if (t.startsWith('[voice]')) voiceLog.push(t)
  if (m.type() === 'error' || m.type() === 'warning' || t.startsWith('[voice]')) console.log('[browser]', m.type(), t)
})
page.on('pageerror', e => console.log('[pageerror]', e.message))

const shots = []
const shot = async (label) => {
  const out = resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}_${label}.png`)
  await page.screenshot({ path: out })
  shots.push(out)
  console.log(out)
}
const wait = ms => page.waitForTimeout(ms)
const phase = () => page.evaluate(() => document.querySelector('[data-pill]')?.getAttribute('data-phase'))

async function open() {
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 })
  await page.evaluate(() => document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-anchor, [id^="nuxt-devtools"]').forEach(e => e.remove()))
  await page.evaluate(() => window.__conjure.clear())
  await page.evaluate(() => window.__conjure.look(0.5, -0.16, [0, 0]))
  await page.mouse.move(width / 2, height / 2 - 120)
  await wait(400)
}

// ---------- run 1: realtime voice ----------
await open()
await page.click('[data-mic]')
await page.mouse.move(width / 2, height / 2 - 120)
const seen = new Set()
let snapshot = null
let liveGazeAfterTurn = null
const started = Date.now()
const wanted = ['connecting', 'listening', 'hearing', 'thinking', 'building', 'speaking']
while (Date.now() - started < 40000) {
  const p = await phase()
  if (p && !seen.has(p) && wanted.includes(p)) {
    seen.add(p)
    if (p === 'hearing' && !snapshot) {
      snapshot = await page.evaluate(() => window.__conjureVoice.snapshot())
      await shot(`voice_${p}`)
      // Turn away mid-sentence: the build must still land where we were looking at speech start.
      await page.evaluate(() => window.__conjure.look(-1.1, -0.16))
      await wait(150)
      liveGazeAfterTurn = await page.evaluate(() => window.__conjureVoice.snapshot())
    } else {
      await shot(`voice_${p}`)
    }
  }
  const calls = await page.evaluate(() => window.__conjureVoice.toolCalls())
  if (calls >= 2 && p === 'listening' && Date.now() - started > 22000) break
  await wait(80)
}
await wait(600)
await shot('voice_after')
const result = await page.evaluate(() => {
  const s = window.__conjure.state()
  const by = {}
  for (const e of s.entities) by[e.kind] = (by[e.kind] || 0) + 1
  const pines = s.entities.filter(e => e.tags.includes('tree'))
  const c = pines.length ? [pines.reduce((a, e) => a + e.pos[0], 0) / pines.length, pines.reduce((a, e) => a + e.pos[2], 0) / pines.length] : null
  return {
    by,
    centroid: c,
    colors: [...new Set(pines.map(e => e.props.color ?? 'default'))],
    voice: { heard: window.__conjureVoice.heard(), said: window.__conjureVoice.said(), timing: window.__conjureVoice.timing(), toolCalls: window.__conjureVoice.toolCalls(), error: window.__conjureVoice.error() },
    log: window.__conjure.lastEntry()
  }
})
console.log(JSON.stringify({ seen: [...seen], snapshot, result }, null, 1))
if (snapshot && result.centroid) {
  const d = Math.hypot(result.centroid[0] - snapshot[0], result.centroid[1] - snapshot[2])
  console.log(`deixis: speech-start gaze (${snapshot[0].toFixed(1)}, ${snapshot[2].toFixed(1)}) → tree centroid (${result.centroid[0].toFixed(1)}, ${result.centroid[1].toFixed(1)}), ${d.toFixed(1)} m apart`)
}
void liveGazeAfterTurn
await page.click('[data-mic]')
await wait(300)

// ---------- run 2: token route fails → browser-speech fallback with a toast ----------
await page.route('**/api/realtime/token', r => r.fulfill({ status: 502, body: '{"statusMessage":"forced failure"}', contentType: 'application/json' }))
await open()
await page.click('[data-mic]')
await page.mouse.move(width / 2, height / 2 - 120)
await page.waitForSelector('[data-mic-mode="browser"]', { timeout: 15000 }).catch(() => console.log('fallback: browser mic never engaged'))
await wait(700)
await shot('voice_fallback')
console.log('fallback mode:', await page.evaluate(() => document.querySelector('[data-mic]')?.getAttribute('data-mic-mode')))
console.log('voice log:\n' + voiceLog.join('\n'))
await browser.close()
