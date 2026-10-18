// Headless screenshot loop for the world.
// Usage: node scripts/shoot.mjs [scenario] [--url http://localhost:3091/] [--w 1440 --h 900] [--out dir]
// Scenarios drive the HUD's example chips like a person would, then screenshot. PNGs go to --out
// (default: the OS temp dir) so nothing stray lands in the repo; convert keepers to .webp by hand.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => {
  const i = args.indexOf(k)
  return i >= 0 ? args[i + 1] : d
}
const scenario = args.find((a, i) => !a.startsWith('--') && !(args[i - 1] || '').startsWith('--')) || 'sprint1'
const url = opt('--url', 'http://localhost:3091/')
const width = Number(opt('--w', 1440))
const height = Number(opt('--h', 900))
const outDir = resolve(opt('--out', resolve(tmpdir(), 'conjure-shots')))
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl']
})
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log('[browser]', m.type(), m.text())
})
page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 })
await page.evaluate(() => document.querySelectorAll('#nuxt-devtools-container, nuxt-devtools-anchor, [id^="nuxt-devtools"]').forEach(e => e.remove()))

const wait = ms => page.waitForTimeout(ms)
const look = (yaw, pitch, pos) => page.evaluate(([y, p, q]) => window.__conjure.look(y, p, q), [yaw, pitch, pos])
const clear = () => page.evaluate(() => window.__conjure.clear())
const chip = async (id, settle = 2200) => {
  await page.click(`[data-example="${id}"]`)
  await page.mouse.move(width / 2, height / 2) // move off the chip so its tooltip doesn't sit in the shot
  await wait(settle)
}
const shots = []
const shot = async (label) => {
  // Park the pointer on the canvas so tooltips close, then grab the whole page (HUD included).
  await page.mouse.move(width / 2, height / 2 - 120)
  await wait(150)
  const out = resolve(outDir, `${String(shots.length + 1).padStart(2, '0')}_${label}.png`)
  await page.screenshot({ path: out })
  shots.push(out)
  console.log(out)
}
const summary = () => page.evaluate(() => {
  const s = window.__conjure.state()
  const by = {}
  for (const e of s.entities) by[e.kind] = (by[e.kind] || 0) + 1
  return { entities: s.entities.length, by, log: s.log.map(b => b.id), time: s.atmosphere.time }
})

// Turn to face the centroid of a kind (yaw 0 = -z, positive turns left), optionally offset.
const face = async (kind, pitch = -0.18, offset = 0) => {
  const [x, z] = await page.evaluate((k) => {
    const es = window.__conjure.state().entities.filter(e => e.kind === k)
    return [es.reduce((a, e) => a + e.pos[0], 0) / es.length, es.reduce((a, e) => a + e.pos[2], 0) / es.length]
  }, kind)
  await look(Math.atan2(-x, -z) + offset, pitch)
  await wait(400)
}

// Type a sentence into the real text bar (snapshot on the first keystroke), send it, and wait for the model.
const ask = async (text, { midShot } = {}) => {
  await page.click('input[data-intent-input], [data-intent-input] input')
  await page.keyboard.type(text, { delay: 18 })
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => window.__conjure.phase() === 'thinking', null, { timeout: 5000 }).catch(() => {})
  if (midShot) await shot(midShot)
  await page.waitForFunction(() => window.__conjure.phase() !== 'thinking', null, { timeout: 30000 })
  const last = await page.evaluate(() => window.__conjure.lastEntry())
  console.log(`  “${text}” → ${last?.model} ${last?.ms} ms · ops ${JSON.stringify((last?.ops || []).map(o => o.op === 'spawn' ? `spawn ${o.kind}×${o.count || 1}` : o.op))}${last?.dropped?.length ? ` · dropped ${last.dropped.length}` : ''}${last?.notes?.length ? ` · notes ${last.notes.join('; ')}` : ''}${last?.error ? ` · error ${last.error}` : ''} · say ${JSON.stringify(last?.say)}`)
  await page.evaluate(() => document.activeElement?.blur())
}

