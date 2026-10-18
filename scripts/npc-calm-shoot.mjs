// Headless check for calm mode: spawn villagers, stand right next to them for 20 s (expect no speech and
// no approach), then talk: ask one to follow and one to go somewhere (expect both to comply), then wish a
// dragon (expect at most one short line from one person). Prints PASS/FAIL lines; PNGs to --out.
// Usage: node scripts/npc-calm-shoot.mjs [--url http://localhost:3091/] [--out dir] [--gpu]
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
const outDir = resolve(opt('--out', resolve(tmpdir(), 'voice-world-npc-calm')))
mkdirSync(outDir, { recursive: true })
const gl = args.includes('--gpu')
  ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
const browser = await chromium.launch({ headless: true, args: [...gl, '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const log = []
const voice = []
page.on('console', (m) => {
  const t = m.text()
  if (t.startsWith('[npc]') || t.startsWith('[intent]')) {
    log.push({ t, at: Date.now() })
    console.log('  ', t.slice(0, 240))
  } else if (m.type() === 'error') console.log('[browser error]', t.slice(0, 300))
})
page.on('request', (r) => {
  if (r.url().includes('/api/npc/voice') || r.url().includes('/api/npc/banter')) voice.push({ url: r.url(), at: Date.now() })
})
page.on('pageerror', e => console.log('[pageerror]', e.message))

const wait = ms => page.waitForTimeout(ms)
let shotN = 0
const shot = label => page.screenshot({ path: resolve(outDir, `${String(++shotN).padStart(2, '0')}_${label}.png`) })
const npc = (fn, arg) => page.evaluate(([f, a]) => window.__voiceWorldNpc[f](a), [fn, arg])
const people = () => npc('people')
const look = (yaw, pitch, pos) => page.evaluate(([y, p, q]) => window.__voiceWorld.look(y, p, q), [yaw, pitch, pos])
const results = []
const check = (ok, what) => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`)
}
async function type(text) {
  await page.keyboard.press('Enter')
  await wait(150)
  await page.keyboard.type(text, { delay: 10 })
  await page.keyboard.press('Enter')
}
async function genieDone(timeout = 30000) {
  await page.waitForFunction(() => window.__voiceWorld.phase() === 'thinking', null, { timeout: 2500 }).catch(() => {})
  await page.waitForFunction(() => window.__voiceWorld.phase() !== 'thinking', null, { timeout })
}
async function npcDone(before, timeout = 20000) {
  await page.waitForFunction(n => window.__voiceWorldNpc.timings().length > n, before, { timeout })
  const t = await npc('timings')
  return t[t.length - 1]
}
async function faceOf(name, d = 2.2) {
  const p = (await people()).find(x => x.name === name)
  const [x, , z] = p.pos
  const a = Math.atan2(-x, -z)
  const sx = x + Math.sin(a) * d
  const sz = z + Math.cos(a) * d
  await look(Math.atan2(-(x - sx), -(z - sz)), -0.08, [sx, sz])
  return [sx, sz]
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true && !!window.__voiceWorldNpc, null, { timeout: 60000 })
await page.evaluate(() => {
  document.querySelectorAll('[id^="nuxt-devtools"], nuxt-devtools-anchor').forEach(e => e.remove())
  localStorage.removeItem('voice-world:npc:v1')
  window.__voiceWorld.clear()
})
await look(0, -0.1, [0, 0])
await page.evaluate(() => window.__voiceWorld.run({ ops: [
  { op: 'atmosphere', time: 'day' },
  { op: 'spawn', kind: 'house', count: 3, arrange: 'line', at: { anchor: 'player', dir: 'ahead', dist: 14 } },
  { op: 'spawn', kind: 'well', at: { anchor: 'player', dir: 'right', dist: 10 } },
  { op: 'spawn', kind: 'bench', at: { anchor: 'player', dir: 'left', dist: 8 } }
] }, 'a hamlet'))
await wait(1500)

// 1. Villagers through the genie.
await type('three villagers in front of me')
await genieDone()
await page.waitForFunction(() => window.__voiceWorldNpc.people().length >= 3, null, { timeout: 10000 })
await page.waitForFunction(() => window.__voiceWorldNpc.people().every(p => window.__voiceWorldNpc.mind(p.id)?.personaState !== 'pending'), null, { timeout: 20000 }).catch(() => console.log('personas still pending'))
let ps = await people()
const [a, b] = ps
console.log('people:', ps.map(p => `${p.name} ${p.mode} "${p.doing}" @${p.pos.join(',')}`).join(' | '))

// 2. Stand right next to one, looking at them, for 20 s: nobody speaks or walks over.
const me = await faceOf(a.name, 2.2)
const dist0 = ps.map(p => Math.hypot(p.pos[0] - me[0], p.pos[2] - me[1]))
const tl = (await npc('timings')).length
const v0 = voice.length
const t0 = Date.now()
let closest = Infinity
while (Date.now() - t0 < 20000) {
  await wait(1000)
  const now = await people()
  for (const p of now) closest = Math.min(closest, Math.hypot(p.pos[0] - me[0], p.pos[2] - me[1]))
}
await shot('standing_close')
ps = await people()
const dist1 = ps.map(p => Math.hypot(p.pos[0] - me[0], p.pos[2] - me[1]))
const bubbles = [await npc('bubble'), await npc('sideBubble')].filter(Boolean)
check((await npc('timings')).length === tl && voice.length === v0 && !bubbles.length, `20 s standing close: no unprompted speech (talks ${(await npc('timings')).length - tl}, voice/banter calls ${voice.length - v0}, bubbles ${bubbles.length})`)
check(ps.every((p, i) => dist1[i] >= Math.min(dist0[i], 2) - 0.6), `no approach: distances ${dist0.map(d => d.toFixed(1)).join('/')} → ${dist1.map(d => d.toFixed(1)).join('/')} (closest ${closest.toFixed(1)})`)

// 3. Talk: a question, then ask A to follow.
await faceOf(a.name, 2.2)
await wait(500)
let n = (await npc('timings')).length
await type(`${a.name}, what are you up to today?`)
const r1 = await npcDone(n)
console.log('talk1:', r1.name, `“${r1.say}”`, `${r1.firstTextMs} ms`)
n = (await npc('timings')).length
await type('Come with me for a bit.')
const r2 = await npcDone(n)
console.log('talk2:', r2.name, `“${r2.say}”`, JSON.stringify(r2.actions))
await wait(1200)
check(!!(await people()).find(p => p.id === a.id)?.following, `${a.name} follows when asked`)
await look(-1.4, -0.1, [-4, 2])
await wait(5000)
const fa = (await people()).find(p => p.id === a.id)
check(Math.hypot(fa.pos[0] + 4, fa.pos[2] - 2) < 5, `${a.name} kept up (${Math.hypot(fa.pos[0] + 4, fa.pos[2] - 2).toFixed(1)} m behind)`)
await shot('following')
n = (await npc('timings')).length
await type(`${a.name}, thanks, you can go back now.`)
await npcDone(n)

// 4. Ask B to go somewhere.
await faceOf(b.name, 2.4)
await wait(600)
const wellPos = await page.evaluate(() => window.__voiceWorld.state().entities.find(e => e.kind === 'well').pos)
const before = Math.hypot(b.pos[0] - wellPos[0], b.pos[2] - wellPos[2])
n = (await npc('timings')).length
await type(`${b.name}, could you go and wait by the well for me?`)
const r3 = await npcDone(n)
console.log('talk3:', r3.name, `“${r3.say}”`, JSON.stringify(r3.actions))
await wait(12000)
const pb = (await people()).find(p => p.id === b.id)
const after = Math.hypot(pb.pos[0] - wellPos[0], pb.pos[2] - wellPos[2])
check(r3.actions.some(x => x.act === 'walk_to') && after < Math.min(before, 3.5), `${b.name} went to the well (${before.toFixed(1)} → ${after.toFixed(1)} m)`)
await shot('went_to_well')

// 5. A dragon: at most one short line from one person.
// Step back so the conversation ends (a wish line never interrupts one), with the others still close by.
await look(0, 0.1, [0, 4])
await page.waitForFunction(() => !window.__voiceWorldNpc.conversation(), null, { timeout: 15000 }).catch(() => console.log('conversation still open'))
await wait(3000) // let the last reply's bubble go
const vb = voice.filter(v => v.url.includes('banter')).length
const lb = (await npc('banterLog')).length
const tl2 = (await npc('timings')).length
await type('make a dragon circle overhead')
await genieDone()
await wait(9000)
await shot('dragon')
console.log('dragons:', await page.evaluate(() => window.__voiceWorld.state().entities.filter(e => e.kind === 'dragon').length))
const lines = (await npc('banterLog')).slice(lb).flatMap(x => x.lines)
console.log('wish lines:', JSON.stringify(lines))
check(voice.filter(v => v.url.includes('banter')).length - vb <= 1 && lines.length <= 1 && lines.every(l => l.line.split(/\s+/).length <= 12) && (await npc('timings')).length === tl2, `dragon: ${lines.length} line(s), no chorus`)

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed · shots in ${outDir}`)
await browser.close()
