/**
 * NPC minds on the client: every person's persona, memory and voice, the conversation you're in, and the
 * one routing rule (shared/npc/routing.ts) that decides whether a sentence is for the genie or for a person.
 *
 *   spawn      → a seeded stand-in persona at once; a Haiku persona (grounded in the scene) a second later
 *   the world  → every wish they watch you make becomes a memory ("the stranger said … and a dragon appeared")
 *   talk       → /api/npc/talk streams the line: the bubble fills as it's written, the first sentence is
 *                voiced while the rest is still coming (gateway speech, browser speech as the fallback),
 *                then the `>>` actions run (walk, follow, wave, point, give…)
 *   walk away  → the conversation ends and they remember it; next time they greet you as someone they know
 *
 * Minds persist in localStorage, keyed by the person's id and name (ids can be reused after an undo).
 */
import { shallowRef, watch } from 'vue'
import { addEvent, addFact, addTurn, emptyMemory, fallbackPersona, naiveSummary } from '#shared/npc/persona'
import type { Memory, Persona, PersonSeed, Turn } from '#shared/npc/persona'
import { cleanSpoken, parseReply, speakableCut, spokenSoFar } from '#shared/npc/reply'
import type { NpcAction } from '#shared/npc/reply'
import { isEcho, routeUtterance } from '#shared/npc/routing'
import type { Route, RouteContext } from '#shared/npc/routing'
import { npcScene, wishEvent } from '#shared/npc/scene'
import { shouldGreet, TALK_LEAVE_RANGE } from '#shared/npc/behavior'
import { rolePreset } from '#shared/npc/people'
import { isKitKind } from '#shared/world/kinds'
import { normalizeKind } from '#shared/world/ops'
import type { Entity, OpContext, WorldState } from '#shared/world/types'
import { People } from '~/world/npc/people'
import type { WorldRenderer } from '~/world/renderer'

const STORE_KEY = 'conjure:npc:v1'
const VOICES = { f: ['ara', 'eve', 'una'], m: ['leo', 'rex', 'sal'] } as const
/** Persona calls for a batch bigger than this wait until you come within NEAR_PERSONA of them. */
const EAGER_PERSONAS = 4
const NEAR_PERSONA = 16
const CONVERSATION_IDLE_S = 75

interface Mind {
  sig: string
  persona: Persona
  personaState: 'stand-in' | 'pending' | 'ready'
  memory: Memory
  lastGreetAt: number
}

export interface NpcTiming {
  id: string
  name: string
  mode: 'talk' | 'greet'
  utterance?: string
  /** Request → first spoken characters on screen. */
  firstTextMs?: number
  /** Request → first audio playing. */
  firstAudioMs?: number
  /** Request → the whole answer parsed. */
  doneMs?: number
  voice?: string
  say?: string
  actions?: NpcAction[]
}

export interface Bubble {
  id: string
  name: string
  text: string
  thinking: boolean
  at: number
}

const minds = new Map<string, Mind>()
const conversation = shallowRef<string | null>(null)
const speakingId = shallowRef<string | null>(null)
const bubble = shallowRef<Bubble | null>(null)
/** What the player said to a person (the HUD captions it like a wish). */
const playerLine = shallowRef<{ text: string, to: string, at: number } | null>(null)
const timings = shallowRef<NpcTiming[]>([])
const lastRoute = shallowRef<Route | null>(null)
const busy = shallowRef<string | null>(null)

let people: People | null = null
let renderer: WorldRenderer | null = null
let saveTimer: ReturnType<typeof setTimeout> | undefined
let lastHistoryN = 0
let convoLastAt = 0
let lastSpoken: { id: string, text: string, at: number } | null = null
let abortTalk: AbortController | null = null
let checkT = 0

function sigOf(e: Entity): string {
  return `${e.id}|${e.props.name ?? ''}`
}

