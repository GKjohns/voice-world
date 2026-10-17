<script setup lang="ts">
/**
 * The presence: one glowing orb at the bottom of the world. It breathes when idle, swells and ripples
 * with your voice (a real mic analyser while the realtime voice is live), swirls while thinking, flares
 * when building, wears a turning sigil while the Director summons a place, and pulses while the genie
 * speaks. Drawn on a small 2D canvas; every visual parameter eases toward its state's target.
 */
import type { HudPhase } from '~/composables/useHud'

const props = defineProps<{ phase: HudPhase }>()
defineEmits<{ activate: [] }>()

const voice = useRealtimeVoice()
const canvasEl = useTemplateRef<HTMLCanvasElement>('canvas')

const SIZE = 168
type RGB = [number, number, number]
interface Look { color: RGB, r: number, glow: number, swirl: number, sigil: number, breath: number }
const LOOKS: Record<HudPhase, Look> = {
  idle: { color: [255, 214, 150], r: 14, glow: 0.7, swirl: 0, sigil: 0, breath: 1 },
  connecting: { color: [170, 190, 230], r: 11, glow: 0.35, swirl: 0.35, sigil: 0, breath: 0.6 },
  listening: { color: [190, 225, 255], r: 14, glow: 0.7, swirl: 0, sigil: 0, breath: 0.8 },
  hearing: { color: [215, 240, 255], r: 16, glow: 0.95, swirl: 0, sigil: 0, breath: 0.2 },
  thinking: { color: [196, 170, 255], r: 13, glow: 0.8, swirl: 1, sigil: 0, breath: 0.3 },
  building: { color: [255, 196, 110], r: 18, glow: 1.25, swirl: 0.25, sigil: 0.4, breath: 0 },
  summoning: { color: [255, 205, 120], r: 16, glow: 1.1, swirl: 0.55, sigil: 1, breath: 0.3 },
  speaking: { color: [160, 240, 225], r: 15, glow: 0.95, swirl: 0, sigil: 0, breath: 0 }
}

const cur: Look = { ...LOOKS.idle, color: [...LOOKS.idle.color] }
const rings: { age: number, life: number, strength: number }[] = []
let raf = 0
let last = 0
let lastRing = 0
let level = 0
let audio: { ctx: AudioContext, an: AnalyserNode, buf: Uint8Array<ArrayBuffer> } | null = null

watch(() => voice.micStream.value, (s) => {
  void audio?.ctx.close().catch(() => {})
  audio = null
  if (!s) return
  try {
    const ctx = new AudioContext()
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(s).connect(an)
    audio = { ctx, an, buf: new Uint8Array(an.fftSize) }
  } catch {
    // no analyser: the orb animates on the hearing state alone
  }
}, { immediate: true })

// A flare the moment something starts arriving.
watch(() => props.phase, (p, old) => {
  if ((p === 'building' || p === 'summoning') && old !== p) {
    rings.push({ age: 0, life: 1.1, strength: 1.2 }, { age: -0.18, life: 1.3, strength: 0.8 })
  }
})

function micLevel(): number {
  if (!audio) return 0
  audio.an.getByteTimeDomainData(audio.buf)
  let sum = 0
  for (const v of audio.buf) {
    const x = (v - 128) / 128
    sum += x * x
  }
  return Math.min(1, Math.sqrt(sum / audio.buf.length) * 5)
}

