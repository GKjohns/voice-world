/**
 * All the world's sound, synthesized with WebAudio (no files).
 *   - Ambient beds: filtered noise shaped into water lapping, wind, a room murmur, city hum or a fire.
 *   - One-shots for arrivals and edits (`sfx*`): a sparkle and pop for small things, a rising swell, a deep
 *     thump and a rumble for big ones, rising chimes for a staggered batch, a whoosh and shimmer for
 *     modify, a glittering fall for remove, a portal rush and an arrival chord for teleports.
 * Everything runs through one master gain (M mutes it) into a limiter, with a small synthetic reverb on the
 * one-shots. Audio only starts after a user gesture (browsers block it before one).
 */
import type { Ambient, Weather } from '#shared/world/ops'

const BED_LEVEL = 0.16
const SFX_LEVEL = 0.5
// A pentatonic run (C major pentatonic over two octaves) for the tk-tk-tk chimes.
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31]

interface Bed { stop: () => void }

export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private beds: GainNode | null = null
  private sfx: GainNode | null = null
  private wet: GainNode | null = null
  private bed: Bed | null = null
  private wanted: Ambient | undefined
  private current: Ambient | undefined
  // Loop 2: the weather has its own bed (rain on top of a lake's lapping), switched separately.
  private weatherBed: Bed | null = null
  private weatherWanted: Weather | undefined
  private weatherCurrent: Weather | undefined
  private voices: number[] = [] // start times (ctx seconds) of recent one-shots, for a polyphony cap
  muted = false

  /** Called on any user gesture: create the context (allowed now) and start whatever is wanted. */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return
    try {
      const ctx = new AudioContext()
      this.ctx = ctx
      // Master-limited: nothing (a castle thump on top of a forest of chimes) can clip.
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -12
      limiter.knee.value = 6
      limiter.ratio.value = 14
      limiter.attack.value = 0.003
      limiter.release.value = 0.25
      limiter.connect(ctx.destination)
      this.master = ctx.createGain()
      this.master.gain.value = this.muted ? 0 : 1
      this.master.connect(limiter)
      this.beds = ctx.createGain()
      this.beds.gain.value = BED_LEVEL
      this.beds.connect(this.master)
      this.sfx = ctx.createGain()
      this.sfx.gain.value = SFX_LEVEL
      this.sfx.connect(this.master)
      const verb = ctx.createConvolver()
      verb.buffer = impulse(ctx, 2.4)
      this.wet = ctx.createGain()
      this.wet.gain.value = 0.35
      this.wet.connect(verb).connect(this.sfx)
      this.apply()
    } catch {
      this.ctx = null
    }
  }

  set(ambient: Ambient | undefined): void {
    this.wanted = ambient && ambient !== 'none' ? ambient : undefined
    this.apply()
  }

  toggleMute(): boolean {
    this.muted = !this.muted
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.2)
    return this.muted
  }

  /** Rain hiss, a storm's downpour and gusts, snow's hush. 'clear', 'fog' and 'aurora' are silent. */
  setWeather(w: Weather | undefined): void {
    this.weatherWanted = w === 'rain' || w === 'storm' || w === 'snow' ? w : undefined
    this.apply()
  }

  dispose(): void {
    this.weatherBed?.stop()
    this.bed?.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  private apply(): void {
    if (this.ctx && this.beds && this.weatherWanted !== this.weatherCurrent) {
      this.weatherBed?.stop()
      this.weatherBed = null
      this.weatherCurrent = this.weatherWanted
      if (this.weatherWanted) this.weatherBed = makeBed(this.ctx, this.beds, this.weatherWanted)
    }
    if (!this.ctx || !this.beds || this.wanted === this.current) return
    this.bed?.stop()
    this.bed = null
    this.current = this.wanted
    if (this.wanted) this.bed = makeBed(this.ctx, this.beds, this.wanted)
  }

  // ---------- one-shots ----------

  /** A voice slot `delayMs` from now, or null (no audio yet, muted, or too many voices at once). */
  private slot(delayMs = 0, cost = 1): { ctx: AudioContext, t: number, dry: AudioNode, wet: AudioNode } | null {
    const ctx = this.ctx
    if (!ctx || !this.sfx || !this.wet || this.muted || ctx.state !== 'running') return null
    const t = ctx.currentTime + Math.max(0, delayMs) / 1000
    this.voices = this.voices.filter(v => Math.abs(v - t) < 0.12)
    if (this.voices.length >= 10) return null
    for (let i = 0; i < cost; i++) this.voices.push(t)
    return { ctx, t, dry: this.sfx, wet: this.wet }
  }

  /** Small arrival: a soft glassy sparkle and a little pop (pitched down as things get bigger). */
  sfxPop(size = 1, delayMs = 0): void {
    const v = this.slot(delayMs)
    if (!v) return
    const f = 900 / Math.sqrt(Math.max(0.3, size))
    tone(v, 'sine', f * 1.6, f * 0.7, 0.002, 0.11, 0.22)
    tone(v, 'triangle', f * 3, f * 3.02, 0.004, 0.35, 0.05, true)
    noiseHit(v, 'bandpass', 5200, 0.07, 0.08)
  }

  /** One chime of a staggered batch: index i of n climbs a pentatonic run (tk-tk-tk). */
  sfxChime(i: number, n: number, delayMs = 0): void {
    const v = this.slot(delayMs)
    if (!v) return
    const step = n <= PENTA.length ? i : Math.floor((i * PENTA.length) / n)
    const f = 523.25 * 2 ** (PENTA[Math.min(PENTA.length - 1, step)]! / 12)
    const level = 0.14 / Math.sqrt(Math.max(1, n / 8))
    tone(v, 'sine', f, f, 0.003, 0.6, level, true)
    tone(v, 'sine', f * 2.01, f * 2.01, 0.002, 0.25, level * 0.3, true)
  }

  /** Something big is coming: a rising airy swell under the beam of light, `leadMs` long. */
  sfxSummon(size: number, leadMs: number, delayMs = 0): void {
    const v = this.slot(delayMs, 2)
    if (!v) return
    const dur = Math.max(0.3, leadMs / 1000)
    const g = v.ctx.createGain()
    const level = Math.min(0.35, 0.12 + size * 0.006)
    g.gain.setValueAtTime(0.0001, v.t)
    g.gain.exponentialRampToValueAtTime(level, v.t + dur)
    g.gain.exponentialRampToValueAtTime(0.0001, v.t + dur + 0.5)
    g.connect(v.dry)
    g.connect(v.wet)
    const src = noise(v.ctx, false)
    const bp = v.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 3
    bp.frequency.setValueAtTime(300, v.t)
    bp.frequency.exponentialRampToValueAtTime(2400, v.t + dur)
    src.connect(bp).connect(g)
    src.start(v.t)
    src.stop(v.t + dur + 0.6)
    // A shimmering fifth rising with it.
    for (const [a, b] of [[220, 440], [330, 660]] as const) {
      const o = v.ctx.createOscillator()
      o.type = 'sine'
      o.frequency.setValueAtTime(a, v.t)
      o.frequency.exponentialRampToValueAtTime(b, v.t + dur)
      const og = v.ctx.createGain()
      og.gain.value = 0.25
      o.connect(og).connect(g)
      o.start(v.t)
      o.stop(v.t + dur + 0.6)
    }
  }

  /** A big thing lands: a deep pitched-down thump plus a rumble of low noise, weighted by size (metres). */
  sfxThump(size: number, delayMs = 0): void {
    const v = this.slot(delayMs, 2)
    if (!v) return
    const k = Math.min(1, size / 60)
    const f0 = 95 - 45 * k
    tone(v, 'sine', f0 * 1.8, f0 * 0.45, 0.004, 0.5 + 1.1 * k, 0.9)
    tone(v, 'triangle', f0 * 3.2, f0, 0.002, 0.12, 0.18)
    noiseHit(v, 'lowpass', 180 + 200 * (1 - k), 0.7 + 1.6 * k, 0.5 + 0.4 * k, true)
  }

  /** Modify: a filtered-noise whoosh (up for growth, down for shrink) with a glassy shimmer on top. */
  sfxWhoosh(up = true, delayMs = 0, big = false): void {
    const v = this.slot(delayMs)
    if (!v) return
    const dur = big ? 0.75 : 0.45
    const g = v.ctx.createGain()
    g.gain.setValueAtTime(0.0001, v.t)
    g.gain.exponentialRampToValueAtTime(big ? 0.5 : 0.28, v.t + dur * 0.55)
    g.gain.exponentialRampToValueAtTime(0.0001, v.t + dur)
    g.connect(v.dry)
    g.connect(v.wet)
    const src = noise(v.ctx, false)
    const bp = v.ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.Q.value = 1.4
    const [a, b] = up ? [350, 3200] : [3000, 300]
    bp.frequency.setValueAtTime(a, v.t)
    bp.frequency.exponentialRampToValueAtTime(b, v.t + dur)
    src.connect(bp).connect(g)
    src.start(v.t)
    src.stop(v.t + dur + 0.05)
    const f = up ? 1318.5 : 987.8
    tone(v, 'sine', f, f * (up ? 1.5 : 0.75), 0.05, dur + 0.3, 0.05, true)
  }

  /** Remove: a glittering, falling sprinkle of sparks. */
  sfxDissolve(delayMs = 0): void {
    const v = this.slot(delayMs)
    if (!v) return
    for (let i = 0; i < 5; i++) {
      const f = 2400 - i * 260 + Math.random() * 120
      const t = { ...v, t: v.t + i * 0.045 }
      tone(t, 'sine', f, f * 0.9, 0.002, 0.18, 0.05, true)
    }
    noiseHit(v, 'highpass', 4000, 0.4, 0.05)
  }

  /** Teleport out: a deep rushing swirl that builds while the old place dissolves. */
  sfxPortal(): void {
    const v = this.slot(0, 3)
    if (!v) return
    const g = v.ctx.createGain()
    g.gain.setValueAtTime(0.0001, v.t)
    g.gain.exponentialRampToValueAtTime(0.45, v.t + 0.5)
    g.gain.setTargetAtTime(0.18, v.t + 0.6, 0.6)
    g.gain.setTargetAtTime(0.0001, v.t + 2.4, 0.5)
    g.connect(v.dry)
    g.connect(v.wet)
    const src = noise(v.ctx, true)
    const lp = v.ctx.createBiquadFilter()
    lp.type = 'bandpass'
    lp.Q.value = 2.5
    lp.frequency.setValueAtTime(120, v.t)
    lp.frequency.exponentialRampToValueAtTime(900, v.t + 0.6)
    lp.frequency.exponentialRampToValueAtTime(260, v.t + 3)
    // A swirling wobble on the filter: the vortex.
    const lfo = v.ctx.createOscillator()
    lfo.frequency.value = 2.2
    const depth = v.ctx.createGain()
    depth.gain.value = 140
    lfo.connect(depth).connect(lp.frequency)
    src.connect(lp).connect(g)
    src.start(v.t)
    lfo.start(v.t)
    src.stop(v.t + 4.5)
    lfo.stop(v.t + 4.5)
    tone(v, 'sine', 55, 41, 0.3, 2.6, 0.35)
  }

  /**
   * Thunder `distance` metres away, arriving `delayMs` from now: a sharp crack when it's close, then a long
   * rolling rumble of low noise whose swells come and go. Never polyphony-capped away (it's the storm).
   */
  sfxThunder(distance: number, delayMs = 0): void {
    const ctx = this.ctx
    if (!ctx || !this.sfx || !this.wet || this.muted || ctx.state !== 'running') return
    const v: Voice = { ctx, t: ctx.currentTime + Math.max(0, delayMs) / 1000, dry: this.sfx, wet: this.wet }
    const near = Math.max(0, Math.min(1, 1 - distance / 400))
    if (near > 0.55) noiseHit(v, 'highpass', 1800, 0.35, 0.5 * near)
    const len = 3.2 + 2.5 * (1 - near) + Math.random()
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, v.t)
    g.gain.exponentialRampToValueAtTime(0.5 + 0.5 * near, v.t + 0.06 + 0.25 * (1 - near))
    // Rolls: two or three swells as the sound comes back off far clouds.
    let at = v.t + 0.4
    for (let i = 0; i < 3; i++) {
      at += 0.5 + Math.random() * 0.9
      g.gain.exponentialRampToValueAtTime(0.18 + Math.random() * 0.3, at)
    }
    g.gain.exponentialRampToValueAtTime(0.0001, v.t + len)
    g.connect(v.dry)
    g.connect(v.wet)
    const src = noise(ctx, true)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(900 * (0.4 + near), v.t)
    lp.frequency.exponentialRampToValueAtTime(140, v.t + len)
    src.connect(lp).connect(g)
    src.start(v.t)
    src.stop(v.t + len + 0.1)
    tone(v, 'sine', 48, 32, 0.08, len * 0.7, 0.4 + 0.3 * near)
  }

  /** A shooting star: a faint glassy fall. */
  sfxStar(delayMs = 0): void {
    const v = this.slot(delayMs)
    if (!v) return
    tone(v, 'sine', 2600, 1300, 0.01, 0.9, 0.035, true)
  }

  /** Teleport in: a warm open chord blooming as the new place appears. */
  sfxArrive(delayMs = 0): void {
    const v = this.slot(delayMs, 3)
    if (!v) return
    for (const [i, f] of [261.6, 392, 523.3, 659.3, 784].entries()) {
      tone({ ...v, t: v.t + i * 0.07 }, 'sine', f, f, 0.25, 2.8, 0.07, true)
    }
  }
}