function hash(id: string, salt: string): number {
  let h = 2166136261
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

function seedOf(e: Entity): PersonSeed {
  return { id: e.id, role: e.props.role, name: e.props.name, persona: e.props.persona }
}

// ---------- persistence ----------

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Mind>
    // performance.now() restarts with the page: a saved greet time means nothing now.
    for (const [k, m] of Object.entries(raw)) if (m?.persona && m.memory) minds.set(k, { ...m, lastGreetAt: -1e9, personaState: m.personaState === 'pending' ? 'stand-in' : m.personaState })
  } catch {
    // nothing saved (or unreadable): everyone starts fresh
  }
}

function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      // Keep the 60 most recently spoken-to minds.
      const list = [...minds.entries()].sort((a, b) => b[1].memory.lastTalkAt - a[1].memory.lastTalkAt).slice(0, 60)
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(list.map(([k, m]) => [k, m]))))
    } catch {
      // storage full or blocked: minds still live for this session
    }
  }, 400)
}

// ---------- minds ----------

function entityOf(id: string): Entity | undefined {
  return useWorld().state.value.entities.find(e => e.id === id && e.kind === 'person')
}

function mindOf(e: Entity): Mind {
  const sig = sigOf(e)
  let m = minds.get(sig)
  if (!m) {
    m = { sig, persona: fallbackPersona(seedOf(e)), personaState: 'stand-in', memory: emptyMemory(), lastGreetAt: -1e9 }
    minds.set(sig, m)
  }
  return m
}

function sceneFor(e: Entity): string {
  const state = useWorld().state.value
  const pos = people?.posOf(e.id) ?? e.pos
  const cam = renderer?.camera.position
  const livePos = new Map(state.entities.filter(x => x.kind === 'person').map(x => [x.id, people?.posOf(x.id) ?? x.pos]))
  const doing = new Map((people?.all() ?? []).map(l => [l.id, l.doing]))
  return npcScene(state, { self: { id: e.id, pos }, livePos, player: cam ? [cam.x, cam.y, cam.z] : [0, 1.6, 0], slot: people?.slot() ?? 'evening', doing })
}

/** Who else lives here (so a new person is someone different): "Edith, fisherman, 58". */
function othersOf(e: Entity): string[] {
  return useWorld().state.value.entities
    .filter(x => x.kind === 'person' && x.id !== e.id)
    .map(x => minds.get(sigOf(x)))
    .filter((m): m is Mind => !!m && m.personaState === 'ready')
    .map(m => `${m.persona.name}, ${m.persona.occupation}, ${m.persona.age}`)
}

async function ensurePersona(e: Entity): Promise<void> {
  const m = mindOf(e)
  if (m.personaState !== 'stand-in') return
  m.personaState = 'pending'
  try {
    const res = await fetch('/api/npc/persona', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ seed: seedOf(e), scene: sceneFor(e), others: othersOf(e) }) })
    const out = await res.json() as { persona?: Persona, error?: string }
    if (out.persona) {
      m.persona = { ...out.persona, name: e.props.name ?? out.persona.name }
      m.personaState = out.persona.generated ? 'ready' : 'stand-in'
      console.info(`[npc] ${m.persona.name}: ${m.persona.occupation}, ${m.persona.age} · ${m.persona.personality} · day: ${m.persona.routine.map(b => `${b.when} ${b.place}`).join(', ')}`)
      save()
    } else {
      m.personaState = 'stand-in'
    }
  } catch {
    m.personaState = 'stand-in'
  }
}

function routineOf(id: string) {
  const e = entityOf(id)
  return e ? mindOf(e).persona.routine : []
}

// ---------- what they witness ----------

