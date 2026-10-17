<script setup lang="ts">
/**
 * Dev console (behind the {} toggle on the text bar): raw JSON ops or canned examples, bypassing the
 * model. Every run snapshots the gaze first, exactly as the text bar and the mic do.
 */
import { EXAMPLES } from '~/world/examples'
import type { Example } from '~/world/examples'

const world = useWorld()
const text = ref(formatOps(EXAMPLES[0]!.ops))
const error = ref('')
const file = ref<HTMLInputElement>()

/** One op per line: compact enough to scan, still easy to edit. */
function formatOps(ops: unknown[]): string {
  return `[\n${ops.map(o => `  ${JSON.stringify(o)}`).join(',\n')}\n]`
}

function runText() {
  error.value = ''
  let raw: unknown
  try {
    raw = JSON.parse(text.value)
  } catch (err) {
    error.value = `Not JSON: ${(err as Error).message}`
    return
  }
  const res = world.run(raw, 'typed ops', undefined, { source: 'console' })
  if (!res.ops.length && res.dropped.length) error.value = res.dropped.map(d => d.reason).join('; ')
}

function runExample(ex: Example) {
  error.value = ''
  text.value = formatOps(ex.ops)
  world.run({ ops: ex.ops }, ex.label, undefined, { source: 'console' })
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault()
    runText()
  }
  e.stopPropagation()
}

async function onFile(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  try {
    await world.importFile(f)
  } catch (err) {
    error.value = (err as Error).message
  }
  ;(e.target as HTMLInputElement).value = ''
}

const menu = [[
  { label: 'Export world JSON', icon: 'i-lucide-download', onSelect: () => world.exportFile() },
  { label: 'Import world JSON', icon: 'i-lucide-upload', onSelect: () => file.value?.click() },
  { label: 'New empty world', icon: 'i-lucide-eraser', color: 'error' as const, onSelect: () => world.clear() }
]]
</script>

<template>
  <div class="w-full rounded-xl bg-default/75 p-2.5 ring ring-default backdrop-blur-md">
    <div class="mb-2 flex flex-wrap gap-1">
      <UTooltip
        v-for="ex in EXAMPLES"
        :key="ex.id"
        :text="ex.label"
        :delay-duration="250"
      >
        <UButton
          size="xs"
          :color="ex.id === 'undo' ? 'warning' : 'neutral'"
          variant="soft"
          :label="ex.chip"
          :data-example="ex.id"
          @click="runExample(ex)"
        />
      </UTooltip>
    </div>
    <div class="flex gap-2">
      <UTextarea
        v-model="text"
        class="flex-1"
        :rows="3"
        :maxrows="5"
        autoresize
        spellcheck="false"
        placeholder="[{ &quot;op&quot;: &quot;spawn&quot;, &quot;kind&quot;: &quot;pine&quot;, &quot;count&quot;: 9 }]"
        :ui="{ base: 'font-mono text-xs leading-relaxed' }"
        data-console-input
        @keydown="onKey"
      />
      <div class="flex flex-col gap-1.5">
        <UButton
          icon="i-lucide-play"
          label="Run"
          data-run
          @click="runText"
        />
        <UButton
          icon="i-lucide-undo-2"
          label="Undo"
          color="neutral"
          variant="soft"
          data-undo
          @click="world.undo()"
        />
        <UDropdownMenu :items="menu">
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            aria-label="World menu"
            block
          />
        </UDropdownMenu>
      </div>
    </div>
    <div class="mt-1.5 flex items-center gap-3 text-[11px] text-muted">
      <span
        v-if="error"
        class="truncate text-error"
      >{{ error }}</span>
      <span v-else>drag to look · WASD to walk (shift runs) · double-click locks the mouse</span>
      <span class="ml-auto flex items-center gap-1"><UKbd value="meta" /><UKbd value="enter" /> run · <UKbd value="meta" /><UKbd value="z" /> undo</span>
    </div>
    <input
      ref="file"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="onFile"
    >
  </div>
</template>
