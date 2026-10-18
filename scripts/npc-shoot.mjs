// Headless end-to-end check for people (NPC): build a lake village, spawn people by typing to the genie,
// walk up to one and say hello (calm mode: they never speak first), talk by typing, give world commands mid-conversation, walk away and
// come back, and tell the whole town to wave and dance. Logs every [npc] line and the timings; PNGs to --out.
// Usage: node scripts/npc-shoot.mjs [--url http://localhost:3091/] [--out dir] [--gpu]
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const url = opt('--url', 'http://localhost:3091/')
const outDir = resolve(opt('--out', resolve(tmpdir(), 'conjure-npc-shots')))
const width = 1440
const height = 900
mkdirSync(outDir, { recursive: true })

const gl = args.includes('--gpu')
  ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
const browser = await chromium.launch({ headless: true, args: [...gl, '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
const log = []
page.on('console', (m) => {
  const t = m.text()
  if (t.startsWith('[npc]') || t.startsWith('[intent]')) {
    log.push(t)
    console.log('  ', t.slice(0, 260))
  } else if (m.type() === 'error') console.log('[browser error]', t.slice(0, 300))
})
page.on('pageerror', e => console.log('[pageerror]', e.message))

const wait = ms => page.waitForTimeout(ms)
const shots = []
const shot = async (label) => {
  const out = resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}_${label}.png`)
  await page.screenshot({ path: out })
  shots.push(out)
  console.log('shot', out)
}
const npc = (fn, arg) => page.evaluate(([f, a]) => window.__conjureNpc[f](a), [fn, arg])
const people = () => npc('people')
const look = (yaw, pitch, pos) => page.evaluate(([y, p, q]) => window.__conjure.look(y, p, q), [yaw, pitch, pos])

/** Type into the real text field (as a person would), press Enter. */
async function type(text) {
  await page.keyboard.press('Enter')
  await wait(150)
  await page.keyboard.type(text, { delay: 12 })
  await page.keyboard.press('Enter')
}
/** Wait for the genie's builder to finish (if the sentence went to it). */
async function genieDone(timeout = 30000) {
  await page.waitForFunction(() => window.__conjure.phase() === 'thinking', null, { timeout: 2500 }).catch(() => {})
  await page.waitForFunction(() => window.__conjure.phase() !== 'thinking', null, { timeout })
}
/** Wait for the person's reply to finish streaming. */
async function npcDone(before, timeout = 20000) {
  await page.waitForFunction(n => window.__conjureNpc.timings().length > n, before, { timeout })
  const t = await npc('timings')
  return t[t.length - 1]
}
/** Stand `d` m in front of a person and look at their face. */
async function faceOf(name, d = 2.6, side = 0) {
  const ps = await people()
  const p = ps.find(x => x.name === name)
  if (!p) throw new Error(`no ${name}`)
  const [x, , z] = p.pos
  // Stand at a spot d m from them (toward the origin, so we're on land), looking at them.
  const a = Math.atan2(-x, -z) + side
  const sx = x + Math.sin(a) * d
  const sz = z + Math.cos(a) * d
  const yaw = Math.atan2(-(x - sx), -(z - sz))
  await look(yaw, -0.08, [sx, sz])
  return p
}

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true && !!window.__conjureNpc, null, { timeout: 60000 })
await page.evaluate(() => document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-anchor, [id^="nuxt-devtools"]').forEach(e => e.remove()))
await page.evaluate(() => {
  localStorage.removeItem('conjure:npc:v1')
  window.__conjure.clear()
})
await look(0, -0.1, [0, 0])
// A lake village at golden hour: water ahead, a dock running out into it, a boat, pines, cottages, a fire.
await page.evaluate(() => window.__conjure.run({ ops: [
  { op: 'atmosphere', time: 'golden' },
  { op: 'spawn', kind: 'water', at: { anchor: 'player', dir: 'ahead', dist: 34 }, set: { length: 44, width: 36 } },
  { op: 'spawn', kind: 'dock', at: { anchor: 'player', dir: 'ahead', dist: 13 }, facing: 'player', set: { length: 12 } },
  { op: 'spawn', kind: 'boat', at: { anchor: 'player', dir: 'ahead', dist: 17 } },
  { op: 'spawn', kind: 'house', count: 3, arrange: 'line', at: { anchor: 'player', dir: 'left', dist: 14 } },
  { op: 'spawn', kind: 'pine', count: 10, arrange: 'scatter', radius: 10, at: { anchor: 'player', dir: 'right', dist: 18 } },
  { op: 'spawn', kind: 'campfire', at: { anchor: 'player', dir: 'right', dist: 6 } },
  { op: 'spawn', kind: 'bench', at: { anchor: 'player', dir: 'right', dist: 8 } }
] }, 'a lake village'))
await wait(2500)

// 1. People through the genie, typed.
const timings = {}
let t0 = Date.now()
await type('put a fisherman on the dock')
await genieDone()
timings.spawnFisherman = Date.now() - t0
await wait(1200)
await look(0, -0.12, [0, 0])
await wait(1500)
await shot('fisherman_on_dock')
await type('a few villagers by the houses')
await genieDone()
await wait(2500)
await look(0.8, -0.1, [0, 0])
await wait(800)
await shot('villagers')
let ps = await people()
console.log('people:', ps.map(p => `${p.name} ${p.mode} "${p.doing}" @${p.pos.join(',')}`).join(' | '))

// Personas land in the background.
await page.waitForFunction(() => window.__conjureNpc.people().every(p => window.__conjureNpc.mind(p.id)?.personaState !== 'pending'), null, { timeout: 20000 }).catch(() => console.log('personas still pending'))
const fisher = await page.evaluate(() => window.__conjure.state().entities.find(e => e.props.role === 'fisherman')?.props.name)
console.log('fisherman is', fisher)
const persona = await npc('mind', ps.find(p => p.name === fisher)?.id)
console.log('persona:', JSON.stringify(persona?.persona).slice(0, 600))

// 2. Walk up, look, and say hello (calm mode: they glance up but never speak first).
let n = (await npc('timings')).length
await faceOf(fisher, 2.6)
await wait(1500)
await type('Hello there.')
const greet = await npcDone(n, 15000).catch(() => null)
console.log('greet:', JSON.stringify(greet))
await wait(600)
await shot('greeting')

// 3. Talk by typing.
n = (await npc('timings')).length
await type('What can you tell me about this lake?')
const r1 = await npcDone(n)
console.log('route:', JSON.stringify(await page.evaluate(() => window.__conjureNpc.route('What can you tell me about this lake?'))))
console.log('talk1:', JSON.stringify(r1))
await wait(400)
await shot('talk_lake')

// 4. A world command while facing him goes to the genie; he sees it happen.
await type('a thunderstorm')
await genieDone()
await wait(3000)
await shot('storm_reaction')
n = (await npc('timings')).length
await type('Did that storm scare you?')
const r2 = await npcDone(n)
console.log('talk2 (storm memory):', JSON.stringify(r2))

// 5. Ask him to come along: he follows.
n = (await npc('timings')).length
await type('Come with me, I want to show you something.')
const r3 = await npcDone(n)
console.log('talk3 (follow):', JSON.stringify(r3))
await wait(1500)
ps = await people()
console.log('following?', ps.find(p => p.name === fisher)?.following, ps.find(p => p.name === fisher)?.mode)
if (!ps.find(p => p.name === fisher)?.following) {
  // They said no (in character): the genie can insist.
  await type(`make ${fisher} follow me`)
  await genieDone()
  await wait(800)
  console.log('following after the genie?', (await people()).find(p => p.name === fisher)?.following)
}
// Walk a few metres toward the fire, then turn back to see him behind you.
await look(-1.2, -0.1, [-4, 2])
await wait(6000)
await look(-1.2 + Math.PI * 0.75, -0.1, [-4, 2])
await wait(1200)
await shot('following')
n = (await npc('timings')).length
console.log('route (stay):', JSON.stringify(await page.evaluate(() => window.__conjureNpc.route('Thanks. You can go back to fishing now.'))))
await type('Thanks. You can go back to fishing now.')
const r4 = await npcDone(n)
console.log('talk4 (stay):', JSON.stringify(r4))

// 6. Walk away: the conversation ends. Come back later: he remembers.
await look(Math.PI / 2, -0.1, [-22, 6])
await wait(4000)
console.log('conversation after walking away:', await npc('conversation'))
await page.evaluate((name) => {
  const p = window.__conjureNpc.people().find(x => x.name === name)
  const m = p && window.__conjureNpc.mind(p.id)
  if (m) m.memory.lastTalkAt = 0
}, fisher)
n = (await npc('timings')).length
await faceOf(fisher, 2.4)
await wait(800)
await type('Remember me?')
const back = await npcDone(n, 15000).catch(() => null)
console.log('greet on return:', JSON.stringify(back))
await wait(500)
await shot('return_greeting')

// 7. The genie tells the whole town what to do.
await look(0.3, -0.12, [2, 8])
await wait(500)
await type('make everyone wave at me')
await genieDone()
await wait(900)
console.log('waving:', JSON.stringify((await people()).map(p => `${p.name}:${p.mode}:${p.gesture}:${p.wave}`)))
await shot('everyone_waves')
await type('make them all dance')
await genieDone()
await wait(2000)
console.log('dancing:', JSON.stringify((await people()).map(p => `${p.name}:${p.mode}:${p.dance}`)))
await shot('everyone_dances')
await type('make them stop dancing')
await genieDone()

// 8. "give her a dog", looking at a villager.
const villager = (await page.evaluate(() => window.__conjure.state().entities.filter(e => e.kind === 'person' && e.props.role !== 'fisherman').map(e => e.props.name)))[0]
await faceOf(villager, 3.5)
await wait(800)
await type('give her a dog')
await genieDone()
await wait(2000)
await shot('dog')

const state = await page.evaluate(() => window.__conjure.state().entities.filter(e => e.kind === 'person' || e.kind === 'dog').map(e => `${e.kind}:${e.props.name ?? ''}:${e.props.role ?? ''}:${e.props.act ?? ''}`))
console.log('final:', state.join(' | '))
const all = await npc('timings')
writeFileSync(resolve(outDir, 'timings.json'), JSON.stringify({ timings, npc: all, log }, null, 2))
console.log('npc timings:', all.map(t => `${t.name} text ${t.firstTextMs} audio ${t.firstAudioMs} done ${t.doneMs}`).join('\n'))
await browser.close()