function onWorld(next: WorldState, prev: WorldState | undefined) {
  if (!prev) return
  const before = new Set(prev.entities.map(e => e.id))
  const spawned = next.entities.filter(e => !before.has(e.id))
  const newPeople = spawned.filter(e => e.kind === 'person')
  newPeople.forEach((e, i) => {
    mindOf(e)
    if (newPeople.length <= EAGER_PERSONAS) setTimeout(() => void ensurePersona(e), i * 1200)
  })
  const skyChanged = prev.atmosphere.weather !== next.atmosphere.weather || prev.atmosphere.time !== next.atmosphere.time
  if (spawned.length || skyChanged) people?.witness(spawned, skyChanged)

  // A wish they watched you make: one memory line for everyone already standing here.
  const h = useWorld().history.value
  const last = h[h.length - 1]
  if (!last || last.n === lastHistoryN || last.source === undefined || last.label.startsWith('take me to')) return
  lastHistoryN = last.n
  const counts: Record<string, number> = {}
  for (const e of spawned) counts[e.kind] = (counts[e.kind] ?? 0) + 1
  const atmos: string[] = []
  if (prev.atmosphere.time !== next.atmosphere.time) atmos.push(`the sky turned to ${next.atmosphere.time}`)
  if (prev.atmosphere.weather !== next.atmosphere.weather) atmos.push(next.atmosphere.weather ? `a ${next.atmosphere.weather} broke out of nowhere` : 'the weather cleared at a word')
  if ((prev.atmosphere.playerScale ?? 1) !== (next.atmosphere.playerScale ?? 1)) atmos.push((next.atmosphere.playerScale ?? 1) < 1 ? 'the stranger shrank to the size of a beetle' : 'the stranger changed size')
  const changed = next.entities.filter(e => before.has(e.id) && prev.entities.find(p => p.id === e.id) !== e).length
  const removed = prev.entities.length - (next.entities.length - spawned.length)
  const text = wishEvent(last.label, counts, changed, Math.max(0, removed), atmos)
  if (!text) return
  const now = Date.now()
  for (const e of next.entities) {
    if (e.kind !== 'person' || spawned.includes(e)) continue
    const m = mindOf(e)
    m.memory = addEvent(m.memory, text, now)
  }
  save()
}

// ---------- the voice ----------

interface Segment { text: string, audio: Promise<HTMLAudioElement | null> }

class VoiceQueue {
  private queue: Segment[] = []
  private playing = false
  private current: HTMLAudioElement | null = null
  stopped = false
  onFirstAudio?: () => void
  onIdle?: () => void

  constructor(private readonly id: string, private readonly persona: Persona) {}

  private voice(): string {
    const list = VOICES[this.persona.voice]
    return list[Math.floor(hash(this.id, 'voice') * list.length) % list.length]!
  }

  push(text: string) {
    const t = text.trim()
    if (!t || this.stopped) return
    this.queue.push({ text: t, audio: this.fetch(t) })
    if (!this.playing) void this.next()
  }

