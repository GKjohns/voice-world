<script setup lang="ts">
/**
 * The immersive HUD: the orb, captions that drift up above it and fade, a text field that only appears
 * when you start typing (or click the orb), the tiny mic icon, and the first-run whisper on an empty
 * world. Stays mounted in developer mode for its keys (backtick), but draws nothing there.
 *
 * Keys: any printable key except the walk/mute keys (W A S D M) starts a sentence with that letter;
 * Enter or / opens the field empty; Esc clears and closes it; ` toggles developer mode.
 */
const world = useWorld()
const intent = useIntent()
const voice = useRealtimeVoice()
const hud = useHud()

const text = ref('')
const inputOpen = ref(false)
const input = useTemplateRef<{ inputRef?: HTMLInputElement }>('input')
const RESERVED = new Set(['w', 'a', 's', 'd', 'm', ' '])

// ---------- captions ----------
const userLine = ref('')
const genieLine = ref('')
const genieTone = ref<'genie' | 'error'>('genie')
let userTimer: ReturnType<typeof setTimeout> | undefined
let genieTimer: ReturnType<typeof setTimeout> | undefined

function showUser(t: string, ms = 6000) {
  clearTimeout(userTimer)
  userLine.value = t
  if (t) {
    userTimer = setTimeout(() => {
      userLine.value = ''
    }, ms)
  }
}
function showGenie(t: string, tone: 'genie' | 'error' = 'genie', ms = 4800) {
  clearTimeout(genieTimer)
  genieLine.value = t
  genieTone.value = tone
  if (t) {
    genieTimer = setTimeout(() => {
      genieLine.value = ''
    }, ms)
  }
}

// A new wish replaces the last answer at once, so the caption never answers the wrong sentence.
watch(() => intent.pendingText.value, (list, old) => {
  const latest = list[list.length - 1]
  if (latest && list.length >= (old?.length ?? 0)) {
    showUser(latest, 60_000)
    showGenie('')
  } else if (!list.length) {
    showUser(userLine.value, 4000)
  }
})
watch(world.caption, (c) => {
  if (c && !hud.voiceOn.value) showGenie(c.text)
})
watch(voice.heard, t => showUser(t))
watch(voice.said, t => showGenie(t, 'genie', 5200))
watch(intent.error, e => e && showGenie(e, 'error', 6000))

// ---------- the text field ----------
watch(text, (v, old) => {
  if (v.trim() && !old.trim()) intent.beginTyping()
  else if (!v.trim()) intent.cancelTyping()
})

async function openInput(seed = '') {
  inputOpen.value = true
  if (seed) text.value += seed
  await nextTick()
  input.value?.inputRef?.focus()
}
function closeInput() {
  inputOpen.value = false
  input.value?.inputRef?.blur()
}
function onBlur() {
  if (!text.value.trim()) inputOpen.value = false
}

async function send() {
  const request = text.value.trim()
  if (!request) return
  const ctx = intent.takeSnapshot()
  text.value = ''
  closeInput()
  await intent.build(request, ctx, 'text')
}

function onInputKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    text.value = ''
    closeInput()
  }
  e.stopPropagation()
}

function onWindowKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === '`') {
    e.preventDefault()
    hud.setDev(!hud.devMode.value)
    return
  }
  if (hud.devMode.value) return
  if (e.key === 'Enter' || e.key === '/') {
    e.preventDefault()
    void openInput()
  } else if (e.key.length === 1 && !RESERVED.has(e.key.toLowerCase())) {
    e.preventDefault()
    void openInput(e.key)
  }
}

// ---------- first run ----------
const firstRun = computed(() => !world.state.value.entities.length && !world.state.value.log.length)
const showWhisper = computed(() => firstRun.value && !intent.pendingText.value.length && !text.value)

function onOrb() {
  if (inputOpen.value) closeInput()
  else void openInput()
}

onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onWindowKey)
  clearTimeout(userTimer)
  clearTimeout(genieTimer)
})
</script>

