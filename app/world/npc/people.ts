/**
 * The People runtime: every frame, every person decides what to do (shared/npc/behavior.ts), walks there
 * over the ground (steering round houses and trees, never into the lake unless there's a dock), and poses
 * their body (kit/people.ts `PersonPose`). Their live position rides on the item's stretch group the way
 * motion poses do, so the world state never changes while they stroll; it only changes when the genie
 * moves them.
 *
 * The mind (persona, memory, talk) lives in `useNpc`; this file only knows bodies and routines, plus a few
 * hooks it calls back: `routineOf` (their day), `onFollowEnd`.
 *
 * Calm mode: people stay put and get on with their day. They never walk over to you or turn to greet you;
 * stand close and look at one and they glance back (head only). They move when asked, or when something
 * startles them.
 */
import { KIT } from '#shared/world/kinds'
import type { Act, Vec3 } from '#shared/world/ops'
import type { Entity, WorldState } from '#shared/world/types'
import { chooseMode, FLEE_RANGE, GLANCE_RANGE, SCARY, SPEED, STARTLING, viewAngle } from '#shared/npc/behavior'
import type { Mode } from '#shared/npc/behavior'
import { canStand, deckAt, obstacles, steer } from '#shared/npc/ground'
import type { RoutineBlock, DaySlot } from '#shared/npc/persona'
import { cleanTarget, currentSlot, LINGER_S, pickBlock, POTTER_RADIUS, resolvePlace, ROUTINE_RANGE, standPoint } from '#shared/npc/routine'
import type { PlaceEntity } from '#shared/npc/routine'
import { applyPose } from '../fx/motion'
import { restPose } from '../kit/people'
import type { PersonPose } from '../kit/people'
import type { WorldRenderer } from '../renderer'

type OneShot = 'wave' | 'bow' | 'cheer' | 'point'

interface Goal {
  x: number
  z: number
  yaw?: number
  /** What they do once there. */
  activity: string
  doing: string
  /** Hide inside (asleep at home). */
  inside?: boolean
  /** Their own decision (talk) rather than the routine: kept until reached + `hold` seconds. */
  hold?: number
  key: string
}

export interface Live {
  id: string
  name: string
  x: number
  z: number
  y: number
  yaw: number
  home: [number, number]
  mode: Mode
  goal: Goal | null
  arrived: boolean
  arrivedAt: number
  /** Seconds left lingering before the next idle wander. */
  linger: number
  speed: number
  stride: number
  pose: PersonPose
  oneShot: { kind: OneShot, until: number, target?: Vec3 } | null
  following: boolean
  /** Their own "I'll sit" / "I'll dance" from a conversation (the genie's acts come from props.act). */
  ownAct: Act | null
  /** They talked their way out of the genie's act ("I'll stay here"): ignore props.act until a new cue. */
  suppressAct: boolean
  reactUntil: number
  reactAt: Vec3 | null
  fleeFrom: Vec3 | null
  fleeUntil: number
  lookAt: Vec3 | null
  lookUntil: number
  lookedFor: number
  seenActId: number | undefined
  seed: number
  doing: string
  lastPos: Vec3
  footT: number
  /** The routine block they're living (slot|place|activity), so a new time of day sends them somewhere new. */
  blockKey: string
  stall: number
  hidden: boolean
  bornAt: number
  /** When the genie's dance or sit runs out (then the routine takes over again). */
  actUntil: number
  /** When their own "I'll sit" / "I'll dance" runs out. */
  ownActUntil: number
  /** Following: since when, and the last time you spoke to them (a follower drifts off after a minute of silence). */
  lastTouch: number
  mood: string
  moodUntil: number
}

export interface PeopleHooks {
  routineOf: (id: string) => RoutineBlock[]
  /** Who's mid-conversation, and whether this person is speaking aloud right now. */
  talkingTo: () => string | null
  isSpeaking: (id: string) => boolean
  /** They stopped following you (a minute without a word, or you left them behind). */
  onFollowEnd?: (id: string, why: 'quiet' | 'far') => void
  /** Their age, once the persona knows it (the rig greys and stoops past sixty). */
  ageOf?: (id: string) => number | undefined
}

/** How long the genie's lasting acts last before the routine takes over (seconds). */
export const ACT_SECONDS = { dance: [15, 25], sit: [35, 50], own_dance: [15, 22], own_sit: [40, 60] } as const
/** A follower with no word from you for this long, or this far behind, heads back to their day. */
export const FOLLOW_QUIET_S = 60
export const FOLLOW_FAR = 45
/** A follower sprints to keep up with a walking player (6 m/s): Gauntlet loop 1, the wizard fell 15 m behind. */
const FOLLOW_RUN = 9.5