  private async fetch(text: string): Promise<HTMLAudioElement | null> {
    try {
      const preset = rolePreset(this.persona.occupation)
      const res = await fetch('/api/npc/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: this.voice(), speed: preset === 'elder' ? 0.9 : preset === 'child' ? 1.12 : 1 }) })
      if (res.status !== 200) return null
      const blob = await res.blob()
      const a = new Audio(URL.createObjectURL(blob))
      a.preload = 'auto'
      return a
    } catch {
      return null
    }
  }

  private volume(): number {
    const p = people?.posOf(this.id)
    const c = renderer?.camera.position
    if (!p || !c) return 1
    const d = Math.hypot(p[0] - c.x, p[2] - c.z)
    return Math.max(0.25, Math.min(1, 1.15 - d / 18))
  }

  private async next() {
    const seg = this.queue.shift()
    if (!seg || this.stopped) {
      this.playing = false
      this.onIdle?.()
      return
    }
    this.playing = true
    const audio = await seg.audio
    if (this.stopped) return
    if (audio) {
      this.current = audio
      audio.volume = this.volume()
      audio.addEventListener('playing', () => this.onFirstAudio?.(), { once: true })
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => resolve()
        audio.play().catch(() => this.browserSay(seg.text).then(resolve))
      })
      URL.revokeObjectURL(audio.src)
    } else {
      await this.browserSay(seg.text)
    }
    this.current = null
    void this.next()
  }

  /** The browser's own voice, pitched and paced per person (a child high and quick, an elder low and slow). */
  private browserSay(text: string): Promise<void> {
    return new Promise((resolve) => {
      if (typeof speechSynthesis === 'undefined') return resolve()
      const u = new SpeechSynthesisUtterance(text)
      const preset = rolePreset(this.persona.occupation)
      const f = this.persona.voice === 'f'
      u.pitch = preset === 'child' ? 1.6 : preset === 'elder' ? (f ? 0.95 : 0.7) : f ? 1.15 : 0.85
      u.rate = preset === 'elder' ? 0.85 : preset === 'child' ? 1.15 : 0.95 + hash(this.id, 'rate') * 0.15
      u.volume = this.volume()
      const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
      if (voices.length) u.voice = voices[Math.floor(hash(this.id, 'bv') * voices.length) % voices.length]!
      u.onstart = () => this.onFirstAudio?.()
      u.onend = () => resolve()
      u.onerror = () => resolve()
      speechSynthesis.speak(u)
      setTimeout(resolve, 2500 + text.length * 90) // never hang on a stuck synth
    })
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.queue = []
    this.current?.pause()
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    this.playing = false
    this.onIdle?.()
  }

  get active() {
    return this.playing || this.queue.length > 0
  }
}

let voiceQ: VoiceQueue | null = null

// ---------- talking ----------

function personList(): RouteContext['people'] {
  const state = useWorld().state.value
  const cam = renderer?.camera.position
  if (!cam) return []
  const gazeId = renderer?.gazeNow?.entity
  return state.entities.filter(e => e.kind === 'person').map((e) => {
    const p = people?.posOf(e.id) ?? e.pos
    return { id: e.id, name: e.props.name ?? e.id, dist: Math.hypot(p[0] - cam.x, p[2] - cam.z), gazed: gazeId === e.id, following: !!people?.get(e.id)?.following || e.props.act === 'follow' }
  })
}

function routeContext(): RouteContext {
  return { people: personList(), ...(conversation.value ? { talkingTo: conversation.value } : {}) }
}

/** Which person (if any) is in focus right now: mid-conversation, looked at, or right beside you. */
function focus(): string | null {
  const r = routeUtterance('…', routeContext())
  return r.to === 'npc' ? r.id : null
}

function route(text: string): Route {
  const r = routeUtterance(text, routeContext())
  lastRoute.value = r
  return r
}

function setBubble(id: string, text: string, thinking = false) {
  const e = entityOf(id)
  bubble.value = { id, name: e?.props.name ?? '', text, thinking, at: Date.now() }
}

let bubbleTimer: ReturnType<typeof setTimeout> | undefined
/** Let the bubble go `ms` from now, unless it has changed since (a new line, a new speaker). */
function holdBubble(id: string, ms: number) {
  clearTimeout(bubbleTimer)
  const at = bubble.value?.at
  bubbleTimer = setTimeout(() => {
    if (bubble.value?.id === id && bubble.value.at === at) bubble.value = null
  }, ms)
}

function endConversation(reason: string) {
  const id = conversation.value
  if (!id) return
  conversation.value = null
  const e = entityOf(id)
  if (e) {
    const m = mindOf(e)
    if (m.memory.turns.length) m.memory = { ...m.memory, met: m.memory.met + 1 }
    save()
  }
  console.info(`[npc] conversation with ${e?.props.name ?? id} ended (${reason})`)
}