if (scenario === 'sprint1') {
  await page.click('[data-console-toggle]')
  await clear()
  await look(0, -0.14, [0, 0])
  await wait(900)
  await shot('empty')

  // "Make a bunch of trees": nine pines, staggered in.
  await chip('trees', 380)
  await shot('trees_arriving') // mid-stagger: the ghost ring and the first pines growing in
  await wait(2000)
  await shot('trees_cluster')
  console.log('trees', await summary())

  // A house to the left (it must stay its colour) and oaks to the right, then "all the trees red".
  await look(0.55, -0.16)
  await chip('house', 1600)
  await look(0, -0.14)
  await chip('oaks', 1600)
  await look(0.12, -0.12, [0, 3])
  await wait(300)
  await chip('trees-red', 1400)
  await shot('trees_red')
  console.log('red', await page.evaluate(() => window.__conjure.state().entities.map(e => `${e.kind}:${e.props.color ?? '-'}`).join(' ')))

  // "A few houses" then "those houses twice as tall".
  await clear()
  await look(0, -0.13, [0, 0])
  await wait(500)
  await chip('houses', 2000)
  await shot('houses')
  await chip('houses-tall', 1600)
  await shot('houses_tall')
  console.log('tall', await page.evaluate(() => window.__conjure.state().entities.map(e => `${e.kind}:h${e.props.height ?? 1}`).join(' ')))

  // A learned grandfather clock, then "five more of those", then undo.
  await clear()
  await look(0, -0.3, [0, 0])
  await wait(500)
  await chip('clock', 1600)
  await chip('five-more', 2000)
  await look(-0.12, -0.22, [0, 1])
  await wait(300)
  await shot('clock_learned')
  console.log('clock', await summary())
  await chip('undo', 1200)
  await shot('after_undo')
  console.log('undo', await summary())

  // Bonus: road + lamps at night, and a bad op dropped next to a good one.
  await clear()
  await look(0, -0.12, [0, 0])
  await wait(400)
  await chip('road', 2600)
  await chip('night', 1400)
  await look(0.35, -0.1, [3, 6])
  await chip('bad', 1500)
  await shot('night_road')
  console.log('night', await summary())
} else if (scenario === 'sprint2') {
  await clear()
  await look(0.1, -0.16, [0, 0])
  await wait(900)
  await ask('make a bunch of trees')
  await wait(2200)
  await shot('s2_trees')
  console.log('trees', await summary())

  await ask('make all the trees red')
  await wait(1500)
  await shot('s2_trees_red')

  await look(-0.35, -0.2, [0, 0])
  await wait(300)
  await ask('put a grandfather clock next to the trees', { midShot: 's2_clock_thinking' })
  await wait(1800)
  await face('grandfather_clock', -0.2, 0.18)
  await shot('s2_clock')
  console.log('clock', await summary())

  await ask('make five more of those')
  await wait(2400)
  await face('grandfather_clock', -0.2, 0.1)
  await shot('s2_five_more')
  console.log('five', await summary())

  await ask('make it night')
  await wait(2600)
  await shot('s2_night')
  console.log('night', await summary())
} else if (scenario === 'sprint4' || scenario.startsWith('sprint4:')) {
  // Teleport mode through the real models: intent (Haiku) → teleport → Director (Sonnet) stream.
  // `sprint4:pool` / `sprint4:lake` / `sprint4:street` run one place; plain `sprint4` runs all, then edits and a replay.
  const only = scenario.split(':')[1]
  const directorCalls = []
  page.on('request', (r) => {
    if (r.url().includes('/api/director')) directorCalls.push(r.url())
  })
  const teleport = async (text, slug, { view = [0, -0.06], midAfterMs = 1500, fogShot = false } = {}) => {
    await look(view[0], view[1], [0, 0])
    await wait(300)
    // Type the sentence, then time from the Enter key (not from the first keystroke).
    await page.click('input[data-intent-input], [data-intent-input] input')
    await page.keyboard.type(text, { delay: 18 })
    const t0 = await page.evaluate(() => performance.now())
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.__conjure.phase() === 'thinking', null, { timeout: 5000 }).catch(() => {})
    await page.waitForFunction(() => window.__conjure.phase() !== 'thinking', null, { timeout: 30000 })
    await page.evaluate(() => document.activeElement?.blur())
    const intentMs = Math.round(await page.evaluate(t => performance.now() - t, t0))
    const entry = await page.evaluate(() => window.__conjure.lastEntry())
    console.log(`  “${text}” → ${entry?.model} ${entry?.ms} ms · ${JSON.stringify((entry?.ops || []).slice(0, 2))}`)
    if (fogShot) {
      await wait(700)
      await shot(`s4_${slug}_fog`)
    }
    // Mid-build: a moment after the first Director op lands.
    await page.waitForFunction(() => window.__conjure.director()?.firstOpAt, null, { timeout: 60000 })
    await wait(midAfterMs)
    await shot(`s4_${slug}_mid`)
    await page.waitForFunction(() => window.__conjure.director()?.status !== 'building', null, { timeout: 90000 })
    await wait(3200) // the last arrivals land and the fog lifts
    const d = await page.evaluate(() => window.__conjure.director())
    const fromAsk = await page.evaluate(([a, b]) => [Math.round(b.firstOpAt - a), Math.round(b.doneAt - a)], [t0, d])
    console.log(`  ${slug}: intent ${intentMs} ms · director first op ${Math.round(d.firstOpAt - d.t0)} ms, done ${Math.round(d.doneAt - d.t0)} ms · from Enter: first op ${fromAsk[0]} ms, complete ${fromAsk[1]} ms · ${d.ops} ops (${d.dropped} dropped) · $${(d.costUsd ?? 0).toFixed(4)} · ${d.status}${d.error ? ` ${d.error}` : ''}`)
    await shot(`s4_${slug}`)
    console.log('   ', JSON.stringify(await summary()))
  }

  await clear()
  await look(0, -0.08, [0, 0])
  await wait(600)
  // Something to fog out: the void with a grove in it.
  await page.evaluate(() => window.__conjure.example('trees'))
  await wait(2200)
  if (!only || only === 'pool') {
    await teleport('take me to a pool hall', 'pool', { fogShot: true })
    await ask('make all the lamps blue')
    await wait(1600)
    await shot('s4_pool_lamps_blue')
    console.log('   lamps:', await page.evaluate(() => window.__conjure.state().entities.filter(e => e.tags.includes('light') || e.tags.includes('lamp')).map(e => `${e.kind}:${e.props.color ?? '-'}`).join(' ')))
  }
  if (!only || only === 'lake') await teleport('take me somewhere tranquil so I can relax', 'lake', { view: [0, -0.04] })
  if (!only || only === 'street') await teleport('a neon city street at night', 'street', { view: [0, -0.02] })
  if (!only) {
    // Save/replay: reload restores the op log from localStorage and rebuilds the scene with no model call.
    const before = directorCalls.length
    const was = await summary()
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 })
    await page.evaluate(() => document.querySelectorAll('[id^="nuxt-devtools"]').forEach(e => e.remove()))
    await look(0, -0.02, [0, 0])
    await wait(4500)
    await shot('s4_street_replayed')
    const now = await summary()
    console.log(`  replay: ${JSON.stringify(now.by) === JSON.stringify(was.by) ? 'same entities' : 'DIFFERENT'} (${now.entities} vs ${was.entities}) · director calls during reload: ${directorCalls.length - before}`)
  }
} else if (scenario === 'one') {
  await wait(1200)
  await shot('scene')
} else {
  throw new Error(`unknown scenario ${scenario}`)
}

await browser.close()
