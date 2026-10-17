<script setup lang="ts">
/**
 * The primary input: a natural-language bar (type, or press the mic) with the listening pill and the
 * builder's caption above it. The gaze is frozen on the first keystroke, so "there" means where you were
 * looking when you started the sentence. The raw-JSON dev console sits behind the {} toggle.
 *
 * The mic button starts the realtime voice (useRealtimeVoice: speak, it calls `build`, it answers). If
 * the realtime session can't connect or drops, it falls back to the browser's speech recognition (the
 * Sprint 2 path: no spoken replies) with a toast.
 */
import type { HudPhase } from '~/composables/useHud'

const world = useWorld()
const intent = useIntent()
const voice = useRealtimeVoice()
const toast = useToast()
const hud = useHud()
const voiceOn = computed(() => voice.status.value === 'live' || voice.status.value === 'connecting')
const text = ref('')
const consoleOpen = ref(false)
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
const captionShown = ref(false)
let captionTimer: ReturnType<typeof setTimeout> | undefined

// A new request replaces the last reply at once, so the caption never answers the wrong sentence.
watch(() => intent.pendingText.value.length, (n) => {
  if (n) captionShown.value = false
})

watch(world.caption, (c) => {
  if (!c) return
  captionShown.value = true
  clearTimeout(captionTimer)
  captionTimer = setTimeout(() => {
    captionShown.value = false
  }, 3600)
})

watch(text, (v, old) => {
  if (v.trim() && !old.trim()) intent.beginTyping()
  else if (!v.trim()) intent.cancelTyping()
})

type PillColor = 'neutral' | 'error' | 'warning' | 'primary' | 'info'
const PILL: Record<HudPhase, { label: string, icon: string, color: PillColor }> = {
  idle: { label: 'ready', icon: 'i-lucide-circle-dot', color: 'neutral' },
  connecting: { label: 'connecting', icon: 'i-lucide-loader-circle', color: 'neutral' },
  listening: { label: 'listening', icon: 'i-lucide-ear', color: 'neutral' },
  hearing: { label: 'hearing', icon: 'i-lucide-audio-lines', color: 'error' },
  thinking: { label: 'thinking', icon: 'i-lucide-loader-circle', color: 'warning' },
  building: { label: 'building', icon: 'i-lucide-hammer', color: 'primary' },
  summoning: { label: 'summoning', icon: 'i-lucide-sparkles', color: 'primary' },
  speaking: { label: 'speaking', icon: 'i-lucide-volume-2', color: 'info' }
}
/** One state name for the pill (and data-phase, for the shoot script): voice, typing and the Director's build (useHud). */
const phaseKey = hud.phase
const pill = computed(() => PILL[phaseKey.value])
const spinning = computed(() => phaseKey.value === 'thinking' || phaseKey.value === 'connecting')
const pulsing = computed(() => ['listening', 'hearing', 'speaking', 'summoning'].includes(phaseKey.value))
const placeholder = computed(() => intent.interim.value
  ? `“${intent.interim.value}…”`
  : voiceOn.value
    ? 'Just talk: “put a bunch of trees over there”, “make them red”…'
    : intent.micOn.value ? 'Listening… say what to build' : 'Say or type what to build: “a bunch of trees over there”')
const micActive = computed(() => voiceOn.value || intent.micOn.value)
const micTip = computed(() => voiceOn.value
  ? 'Hang up the voice'
  : intent.micOn.value ? 'Stop listening (browser speech)' : 'Talk to the builder (realtime voice)')

function toggleVoice() {
  if (voiceOn.value) return voice.stop()
  if (intent.micOn.value) return intent.stopMic()
  void voice.start((reason) => {
    // The realtime voice failed: fall back to the browser's recognizer, which only needs Chrome.
    if (intent.micSupported.value) {
      toast.add({ title: 'Realtime voice unavailable', description: `${reason}. Using browser speech recognition instead (no spoken replies).`, color: 'warning', icon: 'i-lucide-mic' })
      intent.startMic()
    } else {
      toast.add({ title: 'Voice unavailable', description: `${reason}. Type instead.`, color: 'error', icon: 'i-lucide-mic-off' })
    }
  })
}

async function send() {
  const request = text.value.trim()
  if (!request) return
  const ctx = intent.takeSnapshot()
  text.value = ''
  // A person you're facing gets the sentence; world commands still go to the genie (shared/npc/routing.ts).
  await useNpc().say(request, ctx, 'text')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    text.value = ''
    ;(e.target as HTMLElement).blur()
  }
  e.stopPropagation()
}

