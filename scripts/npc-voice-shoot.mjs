// Headless voice pass for people (NPC): a fake mic plays a wav (three lines, ~10 s apart) while the camera
// faces a person. The first two lines must reach the person (their bubble and voice, the genie silent);
// "Genie, make it night" must reach the genie. Logs [voice] and [npc] lines; PNGs to --out.
// Usage: node scripts/npc-voice-shoot.mjs --wav path.wav [--url http://localhost:3091/] [--out dir] [--gpu]
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
const wav = resolve(opt('--wav', 'bench/fixtures/npc_session.wav'))
const outDir = resolve(opt('--out', resolve(tmpdir(), 'voice-world-npc-voice')))
mkdirSync(outDir, { recursive: true })
const gl = args.includes('--gpu') ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
const browser = await chromium.launch({
  headless: true,
  args: [...gl, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}%noloop`, '--autoplay-policy=no-user-gesture-required']
})
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ['microphone'] })
const page = await context.newPage()
page.on('console', (m) => {
  const t = m.text()
  if (t.startsWith('[voice]') || t.startsWith('[npc]') || t.startsWith('[intent]')) console.log('  ', t.slice(0, 240))
  else if (m.type() === 'error') console.log('[browser error]', t.slice(0, 240))
})
page.on('pageerror', e => console.log('[pageerror]', e.message))
const wait = ms => page.waitForTimeout(ms)
let k = 0
const shot = async (label) => {
  const out = resolve(outDir, `${String(++k).padStart(2, '0')}_${label}.png`)
  await page.screenshot({ path: out })
  console.log('shot', out)
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true && !!window.__voiceWorldNpc, null, { timeout: 60000 })
await page.evaluate(() => {
  localStorage.removeItem('voice-world:npc:v1')
  window.__voiceWorld.clear()
  window.__voiceWorld.look(0, -0.08, [0, 0])
  window.__voiceWorld.run({ ops: [
    { op: 'atmosphere', time: 'golden' },
    { op: 'spawn', kind: 'water', at: { anchor: 'player', dir: 'ahead', dist: 30 }, set: { length: 40, width: 30 } },
    { op: 'spawn', kind: 'dock', at: { anchor: 'player', dir: 'ahead', dist: 12 }, facing: 'player' },
    { op: 'spawn', kind: 'person', at: { anchor: 'player', dir: 'ahead', dist: 2.8 }, facing: 'player', set: { role: 'fisherman', name: 'Tomas', act: 'sit' } }
  ] }, 'a fisherman by the lake')
})
// Let his persona land and the greeting (if any) play out before the mic opens.
await page.waitForFunction(() => window.__voiceWorldNpc.people().every(p => window.__voiceWorldNpc.mind(p.id)?.personaState === 'ready'), null, { timeout: 20000 }).catch(() => {})
await wait(6000)
const before = (await page.evaluate(() => window.__voiceWorldNpc.timings())).length
await page.click('[data-mic]')
const t0 = Date.now()
let shots = 0
while (Date.now() - t0 < 46000) {
  await wait(500)
  const b = await page.evaluate(() => window.__voiceWorldNpc.bubble())
  if (b && !b.thinking && b.text && shots < 3 && Date.now() - t0 > 6000 * (shots + 1)) {
    await shot(`voice_npc_${shots + 1}`)
    shots++
  }
}
await shot('voice_after')
const res = await page.evaluate(() => ({
  npc: window.__voiceWorldNpc.timings(),
  heard: window.__voiceWorldVoice.heard(),
  said: window.__voiceWorldVoice.said(),
  toolCalls: window.__voiceWorldVoice.toolCalls(),
  time: window.__voiceWorld.state().atmosphere.time
}))
console.log(JSON.stringify({ ...res, npc: res.npc.slice(before) }, null, 1))
await browser.close()