type Voice = { ctx: AudioContext, t: number, dry: AudioNode, wet: AudioNode }

/** One enveloped oscillator: a pitch glide from f0 to f1, attack then exponential decay. */
function tone(v: Voice, type: OscillatorType, f0: number, f1: number, attack: number, decay: number, level: number, wet = false): void {
  const o = v.ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, v.t)
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), v.t + attack + decay * 0.7)
  const g = v.ctx.createGain()
  g.gain.setValueAtTime(0.0001, v.t)
  g.gain.exponentialRampToValueAtTime(level, v.t + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, v.t + attack + decay)
  o.connect(g).connect(v.dry)
  if (wet) g.connect(v.wet)
  o.start(v.t)
  o.stop(v.t + attack + decay + 0.05)
}

/** A filtered noise burst (dust, rumble, glitter). */
function noiseHit(v: Voice, type: BiquadFilterType, freq: number, decay: number, level: number, brown = false): void {
  const src = noise(v.ctx, brown)
  const f = v.ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  const g = v.ctx.createGain()
  g.gain.setValueAtTime(0.0001, v.t)
  g.gain.exponentialRampToValueAtTime(level, v.t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, v.t + decay)
  src.connect(f).connect(g).connect(v.dry)
  src.start(v.t)
  src.stop(v.t + decay + 0.05)
}

