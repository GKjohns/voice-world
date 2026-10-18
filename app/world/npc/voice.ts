/**
 * A person's voice: lines queue up, each fetched as gateway speech (/api/npc/voice) while the previous one
 * plays, with the browser's own speech as the fallback. Every person keeps the same voice, pitched and paced
 * per role (a child high and quick, an elder low and slow), and gets quieter with distance.
 */
import type { Persona } from '#shared/npc/persona'
import { NPC_VOICES, rolePreset } from '#shared/npc/people'
import { hash01 } from '#shared/hash'

interface Segment { text: string, audio: Promise<HTMLAudioElement | null> }

/** Let a line's audio go: detach the element from its blob first (revoking a loaded src logs a load error). */
function release(a: HTMLAudioElement | null) {
  if (!a) return
  const src = a.src
  a.pause()
  a.onerror = null
  a.removeAttribute('src')
  a.load()
  URL.revokeObjectURL(src)
}

export class VoiceQueue {
  private queue: Segment[] = []
  private playing = false
  private current: HTMLAudioElement | null = null
  stopped = false
  onFirstAudio?: () => void
  onIdle?: () => void

  /** `distance` is how far they are from the player now (Infinity if unknown), read per line for its volume. */
  constructor(private readonly id: string, private readonly persona: Persona, private readonly distance: () => number) {}

  /** The gateway voice this person always speaks with. */
  get voiceName(): string {
    const list = NPC_VOICES[this.persona.voice]
    return list[Math.floor(hash01(this.id, 'voice') * list.length) % list.length]!
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
      const res = await fetch('/api/npc/voice', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: this.voiceName, speed: preset === 'elder' ? 0.9 : preset === 'child' ? 1.12 : 1 }) })
      if (res.status !== 200) return null
      const blob = await res.blob()
      const a = new Audio(URL.createObjectURL(blob))
      a.preload = 'auto'
      return a
    } catch {
      return null
    }
  }

  /** Quieter with distance; full volume when we can't tell where they are. */
  private volume(): number {
    const d = this.distance()
    if (!Number.isFinite(d)) return 1
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
    if (this.stopped) {
      release(audio)
      return
    }
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
      u.rate = preset === 'elder' ? 0.85 : preset === 'child' ? 1.15 : 0.95 + hash01(this.id, 'rate') * 0.15
      u.volume = this.volume()
      const voices = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
      if (voices.length) u.voice = voices[Math.floor(hash01(this.id, 'bv') * voices.length) % voices.length]!
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
    // Lines fetched but never played: let their audio go.
    for (const seg of this.queue) void seg.audio.then(release)
    this.queue = []
    release(this.current)
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
    this.playing = false
    this.onIdle?.()
  }

  get active() {
    return this.playing || this.queue.length > 0
  }
}
