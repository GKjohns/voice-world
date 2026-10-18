/**
 * HUD state shared by the immersive view and the developer view: the dev-mode switch (persisted), the
 * one lifecycle name everything shows (voice, typed intent and the Director's teleport build folded
 * together), and the mic toggle with its browser-speech fallback.
 */
import { shallowRef } from 'vue'
import { useDirector } from './useDirector'

export type HudPhase
  = | 'idle' | 'connecting' | 'listening' | 'hearing' | 'thinking' | 'building' | 'summoning' | 'speaking'

const DEV_KEY = 'voice-world.devHud'
const devMode = shallowRef(false)
let loaded = false

function readDev() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    devMode.value = localStorage.getItem(DEV_KEY) === '1'
  } catch {
    // storage blocked: default to the immersive view
  }
}

function setDev(on: boolean) {
  devMode.value = on
  try {
    localStorage.setItem(DEV_KEY, on ? '1' : '0')
  } catch {
    // not persisted; fine
  }
}

export function useHud() {
  readDev()
  const intent = useIntent()
  const voice = useRealtimeVoice()
  const director = useDirector()
  const toast = useToast()

  const voiceOn = computed(() => voice.status.value === 'live' || voice.status.value === 'connecting')
  const micActive = computed(() => voiceOn.value || intent.micOn.value)
  const summoning = computed(() => director.current.value?.status === 'building')

  /** The whole lifecycle in one word. A Director build reads "summoning" whenever nothing louder is going on. */
  const phase = computed<HudPhase>(() => {
    let p: HudPhase
    if (voiceOn.value) p = voice.status.value === 'connecting' ? 'connecting' : voice.presence.value
    else p = intent.phase.value
    if (summoning.value && (p === 'idle' || p === 'listening')) return 'summoning'
    return p
  })

  function toggleVoice() {
    if (voiceOn.value) return voice.stop()
    if (intent.micOn.value) return intent.stopMic()
    void voice.start((reason) => {
      if (intent.micSupported.value) {
        toast.add({ title: 'Realtime voice unavailable', description: `${reason}. Using browser speech recognition instead (no spoken replies).`, color: 'warning', icon: 'i-lucide-mic' })
        intent.startMic()
      } else {
        toast.add({ title: 'Voice unavailable', description: `${reason}. Type instead.`, color: 'error', icon: 'i-lucide-mic-off' })
      }
    })
  }

  return { devMode, setDev, phase, voiceOn, micActive, summoning, toggleVoice }
}
