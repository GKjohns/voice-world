// The gauntlet: what real people try once they learn they're a god with a genie. Headless Chromium on the
// real GPU against the running dev server, driven the way a person would drive it: typed sentences in the HUD
// field (the same router a typed wish takes, so a person you face can answer), held walk keys and mouse drags.
//
// Usage: node scripts/gauntlet.mjs [--out dir] [--only id,group,...] [--url http://localhost:3091/]
//                                  [--max-usd 2.5] [--w 1280 --h 800] [--settle 2500] [--list]
//   --only   comma list; a scenario runs if its id or group starts with any entry (e.g. "teleport,phys_drop")
//   --list   print the scenarios and exit
// Every scenario starts from a real reset at the start view. Each step: type → wait for the intent model →
// wait for a Director build (teleports) and for forge refines (novel objects; polish is not waited for) →
// settle → a JPEG of exactly what the player sees. results.json logs ops, timings, fps, spend and errors.
// Scenario text mirrors internal_docs/20261017_gauntlet/gauntlet.md: keep the two in sync.
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

// A step is a sentence, or { say?, keys?: 'w'|'a'|'s'|'d'|'shift+w', ms?, drag?: [dx, dy], look?: [yaw, pitch], wait?, settle?, shot? }.
export const SCENARIOS = [
  // ---- creation of novel objects ----
  { id: 'create_robot', group: 'create', steps: ['put a giant friendly robot over there'] },
  { id: 'create_piano', group: 'create', steps: ['a grand piano right in front of me'] },
  { id: 'create_pancakes', group: 'create', steps: ['a stack of pancakes the size of a car, with syrup dripping down'] },
  // ---- quantities and sets ----
  { id: 'sets_sunflowers', group: 'sets', steps: ['plant a whole field of sunflowers'] },
  { id: 'sets_stones', group: 'sets', steps: ['a circle of standing stones around me'] },
  // ---- edits to existing things ----
  { id: 'edit_cabin', group: 'edit', steps: ['build a little log cabin', 'paint it blue', 'make it three times bigger', 'make it glow'] },
  { id: 'edit_selective', group: 'edit', steps: ['some trees and a few big rocks', 'make only the rocks gold', 'get rid of the trees'] },
  // ---- scale and god powers ----
  { id: 'god_giant', group: 'god', steps: ['a little village', 'make me a giant'] },
  { id: 'god_tiny', group: 'god', steps: ['a picnic blanket with some food on it', 'shrink me to the size of an ant'] },
  { id: 'god_volcano', group: 'god', steps: ['raise a volcano over there and make it erupt'] },
  // ---- landscapes and terraforming ----
  { id: 'land_canyon', group: 'land', steps: ['carve a deep canyon with a river running through it'] },
  { id: 'land_islands', group: 'land', steps: ['turn all of this into an ocean with little islands'] },
  // ---- teleports ----
  { id: 'tp_spaceship', group: 'teleport', steps: ['take me to the bridge of a spaceship'] },
  { id: 'tp_underwater', group: 'teleport', steps: ['take me to the bottom of the ocean'] },
  { id: 'tp_castle', group: 'teleport', steps: ['take me to a medieval castle courtyard'] },
  { id: 'tp_rome', group: 'teleport', steps: ['take me to ancient Rome'] },
  { id: 'tp_laundromat', group: 'teleport', steps: ['put me in a laundromat at 2am'] },
  { id: 'tp_skyisland', group: 'teleport', steps: ['a floating island in the clouds with waterfalls pouring off the edges'] },
  // ---- weather, time, sky spectacle ----
  { id: 'sky_aurora', group: 'sky', steps: ['make it night with the northern lights'] },
  { id: 'sky_two_moons', group: 'sky', steps: ['turn the sky purple and give it two moons'] },
  { id: 'sky_blizzard', group: 'sky', steps: ['some pine trees', 'now a blizzard'] },
  // ---- creatures and motion ----
  { id: 'life_birds', group: 'life', steps: ['a flock of birds circling overhead'] },
  { id: 'life_octopus', group: 'life', steps: ['a giant octopus crawling across the field'] },
  { id: 'life_dog', group: 'life', steps: ['a dog that follows me around', { keys: 'w', ms: 2500, shot: 'walked' }] },
  // ---- people ----
  { id: 'people_wizard', group: 'people', steps: ['put a wizard right in front of me', { say: 'hello! who are you?', talk: true }, { say: 'can you follow me?', talk: true }, { keys: 'w', ms: 2500, shot: 'walked' }] },
  { id: 'people_dance', group: 'people', steps: ['a crowd of people dancing'] },
  // ---- chained multi-turn ----
  { id: 'chain_campsite', group: 'chain', steps: ['a campfire', 'put some tents around it', 'make it night', 'add fireflies', 'someone playing guitar by the fire'] },
  // ---- physics-ish ----
  { id: 'phys_drop', group: 'phys', steps: ['drop a piano from the sky'] },
  { id: 'phys_stack', group: 'phys', steps: ['stack five wooden crates on top of each other'] },
  { id: 'phys_gravity', group: 'phys', steps: ['a pile of beach balls', 'turn gravity off'] },
  { id: 'phys_throw', group: 'phys', steps: ['throw a ball as far as you can'] },
  // ---- navigation ----
  { id: 'nav_walk', group: 'nav', steps: ['a lighthouse over there', { keys: 'w', ms: 3000, shot: 'walk' }, { drag: [420, 0], shot: 'look_right' }, { keys: 'shift+w', ms: 2500, shot: 'run' }] },
  { id: 'nav_top', group: 'nav', steps: ['a really tall tower', 'take me to the top of it'] },
  { id: 'nav_fly', group: 'nav', steps: ['let me fly', { keys: 'w', ms: 3000, shot: 'fly_forward' }] },
  // ---- absurd and creative ----
  { id: 'absurd_cheese', group: 'absurd', steps: ['a castle made of cheese'] },
  { id: 'absurd_vangogh', group: 'absurd', steps: ['a few houses and trees', 'make everything look like a Van Gogh painting'] },
  { id: 'absurd_upside', group: 'absurd', steps: ['a big house', 'flip it upside down'] },
  // ---- failure and recovery ----
  { id: 'fail_undo', group: 'fail', steps: ['a bunch of houses', 'undo that'] },
  { id: 'fail_vague', group: 'fail', steps: ['do something cool'] },
  { id: 'fail_reset', group: 'fail', steps: ['a forest with a river', 'start over'] },
  { id: 'fail_nonsense', group: 'fail', steps: ['purple seven banana sideways'] }
]

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
if (args.includes('--list')) {
  for (const s of SCENARIOS) console.log(`${s.id.padEnd(18)} ${s.group.padEnd(9)} ${s.steps.map(x => typeof x === 'string' ? x : x.say ?? JSON.stringify(x)).join(' → ')}`)
  process.exit(0)
}
const outDir = resolve(opt('--out', resolve(tmpdir(), 'conjure-gauntlet')))
const url = opt('--url', 'http://localhost:3091/')
const only = opt('--only', '').split(',').map(s => s.trim()).filter(Boolean)
const maxUsd = Number(opt('--max-usd', 2.5))
const W = Number(opt('--w', 1280))
const H = Number(opt('--h', 800))
const SETTLE = Number(opt('--settle', 2500))
mkdirSync(outDir, { recursive: true })
const picked = SCENARIOS.filter(s => !only.length || only.some(o => s.id.startsWith(o) || s.group.startsWith(o)))

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })

