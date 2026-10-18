/**
 * Fresh mode (for demo recordings): everything the player names is generated live, so nothing pops in
 * from the built-in kit or the forge library and reads as canned.
 *
 * With Fresh on:
 * - a named thing is designed by the intent model (`define`, the rough draft) and then forged (the detail
 *   pass), even when the kit has one: "a whale" gets a new `sky_whale`, never the kit whale;
 * - the forge never reads its library or its reference-image cache, and writes nothing to either, so a
 *   later normal session isn't seeded by a Fresh one;
 * - a second identical wish designs the thing again under a new kind name instead of reusing the first.
 *
 * "Incidental" (kit still allowed): the ground and scenery a wish stands on rather than the thing it asks
 * for. That is the kinds below: terrain and sky bodies (they carry the engine's surface and horizon
 * behaviour), floors / walls / water and other sized structure, nature filler (trees, rocks, bushes,
 * reeds), ambient particles, and people (they have minds and voices; they are never defined). Everything
 * else in the kit (creatures, buildings, furniture, lights, vehicles, props) is a SHOWPIECE: in Fresh mode
 * a named request for one is designed live.
 */
import { KIT } from './kinds.ts'

export const FRESH_FILLER: ReadonlySet<string> = new Set([
  // terrain and sky bodies
  'mountain', 'mountain_range', 'hill', 'cliff', 'volcano', 'waterfall', 'river', 'island', 'canyon', 'giant_moon', 'planet',
  // ground and structure
  'floor', 'wall', 'ceiling', 'window', 'rug', 'water', 'shore', 'dock', 'road', 'fence',
  // nature filler
  'pine', 'oak', 'rock', 'bush', 'reeds',
  // ambient life and particles
  'fireflies', 'dust_motes', 'embers',
  // people
  'person'
])

/** Kit kinds that Fresh mode designs live instead of taking from the kit. */
export const FRESH_SHOWPIECES: readonly string[] = Object.keys(KIT).filter(k => k !== 'blob' && !FRESH_FILLER.has(k))

/** A kit kind that Fresh mode replaces with a live design when it is asked for by name. */
export function isFreshShowpiece(kind: string): boolean {
  return Object.hasOwn(KIT, kind) && kind !== 'blob' && !FRESH_FILLER.has(kind)
}

/** `?fresh=1|true|on|yes` → true, `0|false|off|no` → false, absent or anything else → undefined. */
export function parseFreshParam(v: string | null | undefined): boolean | undefined {
  if (v === null || v === undefined) return undefined
  const s = v.trim().toLowerCase()
  if (s === '' || s === '1' || s === 'true' || s === 'on' || s === 'yes') return true
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false
  return undefined
}

/** The per-call addendum for the intent model (kept out of the cached digest). */
export const FRESH_INTENT = `## FRESH MODE (overrides the catalog rules above)
Everything the sentence names must be designed by you, live, right now.
- Kit kinds you may still use only as incidental scenery: ${[...FRESH_FILLER].join(', ')}. Every other kit kind (${FRESH_SHOWPIECES.join(', ')}) is OFF: when the sentence asks for one ("a whale", "a dragon", "a lamp", "a house"), spawn a NEW kind name for it (e.g. sky_whale, dragon_beast, street_lamp, cottage) and define it in the same response (rule 4, 12–20 parts for creatures). Never spawn an OFF kind and never define a kit kind's own name.
- A sentence that asks for a thing again ("a whale", "another whale swimming through the sky", the same wish twice) designs it again under a new name (sky_whale_2, sky_whale_3…), even when a learned kind for it is listed. Only a reference to things already standing here ("more of those", "five more", "make it red", "the whale") reuses an existing kind.
- Changing or moving a named thing that isn't here: spawn a new kind for it and define it (never rely on the engine to conjure one).`

/** The per-call addendum for the Director. */
export const FRESH_DIRECTOR = `## FRESH MODE
Catalog kinds are for the place's incidental scenery only: ${[...FRESH_FILLER].join(', ')}. Whatever the place name or the brief names (its centrepiece, its creatures, its signature objects, a dragon, a whale, a boat, a lantern), design with define under a new kind name, never from the catalog; hero: true on the one the brief leads with. Other furniture and lights may come from the catalog only when the brief doesn't name them.`

/** The next free `<base>_<n>` (n ≥ 2) for a kind name that is already taken. */
export function nextKindName(kind: string, taken: ReadonlySet<string>): string {
  const base = kind.replace(/_\d+$/, '')
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`.slice(0, 48)
}

/** The same op with every mention of kind `from` (its own kind, a selector's, a placement's) renamed `to`. */
export function renameKind<T>(op: T, from: string, to: string): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (Array.isArray(v)) return key === 'parts' ? v : v.map(x => walk(x))
    if (!v || typeof v !== 'object') return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = k === 'kind' && x === from ? to : walk(x, k)
    return out
  }
  return walk(op) as T
}

/**
 * Fresh mode's safety net for a repeated wish: the model sometimes spawns and re-defines a learned kind
 * that already stands in the world ("a whale" twice → sky_whale again). That spawn would show the old
 * design instantly and the define would morph the first whale too. So, in Fresh mode, a spawn of an
 * already-taken kind holds itself and everything after it until the answer shows what it is: a `define`
 * of that kind (a new design) renames the held ops and the define to the next free name and lets them
 * go; anything else ("five more of those") lets them go unchanged when the answer ends.
 */
export function freshRenamer<T extends { op: string, kind?: string }>(learned: Iterable<string>) {
  const taken = new Set(learned)
  const watch = new Set<string>()
  let held: T[] = []
  const flush = (): T[] => {
    const out = held
    held = []
    return out
  }
  return {
    push(op: T): T[] {
      if (op.op === 'define' && op.kind && watch.has(op.kind)) {
        const from = op.kind
        const to = nextKindName(from, taken)
        taken.add(to)
        watch.delete(from)
        held = [...held, op].map(o => renameKind(o, from, to))
        return watch.size ? [] : flush()
      }
      if (op.op === 'define' && op.kind) taken.add(op.kind)
      // Only a learned kind can be redesigned (kit kinds can't be defined), so only those hold.
      if (op.op === 'spawn' && op.kind && taken.has(op.kind)) watch.add(op.kind)
      if (!watch.size) return [op]
      held.push(op)
      return []
    },
    /** The answer ended: whatever is still held was a plain reuse; let it go as it was. */
    end(): T[] {
      watch.clear()
      return flush()
    }
  }
}
