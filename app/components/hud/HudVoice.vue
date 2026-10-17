<script setup lang="ts">
/**
 * Live captions for the realtime voice: what it heard you say (input transcription, which lands a beat
 * after the build call) and what it is saying back. Each fades a few seconds after it last changed.
 */
const voice = useRealtimeVoice()
const showHeard = ref(false)
const showSaid = ref(false)
let heardTimer: ReturnType<typeof setTimeout> | undefined
let saidTimer: ReturnType<typeof setTimeout> | undefined

watch(voice.heard, (t) => {
  clearTimeout(heardTimer)
  showHeard.value = !!t
  if (t) {
    heardTimer = setTimeout(() => {
      showHeard.value = false
    }, 6000)
  }
})
watch(voice.said, (t) => {
  clearTimeout(saidTimer)
  showSaid.value = !!t
  if (t) {
    saidTimer = setTimeout(() => {
      showSaid.value = false
    }, 5000)
  }
})
onBeforeUnmount(() => {
  clearTimeout(heardTimer)
  clearTimeout(saidTimer)
})
</script>

<template>
  <div class="pointer-events-none flex max-w-full flex-col items-center gap-1.5">
    <Transition
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0"
      enter-active-class="transition duration-300"
      leave-active-class="transition duration-500"
    >
      <div
        v-if="showHeard && voice.heard.value"
        class="max-w-full truncate rounded-full bg-default/70 px-3.5 py-1 text-sm text-toned ring ring-default backdrop-blur-md"
        data-voice-heard
      >
        <UIcon
          name="i-lucide-user-round"
          class="mr-1.5 size-3.5 align-[-2px] text-muted"
        />“{{ voice.heard.value }}”
      </div>
    </Transition>
    <Transition
      enter-from-class="opacity-0 translate-y-1"
      leave-to-class="opacity-0"
      enter-active-class="transition duration-300"
      leave-active-class="transition duration-500"
    >
      <div
        v-if="showSaid && voice.said.value"
        class="max-w-full truncate rounded-full bg-default/80 px-3.5 py-1 text-sm text-highlighted ring ring-info/40 backdrop-blur-md"
        data-voice-said
      >
        <UIcon
          name="i-lucide-volume-2"
          class="mr-1.5 size-3.5 align-[-2px] text-info"
        />{{ voice.said.value }}
      </div>
    </Transition>
  </div>
</template>
