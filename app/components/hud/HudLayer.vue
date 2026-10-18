<script setup lang="ts">
/**
 * Everything drawn over the world. By default only the presence (orb, captions, the wish field) and two
 * tiny icons; backtick or the corner button brings back the full developer HUD (status, op log, the
 * text bar with its pill, model toggle and raw-op console, the camera panel). The choice persists.
 *
 * The voice and the browser mic live here, not in the dev bar, so switching views never hangs up.
 * The corner also holds the Fresh switch (useFresh): everything you name is generated live, nothing from
 * the kit or the forge library. `?fresh=1` in the URL turns it on for a recording.
 */
const hud = useHud()
const intent = useIntent()
const voice = useRealtimeVoice()
const world = useWorld()
const confirmReset = ref(false)
const { fresh, setFresh } = useFresh()

/** Start over (the same path as saying "start over"); undo right after brings the old world back. */
function resetWorld() {
  confirmReset.value = false
  world.reset()
}

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
  <HudNpc side />
  <HudPresence />
  <template v-if="hud.devMode.value">
    <HudStatus />
    <HudLog />
    <HudIntent />
  </template>
  <HudCamera :minimal="!hud.devMode.value" />
  <div class="absolute right-3 bottom-3 flex items-center gap-1">
    <UTooltip :content="{ side: 'top' }">
      <template #content>
        <span>{{ fresh ? 'Fresh on: everything you name is generated live' : 'Fresh off: kit things and remembered forgings appear instantly' }}</span>
      </template>
      <UButton
        icon="i-lucide-flame"
        color="neutral"
        :variant="fresh ? 'soft' : 'ghost'"
        size="xs"
        class="rounded-full"
        :class="fresh ? 'text-white/70' : 'text-white/30 hover:text-white/70'"
        :aria-label="fresh ? 'Turn Fresh mode off' : 'Turn Fresh mode on'"
        :aria-pressed="fresh"
        data-fresh-toggle
        :data-fresh="fresh ? 'on' : 'off'"
        @click="setFresh(!fresh)"
      />
    </UTooltip>
    <UPopover
      v-model:open="confirmReset"
      :content="{ side: 'top', align: 'end' }"
    >
      <UButton
        icon="i-lucide-rotate-ccw"
        color="neutral"
        variant="ghost"
        size="xs"
        class="rounded-full text-white/30 hover:text-white/70"
        aria-label="Reset world"
        data-reset
      />
      <template #content>
        <div
          class="flex max-w-56 flex-col gap-2 p-3 text-xs"
          data-reset-confirm
        >
          <p class="font-medium text-highlighted">
            Reset the world?
          </p>
          <p class="text-muted">
            Everything you made, the people and the weather go. <UKbd value="meta" /><UKbd value="z" /> right after brings it back.
          </p>
          <div class="flex justify-end gap-1.5">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="Cancel"
              @click="confirmReset = false"
            />
            <UButton
              size="xs"
              color="error"
              icon="i-lucide-rotate-ccw"
              label="Reset world"
              data-reset-go
              @click="resetWorld"
            />
          </div>
        </div>
      </template>
    </UPopover>
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
