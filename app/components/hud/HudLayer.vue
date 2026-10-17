<script setup lang="ts">
/**
 * Everything drawn over the world. By default only the presence (orb, captions, the wish field) and two
 * tiny icons; backtick or the corner button brings back the full developer HUD (status, op log, the
 * text bar with its pill, model toggle and raw-op console, the camera panel). The choice persists.
 *
 * The voice and the browser mic live here, not in the dev bar, so switching views never hangs up.
 */
const hud = useHud()
const intent = useIntent()
const voice = useRealtimeVoice()

function toggleDev() {
  hud.setDev(!hud.devMode.value)
}

onMounted(() => intent.detectMic())
onBeforeUnmount(() => {
  intent.stopMic()
  voice.stop()
})
</script>

<template>
  <HudNpc />
  <HudPresence />
  <template v-if="hud.devMode.value">
    <HudStatus />
    <HudLog />
    <HudIntent />
  </template>
  <HudCamera :minimal="!hud.devMode.value" />
  <div class="absolute right-3 bottom-3">
    <UTooltip :content="{ side: 'top' }">
      <template #content>
        <span class="flex items-center gap-1.5">{{ hud.devMode.value ? 'Back to the world' : 'Developer view' }} <UKbd value="`" /></span>
      </template>
      <UButton
        icon="i-lucide-braces"
        color="neutral"
        :variant="hud.devMode.value ? 'soft' : 'ghost'"
        size="xs"
        class="rounded-full"
        :class="hud.devMode.value ? '' : 'text-white/30 hover:text-white/70'"
        aria-label="Toggle developer view"
        data-dev-toggle
        @click="toggleDev"
      />
    </UTooltip>
  </div>
</template>