/** A synthetic room: stereo decaying noise for the convolver. */
function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3
  }
  return buf
}

const noiseCache = new WeakMap<AudioContext, { white?: AudioBuffer, brown?: AudioBuffer }>()

function noise(ctx: AudioContext, brown: boolean): AudioBufferSourceNode {
  const cache = noiseCache.get(ctx) ?? {}
  noiseCache.set(ctx, cache)
  const key = brown ? 'brown' : 'white'
  const src0 = ctx.createBufferSource()
  src0.loop = true
  if (cache[key]) {
    src0.buffer = cache[key]!
    return src0
  }
  const len = ctx.sampleRate * 4
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  cache[key] = buf
  const d = buf.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (brown) {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else {
      d[i] = w
    }
  }
  src0.buffer = buf
  return src0
}

/** One bed: noise → filter → gain, with a slow LFO on the gain (waves, gusts) or the filter. */
function makeBed(ctx: AudioContext, out: AudioNode, kind: Ambient | Weather): Bed {
  const fade = ctx.createGain()
  fade.gain.value = 0
  fade.gain.setTargetAtTime(1, ctx.currentTime, 1.2)
  fade.connect(out)
  const nodes: AudioScheduledSourceNode[] = []
  const layer = (brown: boolean, type: BiquadFilterType, freq: number, q: number, level: number, lfoHz: number, lfoDepth: number, lfoOnFilter = false) => {
    const src = noise(ctx, brown)
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const gain = ctx.createGain()
    gain.gain.value = level
    src.connect(filter).connect(gain).connect(fade)
    if (lfoHz > 0) {
      const lfo = ctx.createOscillator()
      lfo.frequency.value = lfoHz
      const depth = ctx.createGain()
      depth.gain.value = lfoDepth
      lfo.connect(depth).connect(lfoOnFilter ? filter.frequency : gain.gain)
      lfo.start()
      nodes.push(lfo)
    }
    src.start()
    nodes.push(src)
  }
  if (kind === 'water') {
    layer(true, 'lowpass', 420, 0.7, 0.9, 0.13, 0.45)
    layer(false, 'bandpass', 1800, 0.9, 0.05, 0.21, 0.04)
  } else if (kind === 'wind') {
    layer(false, 'bandpass', 500, 1.2, 0.35, 0.07, 260, true)
    layer(true, 'lowpass', 200, 0.7, 0.6, 0.05, 0.3)
  } else if (kind === 'room') {
    layer(true, 'bandpass', 380, 0.8, 0.9, 0.31, 0.25)
    layer(false, 'bandpass', 900, 2, 0.06, 0.53, 0.04)
  } else if (kind === 'city') {
    layer(true, 'lowpass', 160, 0.7, 1, 0.04, 0.25)
    layer(false, 'bandpass', 1200, 0.6, 0.04, 0.09, 0.03)
  } else if (kind === 'fire') {
    layer(true, 'lowpass', 300, 0.7, 0.7, 0.4, 0.2)
    // Crackle: sparse clicks from highpassed noise with a fast, jittery LFO.
    layer(false, 'highpass', 2600, 0.7, 0.05, 7.3, 0.05)
  } else if (kind === 'rain') {
    // A steady hiss of drops with a softer patter underneath.
    layer(false, 'bandpass', 3800, 0.5, 0.32, 0.11, 0.05)
    layer(false, 'lowpass', 900, 0.6, 0.35, 0.17, 0.08)
  } else if (kind === 'storm') {
    layer(false, 'bandpass', 3000, 0.45, 0.5, 0.13, 0.1)
    layer(true, 'lowpass', 500, 0.7, 0.8, 0.09, 0.35)
    layer(false, 'bandpass', 420, 1.3, 0.3, 0.06, 240, true) // gusts
  } else if (kind === 'snow') {
    layer(false, 'bandpass', 380, 1.4, 0.18, 0.05, 150, true) // a hushed wind
  }
  return {
    stop: () => {
      fade.gain.setTargetAtTime(0, ctx.currentTime, 0.4)
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.stop()
          } catch {
            // already stopped
          }
        }
        fade.disconnect()
      }, 1600)
    }
  }
}