const TAU = Math.PI * 2
/** Their own pottering never ends closer than this to you. */
const PERSONAL_SPACE = 2
const STRIDE_LEN = 1.35 // metres per full stride cycle at a walk

function hash(id: string, salt: string): number {
  let h = 2166136261
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function approach(cur: number, to: number, rate: number, dt: number): number {
  return cur + (to - cur) * Math.min(1, rate * dt)
}

const ACTIVITY_DOING: Record<string, string> = {
  fish: 'fishing', sit: 'sitting', work: 'working', sweep: 'sweeping', chat: 'chatting', sleep: 'asleep', patrol: 'on patrol', wander: 'strolling about', read: 'reading', cast: 'practising spells', tend: 'tending plants', stand: 'standing about', play: 'playing a game', serve: 'serving'
}

export class People {
  private live = new Map<string, Live>()
  private readonly t0 = performance.now()
  private state: WorldState | null = null

  constructor(private readonly r: WorldRenderer, private readonly hooks: PeopleHooks) {}

  setState(s: WorldState): void {
    this.state = s
  }

  get(id: string): Live | undefined {
    return this.live.get(id)
  }

  all(): Live[] {
    return [...this.live.values()]
  }

  /** Live (walking) position of a person, at the feet. */
  posOf(id: string): Vec3 | undefined {
    const l = this.live.get(id)
    return l ? [l.x, l.y, l.z] : undefined
  }

  /** Head height above the feet (for bubbles and look-at). */
  headOf(id: string): Vec3 | undefined {
    const l = this.live.get(id)
    if (!l) return undefined
    const item = [...this.r.people()].find(i => i.entity.id === id)
    const h = (item?.body.userData.personHeight as number | undefined) ?? 1.75
    const s = item?.holder.scale.x ?? 1
    return [l.x, l.y + h * s, l.z]
  }

  slot(): DaySlot {
    return currentSlot(this.state?.atmosphere.time ?? 'dusk', (performance.now() - this.t0) / 1000)
  }

  // ---------- commands from the mind ----------

  perform(id: string, act: OneShot | Act | 'stand' | 'stay', target?: Vec3): void {
    const l = this.live.get(id)
    if (!l) return
    const now = performance.now()
    if (act === 'wave' || act === 'bow' || act === 'cheer' || act === 'point') l.oneShot = { kind: act, until: now + (act === 'point' ? 2600 : act === 'bow' ? 1800 : 2800), target }
    else if (act === 'follow') {
      l.following = true
      l.ownAct = null
      l.lastTouch = now
    } else if (act === 'stay') {
      l.following = false
      l.suppressAct = true
    } else if (act === 'stand' || act === 'none') {
      l.ownAct = null
      l.suppressAct = true
    } else if (act === 'sit' || act === 'dance') {
      l.ownAct = act
      const [a, b] = act === 'sit' ? ACT_SECONDS.own_sit : ACT_SECONDS.own_dance
      l.ownActUntil = now + (a + (b - a) * l.seed) * 1000
    }
  }

  /** You spoke to them (a follower stays with you while you keep talking). */
  touch(id: string): void {
    const l = this.live.get(id)
    if (l) l.lastTouch = performance.now()
  }

  /** How they feel for the next `secs` seconds (the face and the posture show it). */
  setMood(id: string, mood: string | undefined, secs = 10): void {
    const l = this.live.get(id)
    if (!l || !mood) return
    l.mood = mood
    l.moodUntil = performance.now() + secs * 1000
  }

  walkTo(id: string, target: string): boolean {
    const l = this.live.get(id)
    if (!l || !this.state) return false
    // "maeve the villager", "the dock": the scene's labels, copied back.
    const t = cleanTarget(target)
    const cam = this.r.camera.position
    if (/^(player|me|you|stranger|visitor|here)$/.test(t)) {
      l.goal = { x: cam.x, z: cam.z, activity: 'stand', doing: 'coming over to you', hold: 15, key: `walk:${t}` }
      l.arrived = false
      return true
    }
    const hit = resolvePlace(t, this.placeEntities(), [l.x, l.z], id, 150)
    if (!hit) return false
    const sp = standPoint(hit, (this.state.kinds[hit.kind] ?? KIT[hit.kind])?.footprint ?? 1, [l.x, l.z], hash(id, 'sp'))
    l.goal = { ...this.safeSpot(sp.x, sp.z, l), yaw: sp.yaw, activity: hit.kind === 'dock' ? 'fish' : 'stand', doing: `walking to the ${hit.kind.replace(/_/g, ' ')}`, hold: 25, key: `walk:${t}` }
    l.arrived = false
    l.following = false
    return true
  }

  lookAt(id: string, at: Vec3, secs = 3): void {
    const l = this.live.get(id)
    if (!l) return
    l.lookAt = at
    l.lookUntil = performance.now() + secs * 1000
  }

  /** Where a place word is right now (for pointing and looking). */
  where(target: string, from: string): Vec3 | undefined {
    const t = cleanTarget(target)
    const cam = this.r.camera.position
    if (/^(player|me|you|stranger|visitor)$/.test(t)) return [cam.x, cam.y, cam.z]
    if (t === 'sky' || t === 'up') {
      const l = this.live.get(from)
      return l ? [l.x + Math.sin(l.yaw) * 6, 30, l.z + Math.cos(l.yaw) * 6] : undefined
    }
    const l = this.live.get(from)
    const hit = resolvePlace(t, this.placeEntities(), l ? [l.x, l.z] : [0, 0], from, 300)
    if (!hit) return undefined
    const p = hit.kind === 'person' ? this.posOf(hit.id) ?? hit.pos : hit.pos
    return [p[0], p[1] + 1, p[2]]
  }

  // ---------- events from the world ----------

  /** Something just appeared (or the sky turned): everyone nearby stops and looks; scary things close by send them running. */
  witness(spawned: Entity[], skyChanged: boolean, scaryAt: Vec3[] = []): void {
    const now = performance.now()
    for (const l of this.live.values()) {
      if (now - l.bornAt < 1500) continue
      let looked = false
      // Something already here turned to lava or fire: close by, they run; further off, they stare.
      for (const at of scaryAt) {
        const d = Math.hypot(at[0] - l.x, at[2] - l.z)
        if (d < FLEE_RANGE + 2) {
          l.fleeFrom = at
          l.fleeUntil = now + 4000
        }
        if (d < 30 && !looked) {
          l.reactAt = [at[0], at[1] + 0.8, at[2]]
          l.reactUntil = now + 2600
          looked = true
        }
      }
      for (const e of spawned) {
        if (e.kind === 'person' && e.id === l.id) continue
        const d = Math.hypot(e.pos[0] - l.x, e.pos[2] - l.z)
        const startling = STARTLING.some(t => e.tags.includes(t)) || e.pos[1] > 10
        const scary = SCARY.some(t => e.tags.includes(t))
        if (scary && d < FLEE_RANGE + (e.tags.includes('dragon') ? 6 : 0)) {
          l.fleeFrom = e.pos
          l.fleeUntil = now + 4500
          l.mood = 'afraid'
          l.moodUntil = now + 9000
        } else if (startling && d < 60 && now > l.moodUntil) {
          l.mood = scary ? 'afraid' : 'curious'
          l.moodUntil = now + 6000
        }
        if (!looked && (startling || d < 25)) {
          l.reactAt = [e.pos[0], Math.max(1.5, e.pos[1] + (startling ? 6 : 0.8)), e.pos[2]]
          l.reactUntil = now + (startling ? 4200 : 1800) + hash(l.id, String(now)) * 600
          looked = true
        }
      }
      if (skyChanged && !looked) {
        l.reactAt = [l.x + Math.sin(l.yaw) * 5, 40, l.z + Math.cos(l.yaw) * 5]
        l.reactUntil = now + 2600 + hash(l.id, 'sky') * 900
      }
    }
  }

  thunder(dist: number): void {
    if (dist > 900) return
    const now = performance.now()
    for (const l of this.live.values()) {
      l.reactUntil = Math.max(l.reactUntil, now + 1300)
      l.reactAt = [l.x + Math.sin(l.yaw) * 4, 35, l.z + Math.cos(l.yaw) * 4]
      l.pose.flinch = 1
    }
  }

  // ---------- per frame ----------

  tick(dt: number, now: number): void {
    if (!this.state) return
    const seen = new Set<string>()
    const cam = this.r.camera.position
    const eye: Vec3 = [cam.x, cam.y, cam.z]
    const ents = this.groundEntities()
    for (const item of this.r.people()) {
      if (item.leaving) continue
      const e = item.entity
      seen.add(e.id)
      let l = this.live.get(e.id)
      if (!l) {
        l = this.spawn(e, now)
        this.live.set(e.id, l)
      }
      // The genie moved them (a move op): they're where the world says now.
      if (e.pos.some((v, i) => Math.abs(v - l!.lastPos[i]!) > 1e-3)) {
        l.x = e.pos[0]
        l.z = e.pos[2]
        l.y = e.pos[1]
        l.home = [e.pos[0], e.pos[2]]
        l.goal = null
        l.lastPos = [...e.pos]
      }
      l.name = e.props.name ?? l.name
      this.cue(l, e, now)
      this.think(l, e, eye, now, dt, ents)
      this.move(l, e, dt, ents)
      this.posePerson(l, e, eye, now, dt)
      // Apply: the live spot on the stretch group (holder stays at the entity's spot).
      applyPose(item, { x: l.x, y: l.y, z: l.z, yaw: l.yaw, roll: 0, pitch: 0 })
      // The age the persona settled on (grey hair and a stoop past sixty, a child's size under thirteen).
      const age = this.hooks.ageOf?.(e.id)
      if (age !== undefined && item.body.userData.age !== age) (item.body.userData.setAge as ((a: number) => void) | undefined)?.(age)
      const fn = item.body.userData.person as ((p: PersonPose) => void) | undefined
      fn?.(l.pose)
      item.body.visible = !l.hidden
    }
    for (const id of this.live.keys()) if (!seen.has(id)) this.live.delete(id)
  }

  private spawn(e: Entity, now: number): Live {
    return {
      id: e.id, name: e.props.name ?? 'someone', x: e.pos[0], z: e.pos[2], y: e.pos[1], yaw: e.rotY, home: [e.pos[0], e.pos[2]],
      mode: 'routine', goal: null, arrived: false, arrivedAt: now, linger: LINGER_S[0] * hash(e.id, 'l'), speed: 0, stride: hash(e.id, 's'),
      pose: { ...restPose(), seed: hash(e.id, 'pose') }, oneShot: null, following: false, ownAct: null, suppressAct: false,
      reactUntil: 0, reactAt: null, fleeFrom: null, fleeUntil: 0, lookAt: null, lookUntil: 0, lookedFor: 0,
      // A person born with an act does it once at birth; one already standing when the page loads doesn't replay it.
      seenActId: now - this.t0 < 2500 ? e.props.actId : undefined,
      seed: hash(e.id, 'seed'), doing: 'looking around', lastPos: [...e.pos], footT: 0, blockKey: '', stall: 0, hidden: false, bornAt: now,
      actUntil: 0, ownActUntil: 0, lastTouch: now, mood: 'calm', moodUntil: 0
    }
  }

  /** The genie's acts (props.act + actId): a fresh actId replays a one-shot even if the act didn't change. */
  private cue(l: Live, e: Entity, now: number): void {
    const act = e.props.act
    if (e.props.actId !== l.seenActId) {
      l.seenActId = e.props.actId
      l.suppressAct = false
      if (act === 'wave' || act === 'bow' || act === 'cheer') {
        // A crowd doesn't wave in lockstep: each one a beat after the last.
        l.oneShot = { kind: act, until: now + 2900 + l.seed * 500 }
        l.lookAt = this.eye()
        l.lookUntil = now + 3200
      }
      if (act === 'follow') {
        l.following = true
        l.lastTouch = now
      }
      if (act === 'dance' || act === 'sit') {
        const [a, b] = ACT_SECONDS[act]
        l.actUntil = now + (a + (b - a) * l.seed) * 1000
        l.ownAct = null
      }
      if (act === 'none') {
        l.following = false
        l.ownAct = null
        l.actUntil = 0
      }
    }
  }

  private eye(): Vec3 {
    const c = this.r.camera.position
    return [c.x, c.y, c.z]
  }

  private think(l: Live, e: Entity, eye: Vec3, now: number, dt: number, ents: PlaceEntity[]): void {
    const pd = Math.hypot(eye[0] - l.x, eye[2] - l.z)
    const head: Vec3 = [l.x, l.y + 1.6, l.z]
    // A looser cone for someone walking past (the crosshair can't track a moving head).
    const looking = viewAngle(eye, this.r.yaw, this.r.pitch, head) < (l.speed > 0.3 ? 0.34 : 0.22) || this.r.gazeNow?.entity === l.id
    l.lookedFor = pd <= GLANCE_RANGE && looking ? l.lookedFor + dt : 0
    // Acts end: the genie's dance or sit runs its course, their own too, and then the day takes over.
    if (l.ownAct && now > l.ownActUntil) l.ownAct = null
    const genieAct = l.suppressAct ? undefined : e.props.act
    const act = (genieAct === 'dance' || genieAct === 'sit') && now > l.actUntil ? undefined : genieAct
    if (l.following && (pd > FOLLOW_FAR || (now - l.lastTouch) / 1000 > FOLLOW_QUIET_S)) {
      l.following = false
      if (genieAct === 'follow') l.suppressAct = true
      this.hooks.onFollowEnd?.(l.id, pd > FOLLOW_FAR ? 'far' : 'quiet')
    }
    const following = l.following
    const lasting = act === 'dance' || act === 'sit' || following || l.ownAct === 'sit' || l.ownAct === 'dance'
    const prev = l.mode
    l.mode = chooseMode({
      fleeing: !!l.fleeFrom && now < l.fleeUntil,
      talking: this.hooks.talkingTo() === l.id,
      playerDist: pd,
      lasting,
      commanded: act === 'dance' || act === 'sit',
      reacting: now < l.reactUntil
    })
    if (l.mode === 'flee' && now > l.moodUntil - 3000) {
      l.mood = 'afraid'
      l.moodUntil = now + 6000
    }
    if (prev !== l.mode && l.mode === 'routine') l.goal = l.goal?.hold ? l.goal : null

    switch (l.mode) {
      case 'flee': {
        const f = l.fleeFrom!
        const a = Math.atan2(l.x - f[0], l.z - f[2])
        l.goal = { x: l.x + Math.sin(a) * 6, z: l.z + Math.cos(a) * 6, activity: 'stand', doing: 'running away', key: 'flee' }
        l.arrived = false
        l.doing = 'running for cover'
        return
      }
      case 'talk':
        // Mid-conversation they stay with you, unless they said they'd show you something or come along.
        if (l.following) this.followGoal(l, eye)
        else if (!l.goal?.hold) l.goal = null
        l.doing = l.following ? 'walking with the visitor, talking' : 'talking with the visitor'
        return
      case 'react':
        l.goal = l.goal?.hold ? l.goal : null
        l.doing = 'staring up at what just happened'
        return
      case 'act': {
        if (l.following) {
          this.followGoal(l, eye)
          l.doing = 'following the visitor'
        } else {
          l.goal = null
          l.doing = (act ?? l.ownAct) === 'dance' ? 'dancing' : 'sitting down'
        }
        return
      }
      default:
        break
    }

    // Routine: the block for this time of day → a place near home → a spot; then a long linger, a few steps, linger again.
    if (l.goal?.hold) {
      if (l.arrived && (now - l.arrivedAt) / 1000 > l.goal.hold) l.goal = null
      else return
    }
    const block = pickBlock(this.hooks.routineOf(l.id), this.slot())
    const key = block ? `${block.when}|${block.place}|${block.activity}` : 'none'
    if (key !== l.blockKey || !l.goal) {
      l.blockKey = key
      if (block && block.place !== 'wander') {
        const sleeping = block.activity === 'sleep'
        const place = block.place === 'home' ? this.homeOf(l, ents) : resolvePlace(block.place, ents, l.home, l.id, ROUTINE_RANGE)
        if (place) {
          const fp = (this.state!.kinds[place.kind] ?? KIT[place.kind])?.footprint ?? 1
          const sp = this.freeStandPoint(place, fp, l)
          l.goal = { ...this.safeSpot(sp.x, sp.z, l), yaw: sp.yaw, activity: block.activity, doing: block.doing, inside: sleeping && /house|storefront|tent|cabin|home/.test(place.kind), key }
          l.arrived = false
          l.doing = `on the way: ${block.doing}`
          return
        }
      }
      // Wander (or nowhere near to go): potter about home.
      l.goal = this.idleSpot(l, block?.activity === 'sleep' ? 'sit' : block?.activity ?? 'stand', block?.doing ?? 'strolling about', key)
      l.arrived = false
      return
    }
    if (l.arrived) {
      l.doing = l.goal.doing || ACTIVITY_DOING[l.goal.activity] || l.doing
      l.linger -= dt
      // Fishing, sitting and sleeping stay put; everything else potters about now and then.
      const stays = ['fish', 'sit', 'sleep', 'read', 'chat', 'play', 'serve'].includes(l.goal.activity)
      if (l.linger <= 0 && !stays) {
        l.goal = this.idleSpot(l, l.goal.activity === 'patrol' || l.goal.activity === 'wander' ? l.goal.activity : 'stand', l.goal.doing, key, [l.goal.x, l.goal.z], POTTER_RADIUS)
        l.arrived = false
        l.linger = LINGER_S[0] + hash(l.id, String(Math.floor(now / 1000))) * (LINGER_S[1] - LINGER_S[0])
      }
    }
  }

  /** A stand point at a place that nobody else is already heading for (two people never share one bench seat). */
  private freeStandPoint(place: PlaceEntity, fp: number, l: Live) {
    let sp = standPoint(place, fp, [l.x, l.z], hash(l.id, 'sp'))
    for (let k = 1; k <= 5; k++) {
      const taken = [...this.live.values()].some(o => o.id !== l.id && o.goal && Math.hypot(o.goal.x - sp.x, o.goal.z - sp.z) < 0.75)
      if (!taken) break
      sp = standPoint(place, fp, [l.x, l.z], (hash(l.id, 'sp') + k * 0.37) % 1)
    }
    return sp
  }

  /**
   * Keep a few metres ahead of you and off to one side (Gauntlet loop 1: in the lower part of your view, so
   * you see them walk with you, not behind you where you never look); sprint to catch up.
   */
  private followGoal(l: Live, eye: Vec3): void {
    const side = l.seed > 0.5 ? 1 : -1
    const yaw = this.r.yaw
    // The camera looks down -z at yaw 0: "ahead of you" is -sin/-cos of yaw, "your right" is +cos/-sin.
    const gx = eye[0] - Math.sin(yaw) * 3.6 + Math.cos(yaw) * 1.3 * side
    const gz = eye[2] - Math.cos(yaw) * 3.6 - Math.sin(yaw) * 1.3 * side
    if (Math.hypot(gx - l.x, gz - l.z) > 1.4) {
      l.goal = { ...this.safeSpot(gx, gz, l), activity: 'stand', doing: 'following the visitor', key: 'follow' }
      l.arrived = false
    }
  }

  /** A few steps somewhere near `around`, never into your personal space (they don't crowd you). */
  private idleSpot(l: Live, activity: string, doing: string, key: string, around: [number, number] = l.home, R = POTTER_RADIUS): Goal {
    const cam = this.r.camera.position
    for (let i = 0; i < 8; i++) {
      const a = hash(l.id, `${key}${i}${Math.floor(performance.now() / 4000)}`) * TAU
      const r = (0.3 + 0.7 * hash(l.id, `r${i}${Math.floor(performance.now() / 4000)}`)) * R
      const x = around[0] + Math.sin(a) * r
      const z = around[1] + Math.cos(a) * r
      if (Math.hypot(x - cam.x, z - cam.z) >= PERSONAL_SPACE && this.standable(x, z)) return { x, z, activity, doing, key: `idle:${key}` }
    }
    return { x: l.x, z: l.z, activity, doing, key: `idle:${key}` }
  }

  private standable(x: number, z: number): boolean {
    const ents = this.groundEntities()
    return canStand(ents, obstacles(ents, k => this.footprint(k), [x, z]), x, z)
  }

  /** The nearest spot to (x, z) a person can stand on (a spot inside the lake moves to its shore). */
  private safeSpot(x: number, z: number, l: Live): { x: number, z: number } {
    if (this.standable(x, z)) return { x, z }
    const dx = x - l.x
    const dz = z - l.z
    for (let k = 0.9; k > 0; k -= 0.1) {
      if (this.standable(l.x + dx * k, l.z + dz * k)) return { x: l.x + dx * k, z: l.z + dz * k }
    }
    return { x: l.x, z: l.z }
  }

  private homeOf(l: Live, ents: PlaceEntity[]): PlaceEntity | undefined {
    for (const k of ['house', 'storefront', 'tent', 'cabin']) {
      const hit = resolvePlace(k, ents, l.home, l.id, ROUTINE_RANGE * 2)
      if (hit) return hit
    }
    return undefined
  }

  private footprint(kind: string): number {
    return (this.state?.kinds[kind] ?? KIT[kind])?.footprint ?? 0.5
  }

  private placeEntities(): PlaceEntity[] {
    return (this.state?.entities ?? []).map(e => (e.kind === 'person' ? { ...e, pos: this.posOf(e.id) ?? e.pos } : e))
  }

  private groundEntities(): PlaceEntity[] {
    return this.state?.entities ?? []
  }

  private move(l: Live, _e: Entity, dt: number, ents: PlaceEntity[]): void {
    const g = l.goal
    let want = 0
    if (g && !l.arrived) {
      const dx = g.x - l.x
      const dz = g.z - l.z
      const d = Math.hypot(dx, dz)
      if (d < 0.25) {
        l.arrived = true
        l.arrivedAt = performance.now()
        if (l.mode === 'routine') l.linger = LINGER_S[0] + hash(l.id, String(Math.round(l.arrivedAt))) * (LINGER_S[1] - LINGER_S[0])
      } else {
        const fleeing = l.mode === 'flee'
        const catchingUp = l.following || l.mode === 'act'
        // Their own day is an amble; somewhere you asked them to go, a walk (a hurry if it's far).
        const amble = l.mode === 'routine' && !g.hold
        const pace = l.following && d > 3 ? Math.max(SPEED.run, Math.min(FOLLOW_RUN, d * 1.5)) : fleeing || (catchingUp && d > 7) ? SPEED.run : catchingUp && d > 3 ? SPEED.hurry : amble ? SPEED.stroll * (0.85 + 0.2 * l.seed) : d > 30 ? SPEED.hurry : SPEED.walk * (0.9 + 0.2 * l.seed)
        want = Math.min(pace, d * 2)
        const solid = obstacles(ents, k => this.footprint(k), [l.x, l.z])
        // Boxed in where they stand (spawned on a house, say): walk out ignoring solids.
        const free = canStand(ents, solid, l.x, l.z)
        const heading = Math.atan2(dx, dz)
        const a = free ? steer(ents, solid, l.x, l.z, heading, want * dt) : heading
        if (a === null) {
          // No way there from here (across the lake): do the thing where they stand.
          want = 0
          l.goal = { ...g, x: l.x, z: l.z }
          l.arrived = true
          l.arrivedAt = performance.now()
        } else {
          // Turn toward the heading before striding off at full pace.
          const turn = wrap(a - l.yaw)
          l.yaw = wrap(l.yaw + Math.sign(turn) * Math.min(Math.abs(turn), (fleeing ? 8 : 4.5) * dt))
          const facing = Math.max(0, Math.cos(turn))
          const v = want * (0.25 + 0.75 * facing)
          const nx = l.x + Math.sin(l.yaw) * v * dt
          const nz = l.z + Math.cos(l.yaw) * v * dt
          // Never step off a dock into the lake or into a wall (stepping out of one is always allowed).
          if (!free || canStand(ents, solid, nx, nz)) {
            l.x = nx
            l.z = nz
            want = v
          } else {
            want = 0
            // Stuck at an edge for a moment: call it arrived (the next goal comes from somewhere reachable).
            l.stall += dt
            if (l.stall > 1.5) {
              l.goal = { ...g, x: l.x, z: l.z }
              l.arrived = true
              l.arrivedAt = performance.now()
              l.stall = 0
            }
          }
        }
      }
    }
    l.speed = approach(l.speed, want, 6, dt)
    l.stride += (l.speed / STRIDE_LEN) * dt
    // Feet on the ground: the terrain, or the deck they're on.
    l.footT -= dt
    if (l.footT <= 0) {
      l.footT = 0.12
      const deck = deckAt(ents, l.x, l.z)
      l.y = Math.max(this.r.terrainAt(l.x, l.z), deck ?? -Infinity)
    }
  }

  private posePerson(l: Live, e: Entity, eye: Vec3, now: number, dt: number): void {
    const p = l.pose
    p.t = now / 1000
    p.speed = l.speed
    p.stride = l.stride
    const act0 = l.suppressAct ? undefined : e.props.act
    const act = (act0 === 'dance' || act0 === 'sit') && now > l.actUntil ? undefined : act0
    const atGoal = !!l.goal && l.arrived
    const activity = l.mode === 'routine' && atGoal ? l.goal!.activity : ''
    const lastingAct: string | null = act === 'dance' || act === 'sit' ? act : l.ownAct

    // Face: you when talking; the routine's direction once there.
    let face: number | null = null
    if (l.mode === 'talk') face = Math.atan2(eye[0] - l.x, eye[2] - l.z)
    else if (atGoal && l.goal!.yaw !== undefined && l.speed < 0.3) face = l.goal!.yaw
    else if (l.mode === 'act' && lastingAct === 'dance') face = Math.atan2(eye[0] - l.x, eye[2] - l.z) + 0.5 * Math.sin(p.t * 0.8 + l.seed * 6)
    if (face !== null && l.speed < 0.3) {
      const turn = wrap(face - l.yaw)
      // Turn the body only when the head can't comfortably reach.
      if (Math.abs(turn) > (l.mode === 'talk' ? 0.35 : 0.9) || atGoal) l.yaw = wrap(l.yaw + Math.sign(turn) * Math.min(Math.abs(turn), 3 * dt))
    }

    // Look: a target this frame, as yaw/pitch relative to the body.
    let look: Vec3 | null = null
    if (l.lookAt && now < l.lookUntil) look = l.lookAt
    // A dragon or a thunderclap gets a glance even mid-conversation.
    else if ((l.mode === 'react' || now < l.reactUntil) && l.reactAt) look = l.reactAt
    else if (l.mode === 'talk' || (l.oneShot && l.oneShot.kind !== 'point')) look = eye
    else if (l.mode === 'flee' && l.fleeFrom) look = l.fleeFrom
    // You're right beside them and looking: a glance back (the head only; they carry on).
    else if (l.lookedFor > 0.6) look = eye
    let hy = 0.25 * Math.sin(p.t * 0.31 + l.seed * 5) * (l.speed < 0.3 ? 1 : 0.3)
    let hp = 0
    if (look) {
      const dx = look[0] - l.x
      const dz = look[2] - l.z
      hy = Math.max(-1.3, Math.min(1.3, wrap(Math.atan2(dx, dz) - l.yaw)))
      hp = Math.max(-0.5, Math.min(0.55, Math.atan2(look[1] - (l.y + 1.6), Math.max(0.5, Math.hypot(dx, dz)))))
    }
    p.headYaw = approach(p.headYaw, hy, 5, dt)
    p.headPitch = approach(p.headPitch, hp, 5, dt)

    // Gesture weights blend toward what the moment wants.
    const shot = l.oneShot && now < l.oneShot.until ? l.oneShot.kind : null
    if (l.oneShot && now >= l.oneShot.until) l.oneShot = null
    const speaking = this.hooks.isSpeaking(l.id)
    const sitting = l.speed < 0.2 && (lastingAct === 'sit' || activity === 'sit' || (activity === 'sleep' && !l.goal?.inside))
    const working = l.speed < 0.2 && ['fish', 'work', 'sweep', 'read', 'cast', 'tend', 'play', 'serve'].includes(activity)
    p.wave = approach(p.wave, shot === 'wave' ? 1 : 0, 6, dt)
    p.bow = approach(p.bow, shot === 'bow' ? 1 : 0, 4, dt)
    p.cheer = approach(p.cheer, shot === 'cheer' ? 1 : 0, 6, dt)
    p.point = approach(p.point, shot === 'point' ? 1 : 0, 5, dt)
    if (shot === 'point' && l.oneShot?.target) {
      const t = l.oneShot.target
      p.pointYaw = wrap(Math.atan2(t[0] - l.x, t[2] - l.z) - l.yaw)
      p.pointPitch = Math.atan2(t[1] - (l.y + 1.4), Math.max(1, Math.hypot(t[0] - l.x, t[2] - l.z)))
      if (Math.abs(p.pointYaw) > 0.8 && l.speed < 0.3) l.yaw = wrap(l.yaw + Math.sign(p.pointYaw) * Math.min(Math.abs(p.pointYaw), 3 * dt))
    }
    p.dance = approach(p.dance, l.mode === 'act' && lastingAct === 'dance' ? 1 : 0, 3, dt)
    p.sit = approach(p.sit, sitting && l.mode !== 'talk' ? 1 : 0, 3, dt)
    p.talk = approach(p.talk, speaking ? 1 : 0, 6, dt)
    p.work = approach(p.work, working && l.mode === 'routine' ? 1 : 0, 2.5, dt)
    if (working) p.workKind = activity
    p.sleep = approach(p.sleep, activity === 'sleep' && l.speed < 0.2 && l.mode === 'routine' ? 1 : 0, 1.5, dt)
    p.flinch = approach(p.flinch, l.mode === 'flee' ? 0.6 : 0, 2.2, dt)
    // Mood: shows while it lasts, then fades back to calm.
    const feeling = now < l.moodUntil && l.mood !== 'calm'
    if (feeling && p.mood !== l.mood) {
      if (p.moodW < 0.05) p.mood = l.mood
      else p.moodW = approach(p.moodW, 0, 6, dt)
    } else {
      p.moodW = approach(p.moodW, feeling ? 1 : 0, feeling ? 4 : 1.5, dt)
    }
    l.hidden = activity === 'sleep' && !!l.goal?.inside && atGoal && l.mode === 'routine' && (now - l.arrivedAt) > 1500
  }
}
