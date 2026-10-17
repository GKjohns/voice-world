<script setup lang="ts">
import { summarizeKinds } from '#shared/world/state'

const { state, gaze } = useWorld()
const kinds = computed(() => summarizeKinds(state.value).slice(0, 6))
const gazeText = computed(() => {
  const g = gaze.value
  if (g.kind === 'entity') return `${g.entity} · ${g.dist.toFixed(1)} m`
  if (g.kind === 'sky') return 'sky → 14 m ahead'
  return `ground · ${g.dist.toFixed(1)} m`
})
</script>

<template>
  <div class="pointer-events-none absolute top-4 left-4 flex max-w-[calc(100vw-24rem)] flex-col gap-2">
    <div class="flex items-center gap-2.5 rounded-xl bg-default/70 px-3 py-2 ring ring-default backdrop-blur-md">
      <UIcon
        name="i-lucide-sparkles"
        class="size-4 text-primary"
      />
      <span class="text-sm font-semibold text-highlighted">Conjure</span>
      <span class="text-xs text-muted">{{ state.place }} · {{ state.atmosphere.time }}</span>
      <USeparator
        orientation="vertical"
        class="h-4"
      />
      <span class="font-mono text-xs text-toned">
        <UIcon
          name="i-lucide-crosshair"
          class="mr-1 size-3 align-[-2px]"
        />{{ gazeText }}
      </span>
    </div>
    <div
      v-if="kinds.length"
      class="flex flex-wrap gap-1"
    >
      <span
        v-for="k in kinds"
        :key="k.kind"
        class="rounded-md bg-default/60 px-2 py-0.5 font-mono text-[11px] text-toned ring ring-default backdrop-blur-md"
      >{{ k.kind }} ×{{ k.count }}<span
        v-if="k.learned"
        class="text-primary"
      > learned</span><span
        v-else-if="k.placeholder"
        class="text-warning"
      > ?</span></span>
    </div>
  </div>
</template>