<template>
  <div
    v-if="!hud.devMode.value"
    class="pointer-events-none absolute inset-0"
  >
    <Transition
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
      enter-active-class="transition-opacity duration-[2400ms] delay-700"
      leave-active-class="transition-opacity duration-1000"
    >
      <div
        v-if="showWhisper"
        class="absolute inset-x-4 top-[30%] flex flex-col items-center gap-3 text-center"
        data-onboarding
      >
        <p class="hud-glow font-display text-4xl font-light tracking-wide text-white/85 italic sm:text-5xl">
          Speak, and it shall be.
        </p>
        <p class="hud-glow font-display text-xl text-white/60">
          Try: “raise a castle on a hill”
        </p>
        <p class="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs tracking-wide text-white/45">
          just start typing · tap the
          <UIcon
            name="i-lucide-mic"
            class="size-3.5"
          />
          to speak · drag to look ·
          <UKbd
            value="W A S D"
            size="sm"
            variant="subtle"
            class="bg-white/5 text-white/55 ring-white/10"
          />
          to walk
        </p>
      </div>
    </Transition>

    <div class="absolute bottom-5 left-1/2 flex w-[min(44rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center">
      <div
        class="relative flex min-h-24 w-full flex-col items-center justify-end gap-1.5 pb-4 text-center transition-opacity duration-300"
        :class="inputOpen ? 'opacity-0' : 'opacity-100'"
      >
        <Transition
          enter-from-class="opacity-0 translate-y-2 blur-sm"
          leave-to-class="opacity-0 -translate-y-1 blur-sm"
          enter-active-class="transition duration-500"
          leave-active-class="transition duration-[1200ms]"
          mode="out-in"
        >
          <p
            v-if="userLine"
            :key="userLine"
            class="hud-glow line-clamp-2 max-w-full font-display text-xl text-white/70 italic"
            data-caption-user
          >
            “{{ userLine }}”
          </p>
        </Transition>
        <Transition
          enter-from-class="opacity-0 translate-y-2 blur-sm"
          leave-to-class="opacity-0 -translate-y-1 blur-sm"
          enter-active-class="transition duration-700"
          leave-active-class="transition duration-[1600ms]"
          mode="out-in"
        >
          <p
            v-if="genieLine"
            :key="genieLine"
            class="hud-glow line-clamp-2 max-w-full font-display text-2xl leading-snug sm:text-[1.7rem]"
            :class="genieTone === 'error' ? 'text-rose-200/80' : 'text-amber-50'"
            data-caption
          >
            {{ genieLine }}
          </p>
        </Transition>
      </div>

      <!-- Sits over the caption area (captions hide while you compose); invisible but clickable when closed. -->
      <div
        class="pointer-events-auto absolute bottom-[4.75rem] w-[min(32rem,100%)] transition duration-500"
        :class="inputOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'"
      >
        <form
          class="rounded-full bg-black/30 px-3 ring-1 ring-white/12 backdrop-blur-md"
          @submit.prevent="send"
        >
          <UInput
            ref="input"
            v-model="text"
            class="w-full"
            size="xl"
            variant="none"
            placeholder="Speak your wish…"
            autocomplete="off"
            spellcheck="false"
            data-intent-input
            :ui="{ base: 'text-center font-display text-xl text-white placeholder:text-white/35 placeholder:italic' }"
            @focus="inputOpen = true"
            @blur="onBlur"
            @keydown="onInputKey"
          />
        </form>
      </div>

      <div class="pointer-events-auto relative flex items-center">
        <HudOrb
          :phase="hud.phase.value"
          data-pill
          :data-phase="hud.phase.value"
          :data-voice="voice.status.value"
          @activate="onOrb"
        />
        <UTooltip :text="hud.voiceOn.value ? 'Hang up the voice' : intent.micOn.value ? 'Stop listening' : 'Speak (realtime voice)'">
          <UButton
            icon="i-lucide-mic"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="voice.status.value === 'connecting'"
            class="absolute left-full ml-1 rounded-full transition"
            :class="hud.micActive.value ? 'text-sky-200 opacity-90' : 'text-white/40 opacity-70 hover:opacity-100'"
            aria-label="Microphone"
            data-mic
            :data-mic-mode="hud.voiceOn.value ? 'realtime' : intent.micOn.value ? 'browser' : 'off'"
            @click="hud.toggleVoice()"
          />
        </UTooltip>
      </div>
    </div>
  </div>
</template>
