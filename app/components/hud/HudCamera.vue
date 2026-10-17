<script setup lang="ts">
/**
 * Hands-free HUD: the camera toggle, a small mirrored preview with face/hand landmarks drawn over it,
 * a status line (head yaw/pitch, pointing) and the pointing reticle (amber) at the pointed spot.
 */
import type { TrackingStatus } from '~/composables/useHeadTracking'

const cam = useHeadTracking()
const toast = useToast()
const videoEl = useTemplateRef<HTMLVideoElement>('video')
const canvasEl = useTemplateRef<HTMLCanvasElement>('overlay')

const busy = computed(() => cam.status.value === 'starting' || cam.status.value === 'loading')
const label = computed(() => {
  const s = cam.status.value
  if (s === 'starting') return 'asking for the camera…'
  if (s === 'loading') return 'loading face + hand models…'
  if (s === 'no-face') return 'no face detected'
  if (s === 'tracking') {
    const fmt = (a: number) => {
      const n = Math.round(a)
      return `${n > 0 ? '+' : ''}${n === 0 ? 0 : n}°`
    }
    return `yaw ${fmt(cam.yaw.value)} · pitch ${fmt(cam.pitch.value)}`
  }
  return ''
})
const reticle = computed(() => {
  const r = cam.pointRay.value
  if (!r) return null
  return { left: `${(r[0] + 1) * 50}%`, top: `${(1 - r[1]) * 50}%` }
})

const MESSAGES: Partial<Record<TrackingStatus, { title: string, description: string }>> = {
  denied: { title: 'Camera blocked', description: 'Allow camera access in the address bar to look and point hands-free. Mouse and WASD still work.' },
  unavailable: { title: 'No camera', description: 'No webcam was found. Mouse and WASD still work.' },
  error: { title: 'Head tracking failed', description: 'The face/hand models could not start. Mouse and WASD still work.' }
}

watch(cam.status, (s) => {
  const m = MESSAGES[s]
  if (m) toast.add({ ...m, description: cam.error.value ? `${cam.error.value} ${m.description}` : m.description, color: 'warning', icon: 'i-lucide-video-off' })
})

watch([cam.stream, videoEl], ([s, v]) => {
  if (v && v.srcObject !== s) {
    v.srcObject = s
    if (s) void v.play().catch(() => {})
  }
})

watch(cam.frame, (f) => {
  const c = canvasEl.value
  if (!c) return
  const w = c.clientWidth
  const h = c.clientHeight
  if (c.width !== w || c.height !== h) {
    c.width = w
    c.height = h
  }
  const g = c.getContext('2d')
  if (!g) return
  g.clearRect(0, 0, w, h)
  const lines = (lm: { x: number, y: number }[], conns: { start: number, end: number }[], color: string) => {
    g.strokeStyle = color
    g.lineWidth = 1.25
    g.beginPath()
    for (const { start, end } of conns) {
      const a = lm[start]
      const b = lm[end]
      if (!a || !b) continue
      g.moveTo(a.x * w, a.y * h)
      g.lineTo(b.x * w, b.y * h)
    }
    g.stroke()
  }
  const dots = (lm: { x: number, y: number }[], color: string, r: number, every = 1) => {
    g.fillStyle = color
    for (let i = 0; i < lm.length; i += every) {
      const p = lm[i]!
      g.beginPath()
      g.arc(p.x * w, p.y * h, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  if (f.face) {
    lines(f.face, cam.connections.value.face, 'rgba(125, 211, 252, 0.9)')
    dots(f.face, 'rgba(125, 211, 252, 0.55)', 0.7, 6)
  }
  if (f.hand) {
    const color = cam.pointing.value ? 'rgba(251, 191, 36, 0.95)' : 'rgba(167, 243, 208, 0.9)'
    lines(f.hand, cam.connections.value.hand, color)
    dots(f.hand, color, 2)
  }
})

onBeforeUnmount(() => cam.disable())
</script>

<template>
  <div
    v-if="reticle"
    class="pointer-events-none absolute size-5 -translate-1/2 rounded-full border-2 border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.8)]"
    :style="reticle"
    data-pointing-reticle
  />
  <div class="absolute bottom-4 left-4 flex flex-col items-start gap-2">
    <div
      v-if="cam.enabled.value"
      class="relative w-[200px] overflow-hidden rounded-xl bg-black/60 ring ring-default backdrop-blur-md"
      data-camera-preview
    >
      <div class="relative aspect-[4/3] w-full -scale-x-100">
        <video
          ref="video"
          class="absolute inset-0 size-full object-cover"
          muted
          playsinline
        />
        <canvas
          ref="overlay"
          class="absolute inset-0 size-full"
        />
      </div>
      <div
        v-if="busy"
        class="absolute inset-0 flex items-center justify-center"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-6 animate-spin text-muted"
        />
      </div>
      <div class="flex items-center gap-1.5 px-2 py-1.5 font-mono text-[11px] text-toned">
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="cam.status.value === 'tracking' ? 'bg-success' : busy ? 'bg-info' : 'bg-warning'"
        />
        <span
          class="truncate"
          data-camera-status
        >{{ label }}</span>
        <span
          v-if="cam.pointing.value"
          class="ml-auto shrink-0 text-amber-400"
        >pointing</span>
      </div>
    </div>
    <div class="flex items-center gap-1.5">
      <UTooltip :text="cam.enabled.value ? 'Turn the camera off' : 'Look and point with your webcam'">
        <UButton
          :icon="cam.enabled.value ? 'i-lucide-video' : 'i-lucide-video-off'"
          :color="cam.enabled.value ? 'primary' : 'neutral'"
          :variant="cam.enabled.value ? 'solid' : 'soft'"
          :loading="busy"
          size="sm"
          :aria-label="cam.enabled.value ? 'Turn the camera off' : 'Turn the camera on'"
          data-camera-toggle
          @click="cam.toggle()"
        />
      </UTooltip>
      <UTooltip
        v-if="cam.enabled.value"
        text="Recenter: look at the middle of the screen, then click"
      >
        <UButton
          icon="i-lucide-locate-fixed"
          color="neutral"
          variant="soft"
          size="sm"
          aria-label="Recenter head tracking"
          :disabled="cam.status.value !== 'tracking' && cam.status.value !== 'no-face'"
          data-camera-recenter
          @click="cam.recenter()"
        />
      </UTooltip>
    </div>
  </div>
</template>
