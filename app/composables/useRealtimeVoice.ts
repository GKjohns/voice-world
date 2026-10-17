/**
 * Realtime voice (Sprint 3, V1): gpt-realtime-mini through the AI Gateway is the ears and the mouth, with
 * exactly one tool, `build({ request })`. Ported from camera_shy's `useCameraShyRealtime`, minus the
 * recording seam, the Director and the watchdog.
 *
 *   speech-started  → `useIntent().capture()` (freeze the gaze, show the ghost) and stash it
 *   build tool call → `useIntent().build(request, stashedCtx, 'voice')` → `{ result: summary, hint: say }`
 *   tool output     → the SDK sends it and asks for the spoken confirmation itself
 *
 * Barge-in is native (server VAD + the SDK truncating playback on speech-started). Tools come back from
 * the token route because `connect()` overwrites `sessionConfig.tools` with that list; nothing here ever
 * sends a `session-update`, so there is no `baseConfig` to clobber them.
 *
 * Audio: the SDK's own BrowserRealtimeAudio (no recording, so no audio seam). We hand it our own mic
 * stream so echo cancellation is on (speaker bleed would otherwise barge in on the voice itself) and AGC
 * is off (it pumps room noise over the VAD threshold), the two capture lessons from Camera Shy.
 */
import { gateway } from '@ai-sdk/gateway'
import { Experimental_AbstractRealtimeSession } from 'ai'
import type { Experimental_RealtimeServerEvent as RealtimeServerEvent, Experimental_RealtimeState as RealtimeState } from 'ai'
import { shallowRef } from 'vue'
import { BUILD_TOOL, VOICE_MODEL, voiceSessionConfig } from '#shared/voice'
import type { OpContext } from '#shared/world/types'

export type VoiceStatus = 'off' | 'connecting' | 'live' | 'error'
/** What the pill shows while live. `listening` = connected and quiet. */
export type VoicePresence = 'listening' | 'hearing' | 'thinking' | 'building' | 'speaking'

const WIRE_SAMPLE_RATE = 24_000
const CONNECT_TIMEOUT_MS = 10_000
/** An open mic with nobody talking still streams audio; hang up after this long without speech. */
const IDLE_HANGUP_MS = 4 * 60_000

const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: false, channelCount: 1 }

class VoiceSession extends Experimental_AbstractRealtimeSession {
  constructor(
    options: ConstructorParameters<typeof Experimental_AbstractRealtimeSession>[0],
    private readonly sink: <K extends keyof RealtimeState>(key: K, value: RealtimeState[K]) => void
  ) {
    super(options)
  }

  protected setState<K extends keyof RealtimeState>(key: K, value: RealtimeState[K]): void {
    this.sink(key, value)
  }
}

export interface VoiceTiming {
  request: string
  /** VAD speech-stopped → the build tool call arrived (realtime model time; VAD's own silence window is before this). */
  vadToToolMs?: number
  /** Tool call → ops applied (the /api/intent round trip). */
  toolToBuiltMs?: number
}

// Module scope, like useIntent: one voice per tab.
const status = shallowRef<VoiceStatus>('off')
const userSpeaking = shallowRef(false)
const responsePending = shallowRef(false)
const isPlaying = shallowRef(false)
const toolBusy = shallowRef(0)
/** Captions: what the user said (input transcription) and what the voice is saying. */
const heard = shallowRef('')
const said = shallowRef('')
const lastTiming = shallowRef<VoiceTiming | null>(null)
const toolCalls = shallowRef(0)
const lastError = shallowRef('')

let session: VoiceSession | null = null
let stream: MediaStream | null = null
let stashedCtx: OpContext | null = null
let speechStoppedAt = 0
let connectTimer: ReturnType<typeof setTimeout> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let failHandler: ((reason: string) => void) | null = null
const saidByItem = new Map<string, string>()

const presence = computed<VoicePresence>(() => {
  if (isPlaying.value) return 'speaking'
  if (userSpeaking.value) return 'hearing'
  if (toolBusy.value) return useIntent().phase.value === 'building' ? 'building' : 'thinking'
  if (useIntent().phase.value === 'building') return 'building'
  if (responsePending.value) return 'thinking'
  return 'listening'
})

function armIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (status.value === 'live') stop()
  }, IDLE_HANGUP_MS)
}

function handleEvent(event: RealtimeServerEvent) {
  switch (event.type) {
    case 'session-updated':
      if (status.value === 'connecting') {
        clearTimeout(connectTimer)
        status.value = 'live'
        armIdle()
      }
      break
    case 'speech-started':
      // The deictic moment: "there" is where you were looking when you started talking.
      stashedCtx = useIntent().capture()
      userSpeaking.value = true
      heard.value = ''
      armIdle()
      break
    case 'speech-stopped':
      userSpeaking.value = false
      speechStoppedAt = performance.now()
      break
    case 'input-transcription-completed':
      heard.value = (event.transcript ?? '').trim()
      break
    case 'response-created':
      responsePending.value = true
      break
    case 'response-done':
      responsePending.value = false
      break
    case 'audio-transcript-delta': {
      const text = (saidByItem.get(event.itemId) ?? '') + event.delta
      saidByItem.set(event.itemId, text)
      said.value = text
      break
    }
    case 'audio-transcript-done':
      if (event.transcript) said.value = event.transcript
      saidByItem.delete(event.itemId)
      break
    case 'error':
      // One response failed; the socket is still up.
      console.warn('[voice] realtime error event:', event.message)
      break
  }
}