async function summarize(m: Mind, turns: Turn[]) {
  try {
    const res = await fetch('/api/npc/summary', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: m.persona.name, prev: m.memory.summary, turns }) })
    const out = await res.json() as { summary?: string | null }
    m.memory = { ...m.memory, summary: out.summary || naiveSummary(m.memory.summary, turns) }
  } catch {
    m.memory = { ...m.memory, summary: naiveSummary(m.memory.summary, turns) }
  }
  save()
}

function applyActions(id: string, actions: NpcAction[], ctx: OpContext) {
  if (!people) return
  const e = entityOf(id)
  for (const a of actions) {
    switch (a.act) {
      case 'walk_to':
        if (!people.walkTo(id, a.target)) console.info(`[npc] ${e?.props.name}: no "${a.target}" to walk to`)
        break
      case 'point':
      case 'look_at': {
        const at = people.where(a.target, id)
        if (at && a.act === 'point') people.perform(id, 'point', at)
        else if (at) people.lookAt(id, at, 3)
        break
      }
      case 'give': {
        const kind = normalizeKind(a.item)
        const label = `${e?.props.name ?? 'someone'} gives you ${a.item}`
        if (isKitKind(kind)) useWorld().run([{ op: 'spawn', kind, count: a.count ?? 1, at: { anchor: 'player', dir: 'ahead', dist: 1.3 } }], label, ctx, { source: 'text' })
        else void useIntent().build(`put ${a.count && a.count > 1 ? `${a.count} ${a.item}` : `a ${a.item}`} on the ground right in front of me (a gift from ${e?.props.name ?? 'a villager'})`, ctx, 'text')
        people.perform(id, 'bow')
        break
      }
      case 'remember': {
        if (e) mindOf(e).memory = addFact(mindOf(e).memory, a.fact)
        break
      }
      default:
        people.perform(id, a.act)
    }
  }
}

/**
 * Speak to a person (or let them greet you: `utterance` undefined). Streams their answer into the bubble,
 * voices it sentence by sentence while it's still being written, then runs what they decided to do.
 */