// Enter anywhere (outside another field) focuses the bar, so you can look, then type.
function onWindowKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.key === 'Enter') {
    e.preventDefault()
    input.value?.inputRef?.focus()
  }
}

onMounted(() => {
  intent.detectMic()
  window.addEventListener('keydown', onWindowKey)
})
onBeforeUnmount(() => {
  // The mic and the voice outlive this bar (HudLayer stops them), so toggling dev mode never hangs up.
  window.removeEventListener('keydown', onWindowKey)
})
</script>

<template>
  <div class="absolute bottom-4 left-1/2 flex w-[min(46rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2">
    <HudVoice v-if="voiceOn" />

    <Transition
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0"
      enter-active-class="transition duration-300"
      leave-active-class="transition duration-150"
    >
      <div
        v-if="intent.pendingText.value.length"
        class="pointer-events-none max-w-full truncate rounded-full bg-default/80 px-4 py-1.5 text-sm text-toned italic ring ring-default backdrop-blur-md"
        data-pending
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="mr-1.5 size-3.5 animate-spin align-[-2px] text-warning"
        />“{{ intent.pendingText.value[intent.pendingText.value.length - 1] }}”
      </div>
      <div
        v-else-if="captionShown && world.caption.value && !voiceOn"
        class="pointer-events-none rounded-full bg-default/80 px-4 py-1.5 text-sm text-highlighted ring ring-default backdrop-blur-md"
        data-caption
      >
        <UIcon
          name="i-lucide-message-circle"
          class="mr-1.5 size-3.5 align-[-2px] text-primary"
        />{{ world.caption.value.text }}
      </div>
    </Transition>

    <HudConsole v-show="consoleOpen" />

    <div class="w-full rounded-2xl bg-default/80 p-2 ring ring-default backdrop-blur-md">
      <form
        class="flex items-center gap-2"
        @submit.prevent="send"
      >
        <UBadge
          :color="pill.color"
          variant="subtle"
          size="lg"
          class="w-28 shrink-0 justify-center"
          data-pill
          :data-phase="phaseKey"
          :data-voice="voice.status.value"
        >
          <UIcon
            :name="pill.icon"
            class="size-4"
            :class="spinning ? 'animate-spin' : pulsing ? 'animate-pulse' : ''"
          />
          {{ pill.label }}
        </UBadge>
        <UInput
          ref="input"
          v-model="text"
          class="flex-1"
          size="xl"
          variant="none"
          :placeholder="placeholder"
          autocomplete="off"
          spellcheck="false"
          data-intent-input
          :ui="{ base: intent.interim.value ? 'placeholder:text-highlighted placeholder:italic' : '' }"
          @keydown="onKey"
        />
        <UTooltip :text="micTip">
          <UButton
            :icon="micActive ? 'i-lucide-mic-off' : 'i-lucide-mic'"
            :color="micActive ? 'error' : 'neutral'"
            :variant="micActive ? 'solid' : 'soft'"
            :loading="voice.status.value === 'connecting'"
            size="lg"
            aria-label="Microphone"
            data-mic
            :data-mic-mode="voiceOn ? 'realtime' : intent.micOn.value ? 'browser' : 'off'"
            @click="toggleVoice()"
          />
        </UTooltip>
        <UButton
          type="submit"
          icon="i-lucide-arrow-up"
          size="lg"
          :disabled="!text.trim()"
          aria-label="Build it"
          data-send
        />
      </form>
      <div class="mt-1 flex items-center gap-3 px-1 text-[11px] text-muted">
        <span
          v-if="intent.error.value"
          class="truncate text-error"
        >{{ intent.error.value }}</span>
        <span v-else>drag to look · WASD to walk · <UKbd value="enter" /> to type · the spot you look at when you start is “there”</span>
        <span class="ml-auto flex shrink-0 items-center gap-1">
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :label="intent.model.value"
            icon="i-lucide-cpu"
            data-model
            @click="intent.model.value = intent.model.value === 'haiku' ? 'sonnet' : 'haiku'"
          />
          <UButton
            size="xs"
            :color="consoleOpen ? 'primary' : 'neutral'"
            :variant="consoleOpen ? 'soft' : 'ghost'"
            icon="i-lucide-braces"
            aria-label="Toggle raw-op console"
            data-console-toggle
            @click="consoleOpen = !consoleOpen"
          />
        </span>
      </div>
    </div>
  </div>
</template>