async function onToolCall({ toolCall }: { toolCall: { toolCallId: string, toolName: string, args: unknown } }) {
  const calledAt = performance.now()
  toolCalls.value++
  if (toolCall.toolName !== BUILD_TOOL.name) return { error: `unknown tool ${toolCall.toolName}` }
  const args = (typeof toolCall.args === 'string' ? safeJson(toolCall.args) : toolCall.args) as { request?: unknown } | null
  const request = typeof args?.request === 'string' ? args.request : ''
  if (!request.trim()) return { result: 'nothing changed (empty request)' }
  const intent = useIntent()
  // Several calls in one response ("trees, and a house") share the same speech-start snapshot.
  const ctx = stashedCtx ?? intent.capture()
  const timing: VoiceTiming = { request, vadToToolMs: speechStoppedAt ? Math.round(calledAt - speechStoppedAt) : undefined }
  toolBusy.value++
  try {
    const out = await intent.build(request, ctx, 'voice')
    timing.toolToBuiltMs = Math.round(performance.now() - calledAt)
    lastTiming.value = timing
    console.info(`[voice] build “${request}” vad→tool ${timing.vadToToolMs ?? '?'} ms, tool→built ${timing.toolToBuiltMs} ms: ${out.summary}`)
    return out.say ? { result: out.summary, hint: `the builder suggests saying: ${out.say}` } : { result: out.summary }
  } finally {
    toolBusy.value--
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function fail(reason: string) {
  // Status first: teardown re-enters through the SDK's state sink, and that must be a no-op.
  if (status.value !== 'live' && status.value !== 'connecting') return
  status.value = 'error'
  lastError.value = reason
  teardown()
  const handler = failHandler
  failHandler = null
  handler?.(reason)
}

/**
 * Start the realtime voice. `onFail` runs once if connecting fails or the socket drops while live, so the
 * HUD can fall back to the browser mic. Must be called from a click (AudioContext needs the gesture).
 */
async function start(onFail?: (reason: string) => void) {
  if (status.value === 'connecting' || status.value === 'live') return
  failHandler = onFail ?? null
  lastError.value = ''
  heard.value = ''
  said.value = ''
  status.value = 'connecting'
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: MIC })
  } catch (err) {
    fail(`mic blocked (${(err as Error).name || 'error'})`)
    return
  }
  const live = new VoiceSession(
    {
      model: gateway.experimental_realtime(VOICE_MODEL),
      // A path, not a token: connect() POSTs { sessionConfig } here and gets { token, url, tools } back.
      api: { token: '/api/realtime/token' },
      sessionConfig: voiceSessionConfig(),
      sampleRate: WIRE_SAMPLE_RATE,
      startupTimeoutMs: CONNECT_TIMEOUT_MS,
      onEvent: handleEvent,
      onToolCall,
      onError: (err) => {
        console.warn('[voice] realtime error:', err.message)
        if (status.value === 'connecting') fail(err.message)
      }
    },
    (key, value) => {
      if (key === 'isPlaying') isPlaying.value = value as boolean
      if (key === 'status') {
        // Deferred: the SDK flips status before it reports the error, and onError carries the real reason.
        if (value === 'error') setTimeout(() => fail('connection error'), 0)
        else if (value === 'disconnected' && status.value === 'live') fail('connection closed')
      }
    }
  )
  session = live
  connectTimer = setTimeout(() => {
    if (status.value === 'connecting') fail('timed out connecting')
  }, CONNECT_TIMEOUT_MS + 500)
  await live.connect()
  if (session !== live || !stream) return
  live.startAudioCapture(stream)
}

function teardown() {
  clearTimeout(connectTimer)
  clearTimeout(idleTimer)
  const s = session
  session = null
  try {
    s?.dispose()
  } catch {
    // already gone
  }
  stream?.getTracks().forEach(t => t.stop())
  stream = null
  stashedCtx = null
  userSpeaking.value = false
  responsePending.value = false
  isPlaying.value = false
  saidByItem.clear()
}

function stop() {
  failHandler = null
  status.value = 'off'
  teardown()
}

/** A read-only handle for the headless voice check (scripts/voice-shoot.mjs) and devtools. */
function exposeHandle() {
  const w = window as unknown as Record<string, unknown>
  w.__conjureVoice ??= {
    status: () => status.value,
    presence: () => presence.value,
    heard: () => heard.value,
    said: () => said.value,
    timing: () => lastTiming.value,
    toolCalls: () => toolCalls.value,
    snapshot: () => stashedCtx?.gaze.point ?? null,
    error: () => lastError.value
  }
}

export function useRealtimeVoice() {
  if (import.meta.client) exposeHandle()
  return {
    status, presence, userSpeaking, isPlaying, heard, said, lastTiming, toolCalls, lastError,
    start, stop
  }
}