function frame(now: number) {
  raf = requestAnimationFrame(frame)
  const c = canvasEl.value
  if (!c) return
  const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016)
  last = now
  const t = now / 1000
  const target = LOOKS[props.phase]
  const k = 1 - Math.exp(-dt * 5)
  for (let i = 0; i < 3; i++) cur.color[i]! += (target.color[i]! - cur.color[i]!) * k
  cur.r += (target.r - cur.r) * k
  cur.glow += (target.glow - cur.glow) * k
  cur.swirl += (target.swirl - cur.swirl) * k
  cur.sigil += (target.sigil - cur.sigil) * k
  cur.breath += (target.breath - cur.breath) * k

  // Voice energy: the mic while you talk, a speech-like envelope while the genie talks.
  let raw = 0
  if (props.phase === 'hearing') raw = audio ? micLevel() : 0.45 + 0.35 * Math.abs(Math.sin(t * 7.3) * Math.sin(t * 3.1))
  else if (props.phase === 'listening' && audio) raw = micLevel() * 0.5
  else if (props.phase === 'speaking') raw = 0.35 + 0.45 * Math.abs(Math.sin(t * 9.1) * Math.sin(t * 2.3 + 1))
  level += (raw - level) * (1 - Math.exp(-dt * (raw > level ? 18 : 6)))

  if ((props.phase === 'hearing' || props.phase === 'speaking') && level > 0.25 && t - lastRing > 0.32 - level * 0.15) {
    rings.push({ age: 0, life: 1.2, strength: 0.4 + level * 0.6 })
    lastRing = t
  } else if (props.phase === 'idle' && t - lastRing > 5.5) {
    rings.push({ age: 0, life: 2.6, strength: 0.25 })
    lastRing = t
  } else if (props.phase === 'summoning' && t - lastRing > 0.9) {
    rings.push({ age: 0, life: 1.6, strength: 0.55 })
    lastRing = t
  }

  const dpr = window.devicePixelRatio || 1
  if (c.width !== SIZE * dpr) {
    c.width = SIZE * dpr
    c.height = SIZE * dpr
  }
  const g = c.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, SIZE, SIZE)
  g.globalCompositeOperation = 'lighter'
  const cx = SIZE / 2
  const cy = SIZE / 2
  const [cr, cg, cb] = cur.color.map(Math.round) as RGB
  const rgba = (a: number) => `rgba(${cr},${cg},${cb},${Math.max(0, a)})`
  const breath = 1 + cur.breath * 0.09 * Math.sin(t * 1.6)
  const R = cur.r * breath * (1 + level * 0.45)

  // Halo.
  const halo = g.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 4.2)
  halo.addColorStop(0, rgba(0.4 * cur.glow))
  halo.addColorStop(0.3, rgba(0.14 * cur.glow))
  halo.addColorStop(1, rgba(0))
  g.fillStyle = halo
  g.fillRect(0, 0, SIZE, SIZE)

  // Ripples.
  for (let i = rings.length - 1; i >= 0; i--) {
    const ring = rings[i]!
    ring.age += dt
    if (ring.age > ring.life) {
      rings.splice(i, 1)
      continue
    }
    if (ring.age < 0) continue
    const p = ring.age / ring.life
    g.strokeStyle = rgba((1 - p) * (1 - p) * 0.7 * ring.strength)
    g.lineWidth = 1.4 * (1 - p) + 0.3
    g.beginPath()
    g.arc(cx, cy, R * (1.1 + p * 3.6), 0, Math.PI * 2)
    g.stroke()
  }

  // Swirl: motes on tilted orbits, each with a short fading trail.
  if (cur.swirl > 0.02) {
    for (let m = 0; m < 5; m++) {
      const speed = 2.2 + m * 0.37
      const rad = R * (1.55 + 0.22 * Math.sin(m * 2.1))
      for (let s = 0; s < 9; s++) {
        const a = t * speed + m * 1.26 - s * 0.07
        const x = cx + Math.cos(a) * rad
        const y = cy + Math.sin(a) * rad * (0.55 + 0.1 * m)
        g.fillStyle = rgba(cur.swirl * (1 - s / 9) * 0.85)
        g.beginPath()
        g.arc(x, y, 1.6 * (1 - s / 12), 0, Math.PI * 2)
        g.fill()
      }
    }
  }

  // Sigil: a turning ring of ticks and an inner counter-rotating triangle pair.
  if (cur.sigil > 0.02) {
    const sr = R * 2.3
    g.strokeStyle = rgba(cur.sigil * 0.55)
    g.lineWidth = 0.8
    g.beginPath()
    g.arc(cx, cy, sr, 0, Math.PI * 2)
    g.stroke()
    for (let i = 0; i < 24; i++) {
      const a = t * 0.5 + (i / 24) * Math.PI * 2
      const len = i % 3 === 0 ? 5 : 2.5
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * sr, cy + Math.sin(a) * sr)
      g.lineTo(cx + Math.cos(a) * (sr + len), cy + Math.sin(a) * (sr + len))
      g.stroke()
    }
    for (const dir of [1, -1]) {
      g.beginPath()
      for (let i = 0; i <= 3; i++) {
        const a = dir * t * 0.8 + (i / 3) * Math.PI * 2 + (dir < 0 ? Math.PI : 0)
        const x = cx + Math.cos(a) * sr * 0.78
        const y = cy + Math.sin(a) * sr * 0.78
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.strokeStyle = rgba(cur.sigil * 0.3)
      g.stroke()
    }
  }

  // Core: a softly wobbling sphere, white-hot in the middle.
  g.beginPath()
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const wob = 1 + 0.04 * Math.sin(a * 3 + t * 2.1) + 0.03 * Math.sin(a * 5 - t * 1.7) + level * 0.08 * Math.sin(a * 7 + t * 9)
    const x = cx + Math.cos(a) * R * wob
    const y = cy + Math.sin(a) * R * wob
    if (i) g.lineTo(x, y)
    else g.moveTo(x, y)
  }
  const core = g.createRadialGradient(cx - R * 0.25, cy - R * 0.3, 0, cx, cy, R * 1.05)
  core.addColorStop(0, `rgba(255,255,255,${0.95 * Math.min(1, cur.glow + 0.2)})`)
  core.addColorStop(0.45, rgba(0.75 * Math.min(1.2, cur.glow)))
  core.addColorStop(1, rgba(0.05))
  g.fillStyle = core
  g.fill()
  g.globalCompositeOperation = 'source-over'
}

onMounted(() => {
  raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  void audio?.ctx.close().catch(() => {})
  audio = null
})
</script>

<template>
  <button
    type="button"
    class="relative size-16 cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-white/30"
    aria-label="Speak your wish"
    data-orb
    @click="$emit('activate')"
  >
    <canvas
      ref="canvas"
      class="pointer-events-none absolute top-1/2 left-1/2 block size-[168px] -translate-1/2"
    />
  </button>
</template>