async function talk(id: string, utterance: string | undefined, ctx: OpContext = useWorld().snapshot()): Promise<NpcTiming | null> {
  const e = entityOf(id)
  if (!e || !people) return null
  const m = mindOf(e)
  const mode = utterance ? 'talk' : 'greet'
  // A new line cuts off whatever anyone was saying (barge-in, like the genie).
  abortTalk?.abort()
  voiceQ?.stop()
  const ctrl = new AbortController()
  abortTalk = ctrl
  if (conversation.value && conversation.value !== id) endConversation('talked to someone else')
  conversation.value = id
  convoLastAt = performance.now()
  busy.value = id
  if (personaPending(m)) void ensurePersona(e)
  if (utterance) {
    playerLine.value = { text: utterance, to: e.props.name ?? '', at: Date.now() }
    const { memory, toSummarize } = addTurn(m.memory, { who: 'player', text: utterance, at: Date.now() })
    m.memory = memory
    if (toSummarize.length) void summarize(m, toSummarize)
  }
  setBubble(id, '', true)
  const t0 = performance.now()
  const timing: NpcTiming = { id, name: e.props.name ?? id, mode, utterance }
  const live = people.get(id)
  const q = new VoiceQueue(id, m.persona)
  voiceQ = q
  timing.voice = VOICES[m.persona.voice][Math.floor(hash(id, 'voice') * 3) % 3]
  q.onFirstAudio = () => {
    timing.firstAudioMs ??= Math.round(performance.now() - t0)
    speakingId.value = id
  }
  q.onIdle = () => {
    if (speakingId.value === id) speakingId.value = null
    if (bubble.value?.id === id) holdBubble(id, 2600)
  }

  let full = ''
  let voiced = 0
  const feedVoice = (final: boolean) => {
    const spoken = spokenSoFar(full)
    let rest = spoken.slice(voiced)
    while (rest.trim()) {
      const cut = final ? rest.length : speakableCut(rest)
      if (cut < 0) break
      q.push(rest.slice(0, cut))
      voiced += cut
      rest = spoken.slice(voiced)
    }
  }
  try {
    const res = await fetch('/api/npc/talk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        persona: m.persona,
        memory: { summary: m.memory.summary, turns: m.memory.turns.slice(utterance ? -9 : -8, utterance ? -1 : undefined), events: m.memory.events, facts: m.memory.facts, met: m.memory.met },
        scene: sceneFor(e),
        doing: live?.doing ?? 'standing about',
        utterance,
        mode
      })
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      full += dec.decode(value, { stream: true })
      const shown = spokenSoFar(full).trim()
      if (shown) {
        timing.firstTextMs ??= Math.round(performance.now() - t0)
        setBubble(id, shown)
      }
      feedVoice(false)
    }
  } catch (err) {
    if (ctrl.signal.aborted) return null
    console.warn('[npc] talk failed', err)
    full = full || 'Sorry... my head\'s somewhere else. What was that?'
  }
  if (ctrl.signal.aborted) return null
  const reply = parseReply(full)
  const say = reply.say || cleanSpoken(full).trim() || '…'
  feedVoice(true)
  setBubble(id, say)
  if (!q.active) q.onIdle?.()
  timing.doneMs = Math.round(performance.now() - t0)
  timing.say = say
  timing.actions = reply.actions
  busy.value = null
  lastSpoken = { id, text: say, at: performance.now() }
  const { memory, toSummarize } = addTurn(m.memory, { who: 'npc', text: say, at: Date.now() })
  m.memory = { ...memory, lastTalkAt: Date.now() }
  if (reply.remember) m.memory = addFact(m.memory, reply.remember)
  if (toSummarize.length) void summarize(m, toSummarize)
  if (mode === 'greet') m.lastGreetAt = performance.now()
  convoLastAt = performance.now()
  applyActions(id, reply.actions, ctx)
  save()
  timings.value = [...timings.value.slice(-19), timing]
  console.info(`[npc] ${timing.name} ${mode}${utterance ? ` “${utterance.slice(0, 60)}”` : ''} → first text ${timing.firstTextMs ?? '-'} ms · done ${timing.doneMs} ms · “${say.slice(0, 80)}”${reply.actions.length ? ` · do ${reply.actions.map(a => a.act).join(', ')}` : ''}`)
  return timing
}

function personaPending(m: Mind): boolean {
  return m.personaState === 'stand-in'
}

/** You walked up and looked at them: they turn to you, and now and then speak first. */
function onNotice(id: string, lookedFor: number) {
  if (busy.value || conversation.value) return
  const e = entityOf(id)
  if (!e) return
  const m = mindOf(e)
  if (personaPending(m)) void ensurePersona(e)
  const now = performance.now()
  if (!shouldGreet(lookedFor, (now - m.lastGreetAt) / 1000, (Date.now() - m.memory.lastTalkAt) / 1000)) return
  m.lastGreetAt = now
  void talk(id, undefined)
}

/** Per frame (throttled): end a conversation you walked away from; give nearby people their persona. */
function tick(dt: number) {
  checkT -= dt
  if (checkT > 0) return
  checkT = 0.3
  const cam = renderer?.camera.position
  if (!cam) return
  // Never leave a line hanging on screen (a stuck voice, a person who vanished).
  if (bubble.value && !bubble.value.thinking && busy.value !== bubble.value.id && Date.now() - bubble.value.at > 14_000) bubble.value = null
  const id = conversation.value
  if (id) {
    const p = people?.posOf(id)
    const idle = (performance.now() - convoLastAt) / 1000 > CONVERSATION_IDLE_S && speakingId.value !== id && busy.value !== id
    if (!p) endConversation('they are gone')
    else if (Math.hypot(p[0] - cam.x, p[2] - cam.z) > TALK_LEAVE_RANGE + 1 && !people?.get(id)?.following) {
      endConversation('you walked away')
      voiceQ?.stop()
      if (bubble.value?.id === id) holdBubble(id, 900)
    } else if (idle) endConversation('silence')
  }
  for (const e of useWorld().state.value.entities) {
    if (e.kind !== 'person') continue
    const m = mindOf(e)
    if (!personaPending(m)) continue
    const p = people?.posOf(e.id) ?? e.pos
    if (Math.hypot(p[0] - cam.x, p[2] - cam.z) < NEAR_PERSONA) void ensurePersona(e)
  }
}

