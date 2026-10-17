/**
 * Ambient sound beds, synthesized with WebAudio (no files): filtered noise shaped into water lapping,
 * wind, a room murmur, city hum or a crackling fire. Quiet by design, and it only starts after a user
 * gesture (browsers block audio before one). `M` toggles mute (wired in WorldScene).
 */
import type { Ambient } from '#shared/world/ops'

const LEVEL = 0.16

interface Bed { stop: () => void }

export class Ambience {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private bed: Bed | null = null
  private wanted: Ambient | undefined
  private current: Ambient | undefined
  muted = false

  /** Called on any user gesture: create the context (allowed now) and start whatever is wanted. */
  unlock(): void {
    if (this.ctx || typeof AudioContext === 'undefined') return
    try {
      this.ctx = new AudioContext()
      this.master = this.ctx.createGain()
      this.master.gain.value = this.muted ? 0 : LEVEL
      this.master.connect(this.ctx.destination)
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : LEVEL, this.ctx.currentTime, 0.2)
    return this.muted
  }

  dispose(): void {
    this.bed?.stop()
    void this.ctx?.close()
    this.ctx = null
  }

  private apply(): void {
    if (!this.ctx || !this.master || this.wanted === this.current) return
    this.bed?.stop()
    this.bed = null
    this.current = this.wanted
    if (this.wanted) this.bed = makeBed(this.ctx, this.master, this.wanted)
  }
}

function noise(ctx: AudioContext, brown: boolean): AudioBufferSourceNode {
  const len = ctx.sampleRate * 4
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
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
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.loop = true
  return src
}

/** One bed: noise → filter → gain, with a slow LFO on the gain (waves, gusts) or the filter. */
function makeBed(ctx: AudioContext, out: AudioNode, kind: Ambient): Bed {
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
