<script setup lang="ts">
/** The op log: every sentence (typed, spoken or from the console), newest first: model, latency, ops, drops and notes. */
import type { Op } from '#shared/world/ops'

const { history } = useWorld()
const open = ref(true)
const entries = computed(() => [...history.value].reverse().slice(0, 60))

function opLine(op: Op): string {
  return JSON.stringify(op, (k, v) => {
    if (k === 'parts' && Array.isArray(v)) return `‹${v.length} parts›`
    return typeof v === 'number' ? Math.round(v * 100) / 100 : v
  })
}
</script>

<template>
  <aside
    class="absolute top-4 right-4 flex max-h-[min(24rem,calc(100vh-15rem))] w-80 flex-col overflow-hidden rounded-xl bg-default/85 ring ring-default backdrop-blur-md"
  >
    <header class="flex items-center gap-2 border-b border-default px-3 py-2">
      <UIcon
        name="i-lucide-layers"
        class="size-4 text-muted"
      />
      <span class="text-sm font-medium text-highlighted">Op log</span>
      <span class="text-xs text-muted">{{ history.length }} batches</span>
      <UButton
        class="ml-auto"
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-label="open ? 'Collapse op log' : 'Expand op log'"
        @click="open = !open"
      />
    </header>
    <div
      v-if="open"
      class="flex-1 space-y-2 overflow-y-auto p-2"
    >
      <p
        v-if="!entries.length"
        class="py-6 text-center text-xs text-muted"
      >
        Nothing yet. Type or say what to build below.
      </p>
      <div
        v-for="h in entries"
        :key="h.n"
        class="rounded-lg bg-muted/50 px-2.5 py-2 ring ring-default/60"
        :class="h.undone ? 'opacity-50' : ''"
      >
        <div class="mb-1 flex items-center gap-1.5">
          <span
            class="truncate text-[13px] text-default"
            :class="h.undone ? 'line-through' : ''"
          >“{{ h.label }}”</span>
          <UBadge
            v-if="h.batchId"
            class="ml-auto shrink-0 font-mono"
            size="sm"
            :color="h.undone ? 'neutral' : 'primary'"
            variant="subtle"
            :label="h.undone ? `${h.batchId} undone` : h.batchId"
          />
        </div>
        <div class="mb-1 flex gap-2 font-mono text-[11px] text-muted">
          <span
            v-if="h.source && h.source !== 'console'"
            class="flex items-center gap-1 text-toned"
          ><UIcon
            :name="h.source === 'voice' ? 'i-lucide-mic' : 'i-lucide-keyboard'"
            class="size-3"
          />{{ h.model ?? '?' }}<template v-if="h.ms !== undefined"> · {{ h.ms }} ms</template></span>
          <span
            v-else-if="h.source === 'console'"
            class="text-dimmed"
          >console</span>
          <span v-if="h.spawned">+{{ h.spawned }}</span>
          <span v-if="h.modified">~{{ h.modified }}</span>
          <span v-if="h.removed">−{{ h.removed }}</span>
        </div>
        <pre
          v-for="(op, i) in h.ops"
          :key="i"
          class="truncate font-mono text-[11px] leading-relaxed text-toned"
          :title="JSON.stringify(op, null, 2)"
        >{{ opLine(op) }}</pre>
        <p
          v-if="h.error"
          class="mt-0.5 font-mono text-[11px] leading-snug text-error"
        >
          {{ h.error }}
        </p>
        <p
          v-for="(d, i) in h.dropped"
          :key="`d${i}`"
          class="mt-0.5 font-mono text-[11px] leading-snug text-warning"
          :title="JSON.stringify(d.raw)"
        >
          dropped #{{ d.index }}: {{ d.reason }}
        </p>
        <p
          v-for="(note, i) in h.notes"
          :key="`n${i}`"
          class="mt-0.5 text-[11px] text-muted italic"
        >
          {{ note }}
        </p>
      </div>
    </div>
  </aside>
</template>