/**
 * The one entry point for a sentence typed or spoken outside the realtime genie: route it, then either
 * talk to the person or hand it to the genie's builder. Returns where it went.
 */
async function say(text: string, ctx: OpContext, source: 'text' | 'voice' = 'text'): Promise<Route> {
  const r = route(text)
  if (r.to === 'npc') {
    if (lastSpoken && source === 'voice' && performance.now() - lastSpoken.at < 9000 && isEcho(text, lastSpoken.text)) {
      console.info('[npc] ignored an echo of', lastSpoken.text.slice(0, 40))
      return r
    }
    useIntent().cancelTyping()
    useWorld().renderer()?.anticipate(null)
    void talk(r.id, r.text, ctx)
  } else {
    await useIntent().build(r.text, ctx, source)
  }
  return r
}

function attach(r: WorldRenderer) {
  renderer = r
  load()
  people = new People(r, {
    routineOf,
    onNotice,
    talkingTo: () => conversation.value,
    speaking: () => speakingId.value ?? (busy.value && bubble.value?.thinking === false ? busy.value : null)
  })
  const world = useWorld()
  people.setState(world.state.value)
  lastHistoryN = world.history.value[world.history.value.length - 1]?.n ?? 0
  r.onFrame = (dt, now) => {
    people?.setState(world.state.value)
    people?.tick(dt, now)
    tick(dt)
  }
  r.onThunder = d => people?.thunder(d)
  watch(world.state, (next, prev) => onWorld(next, prev))
  // Everyone standing here when the page opens gets their mind back (or a fresh one).
  for (const e of world.state.value.entities) if (e.kind === 'person') mindOf(e)
  expose()
}

function detach() {
  voiceQ?.stop()
  abortTalk?.abort()
  if (renderer) {
    renderer.onFrame = undefined
    renderer.onThunder = undefined
  }
  renderer = null
  people = null
}

function expose() {
  const w = window as unknown as Record<string, unknown>
  w.__conjureNpc = {
    people: () => (people?.all() ?? []).map(l => ({ id: l.id, name: l.name, mode: l.mode, doing: l.doing, pos: [l.x, l.y, l.z].map(v => Math.round(v * 100) / 100), following: l.following, hidden: l.hidden, gesture: l.oneShot?.kind ?? null, wave: Math.round(l.pose.wave * 100) / 100, dance: Math.round(l.pose.dance * 100) / 100, headPitch: Math.round(l.pose.headPitch * 100) / 100 })),
    mind: (id: string) => {
      const e = entityOf(id)
      return e ? mindOf(e) : null
    },
    talk: (id: string, text?: string) => talk(id, text),
    say: (text: string) => say(text, useIntent().capture(), 'text'),
    route: (text: string) => routeUtterance(text, routeContext()),
    conversation: () => conversation.value,
    timings: () => timings.value,
    bubble: () => bubble.value,
    slot: () => people?.slot()
  }
}

export function useNpc() {
  return {
    conversation, speakingId, bubble, playerLine, timings, lastRoute, busy,
    attach, detach, talk, say, route, focus, isEcho: (heard: string) => !!lastSpoken && performance.now() - lastSpoken.at < 9000 && isEcho(heard, lastSpoken.text),
    posOf: (id: string) => people?.posOf(id), headOf: (id: string) => people?.headOf(id), people: () => people
  }
}