// ---- logging: console errors, page errors, and every model dollar the server reports back ----
let errors = []
let spend = 0
const spendBy = {}
// The intent endpoint doesn't send its cost to the client: count calls and estimate (Haiku, cached digest ≈ $0.001).
const INTENT_USD = 0.001
const intentLog = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 400))
})
page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 400)}`))
page.on('response', async (r) => {
  const u = r.url()
  if (!u.includes('/api/') || u.includes('/api/forge/status') || u.includes('/api/forge/lib')) return
  try {
    const body = await r.text()
    if (u.includes('/api/intent')) {
      const done = body.split('\n').filter(Boolean).map(l => JSON.parse(l)).find(e => e.t === 'done')
      if (done) intentLog.push({ model: done.model, ms: done.ms, firstOpMs: done.firstOpMs, count: done.count, error: done.error })
      spend += INTENT_USD
      spendBy['/api/intent (est)'] = (spendBy['/api/intent (est)'] ?? 0) + INTENT_USD
      return
    }
    let usd = 0
    for (const m of body.matchAll(/"(?:costUsd|usd)":\s*([0-9.eE-]+)/g)) usd += Number(m[1]) || 0
    if (usd > 0) {
      const k = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
      spend += usd
      spendBy[k] = (spendBy[k] ?? 0) + usd
    }
  } catch {
    // Streams cut by a reload or an abort carry no cost line.
  }
})

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 })
await page.waitForFunction(() => !!globalThis.__kitWarmed, null, { timeout: 60000 }).catch(() => {})
await page.evaluate(() => document.querySelectorAll('[id^="nuxt-devtools"], nuxt-devtools-anchor').forEach(e => e.remove()))
// rAF tracer: every frame stamped with its gap.
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const tick = (t) => {
    window.__frames.push([t, t - last])
    if (window.__frames.length > 20000) window.__frames.splice(0, 5000)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const wait = ms => page.waitForTimeout(ms)
const now = () => page.evaluate(() => performance.now())
const fps = (a, b) => page.evaluate(([a, b]) => {
  const f = window.__frames.filter(([t]) => t >= a && t <= b)
  if (f.length < 2) return null
  const span = (f[f.length - 1][0] - f[0][0]) / 1000
  let min1 = Infinity
  for (let s = a; s + 1000 <= b; s += 250) min1 = Math.min(min1, f.filter(([t]) => t >= s && t < s + 1000).length)
  return { avg: Math.round(f.length / span), min1: min1 === Infinity ? null : min1, gap: Math.round(Math.max(...f.map(x => x[1]))) }
}, [a, b])
const pose = () => page.evaluate(() => {
  const r = window.__conjure.renderer()
  const p = r?.player()
  return { pos: p?.pos, yaw: p?.yaw, pitch: r ? Math.round(r.pitch * 100) / 100 : null }
})
const census = () => page.evaluate(() => {
  const s = window.__conjure.state()
  const by = {}
  for (const e of s.entities) by[e.kind] = (by[e.kind] || 0) + 1
  return { entities: s.entities.length, kinds: Object.keys(by).length, top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => `${k}×${n}`), time: s.atmosphere?.time, weather: s.atmosphere?.weather }
})
const hudText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300))
const opLabel = o => o.op === 'spawn' ? `spawn ${o.kind}×${o.count ?? 1}${o.motion ? `(${o.motion})` : ''}` : o.op === 'define' ? `define ${o.kind}(${o.parts?.length ?? 0})` : o.op === 'modify' ? `modify ${JSON.stringify(o.target ?? {})}→${JSON.stringify(o.set ?? {})}` : o.op === 'atmosphere' ? `atmosphere ${[o.time, o.weather, o.sky].filter(Boolean).join('/')}` : o.op === 'teleport' ? `teleport ${o.world}` : o.op === 'say' ? `say “${o.text}”` : o.op

let shotN = 0
async function shot(sid, label) {
  await page.mouse.move(W / 2, H / 2 - 160)
  const file = `${String(++shotN).padStart(3, '0')}_${sid}_${label}.jpg`
  await page.screenshot({ path: resolve(outDir, file), type: 'jpeg', quality: 82 })
  return file
}

async function blurField() {
  await page.evaluate(() => document.activeElement?.blur?.())
}

/** Type a sentence the way a person does: open the field, type, Enter. Then wait for everything it started. */
async function speak(text, settle) {
  const lastN = await page.evaluate(() => window.__conjure.lastEntry()?.n ?? 0)
  const forgeN = await page.evaluate(() => window.__forge?.log?.length ?? 0)
  const intentN = intentLog.length
  await blurField()
  await page.mouse.move(W / 2, H / 2 - 160)
  await page.keyboard.press('/')
  const field = page.locator('input[data-intent-input], [data-intent-input] input').first()
  await field.focus().catch(() => {})
  await page.keyboard.type(text, { delay: 12 })
  const t0 = await now()
  await page.keyboard.press('Enter')
  const thought = await page.waitForFunction(() => window.__conjure.phase() === 'thinking', null, { timeout: 4000 }).then(() => true).catch(() => false)
  await page.waitForFunction(() => window.__conjure.phase() !== 'thinking', null, { timeout: 45000 }).catch(() => {})
  const tIdle = await now()
  const entry = await page.evaluate((n) => {
    const e = window.__conjure.lastEntry()
    return e && e.n > n ? { model: e.model, ms: e.ms, ops: e.ops, dropped: e.dropped?.length ?? 0, notes: e.notes, say: e.say, error: e.error, spawned: e.spawned, modified: e.modified, removed: e.removed } : null
  }, lastN)
  // A teleport: wait out the Director's build.
  let director = null
  const d0 = await page.evaluate((t) => {
    const d = window.__conjure.director()
    return d && d.t0 >= t - 50 ? d.status : null
  }, t0)
  if (d0) {
    await page.waitForFunction(() => window.__conjure.director()?.status !== 'building', null, { timeout: 120000 }).catch(() => {})
    await wait(3000) // last arrivals land, the fog lifts
    director = await page.evaluate((t) => {
      const d = window.__conjure.director()
      return { world: d.world, status: d.status, ops: d.ops, dropped: d.dropped, firstOpMs: d.firstOpAt ? Math.round(d.firstOpAt - t) : null, doneMs: d.doneAt ? Math.round(d.doneAt - t) : null, usd: d.costUsd ?? null, error: d.error ?? null }
    }, t0)
  }
  // Forge refines this sentence started: wait for each outcome (refined, kept draft, library), not for polish.
  let forge = []
  const started = await page.waitForFunction(n => (window.__forge?.log?.length ?? 0) > n, forgeN, { timeout: 3500 }).then(() => true).catch(() => false)
  if (started) {
    await page.waitForFunction(n => window.__forge.log.slice(n).every(r => !!r.outcome), forgeN, { timeout: 100000 }).catch(() => {})
    await wait(2600) // the swap sweep
    forge = await page.evaluate(n => window.__forge.log.slice(n).map(r => ({ kind: r.kind, tier: r.tier, outcome: r.outcome, draftMs: r.draftMs, refinedMs: r.refinedMs, parts: r.parts, usd: Math.round(r.usd * 10000) / 10000, library: !!r.library })), forgeN)
  }
  await wait(settle ?? SETTLE)
  const intent = intentLog.slice(intentN)[0] ?? null
  return { text, t0, thought, idleMs: Math.round(tIdle - t0), intent, entry: entry && { ...entry, ops: entry.ops.map(opLabel) }, director, forge }
}

async function hold(keys, ms) {
  await blurField()
  const parts = keys.split('+')
  const key = parts.pop()
  for (const m of parts) await page.keyboard.down(m === 'shift' ? 'Shift' : m)
  await page.keyboard.down(key)
  await wait(60)
  await page.keyboard.down(key) // a repeat: the HUD reads a held key as walking, never as the first letter of a sentence
  await wait(ms)
  await page.keyboard.up(key)
  for (const m of parts) await page.keyboard.up(m === 'shift' ? 'Shift' : m)
  await wait(500)
}

async function drag(dx, dy) {
  await blurField()
  const x = W / 2
  const y = H / 2 - 100
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(x + (dx * i) / 20, y + (dy * i) / 20)
    await wait(25)
  }
  await page.mouse.up()
  await wait(600)
}

const results = []
const runT0 = Date.now()
for (const [si, sc] of picked.entries()) {
  if (spend >= maxUsd) {
    console.log(`\n$${spend.toFixed(3)} spent ≥ cap $${maxUsd}: stopping before ${sc.id}`)
    results.push({ id: sc.id, group: sc.group, skipped: 'budget' })
    continue
  }
  errors = []
  const spend0 = spend
  // A real reset, back to the start view, and a moment for the reset to land.
  await blurField()
  await page.keyboard.press('Escape').catch(() => {})
  await page.evaluate(() => {
    window.__conjure.reset()
    window.__conjure.look(0, -0.12, [0, 0])
  })
  await wait(1800)
  const scT0 = await now()
  console.log(`\n[${si + 1}/${picked.length}] ${sc.id}`)
  const steps = []
  for (const [k, raw] of sc.steps.entries()) {
    const st = typeof raw === 'string' ? { say: raw } : raw
    const a = await now()
    const before = await pose()
    let rec = {}
    if (st.look) {
      await page.evaluate(([y, p]) => window.__conjure.look(y, p), st.look)
      await wait(400)
    }
    const hud0 = st.talk ? await hudText() : ''
    if (st.say) rec = await speak(st.say, st.talk ? 300 : st.settle)
    if (st.talk) {
      // A person answers in a bubble/caption: wait (up to 15 s) for their words to show, then let them finish.
      const t = await now()
      await page.waitForFunction(([before, said]) => {
        const txt = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
        return txt.replace(before, '').replace(said, '').trim().length > 12
      }, [hud0, st.say], { timeout: 15000 }).catch(() => {})
      rec.replyMs = Math.round((await now()) - t)
      await wait(2500)
    }
    if (st.keys) await hold(st.keys, st.ms ?? 2000)
    if (st.drag) await drag(st.drag[0], st.drag[1])
    if (st.wait) await wait(st.wait)
    const b = await now()
    const after = await pose()
    const file = await shot(sc.id, `s${k + 1}_${st.shot ?? (st.say ? st.say.replace(/\W+/g, '_').replace(/^_|_$/g, '').slice(0, 28) : 'step')}`)
    const row = { step: k + 1, ...(st.say ? {} : { action: st.keys ? `hold ${st.keys} ${st.ms ?? 2000} ms` : st.drag ? `drag ${st.drag}` : 'look' }), ...rec, t0: undefined, fps: await fps(a, b), before, after, census: await census(), hud: await hudText(), shot: file }
    steps.push(row)
    const e = rec.entry
    console.log(`  ${st.say ? `“${st.say}”` : row.action} → ${e ? `${rec.intent ? `${rec.intent.model} first ${rec.intent.firstOpMs ?? '-'} / ${rec.intent.ms} ms` : '-'} · ${e.ops.join(', ')}${e.say?.length ? ` · say ${JSON.stringify(e.say)}` : ''}${e.error ? ` · error ${e.error}` : ''}` : st.say ? '(no world entry: a person answered or nothing happened)' : `moved ${JSON.stringify(before.pos)} → ${JSON.stringify(after.pos)}`}${rec.director ? ` · director ${rec.director.status} first ${rec.director.firstOpMs} done ${rec.director.doneMs} ms ${rec.director.ops} ops` : ''}${rec.forge?.length ? ` · forge ${rec.forge.map(f => `${f.kind}:${f.outcome}@${f.refinedMs ?? '-'}ms`).join(' ')}` : ''} · fps ${JSON.stringify(row.fps)} · ${file}`)
  }
  const all = await fps(scT0, await now())
  results.push({ id: sc.id, group: sc.group, steps, fps: all, usd: Math.round((spend - spend0) * 10000) / 10000, errors: [...new Set(errors)].slice(0, 12), errorCount: errors.length })
  console.log(`  scenario fps ${JSON.stringify(all)} · $${(spend - spend0).toFixed(4)} · errors ${errors.length} · total $${spend.toFixed(3)}`)
  writeFileSync(resolve(outDir, 'results.json'), JSON.stringify({ url, startedAt: new Date(runT0).toISOString(), spend, spendBy, results }, null, 1))
}
const forgeStatus = await page.evaluate(s => s ? fetch(`/api/forge/status?session=${s}`).then(r => r.json()).catch(() => null) : null, await page.evaluate(() => window.__forge?.session))
writeFileSync(resolve(outDir, 'results.json'), JSON.stringify({ url, startedAt: new Date(runT0).toISOString(), minutes: Math.round((Date.now() - runT0) / 6000) / 10, spend, spendBy, forgeStatus, results }, null, 1))
console.log(`\ndone: ${results.length} scenarios · $${spend.toFixed(3)} tracked (${JSON.stringify(spendBy)}) · forge ${JSON.stringify(forgeStatus)} · ${outDir}`)
await browser.close()
