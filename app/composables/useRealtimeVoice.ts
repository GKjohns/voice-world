/**
 * Realtime voice (Sprint 3, V1; Loop 1): gpt-realtime-mini through the AI Gateway is the ears and the mouth
 * (a genie persona, shared/voice.ts), with two tools: `build({ request })` and `teleport({ world, brief })`. Ported from camera_shy's `useCameraShyRealtime`, minus the
 * recording seam, the Director and the watchdog.
 *
 *   speech-started  → `useIntent().capture()` (freeze the gaze, show the ghost) and stash it
 *   build tool call → `useIntent().build(request, stashedCtx, 'voice')` → `{ outcome, result, notes?, dropped? }`
 *   teleport call   → a teleport batch through `useWorld().run` → the Director starts at once
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
import { ACK_INSTRUCTIONS, BUILD_TOOL, TELEPORT_TOOL, VOICE_MODEL, voiceSessionConfig } from '#shared/voice'
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
  /** Tool call → the first op applied in the world (streamed intent ops, or the Director's first op). */
  toolToFirstOpMs?: number
  /** Tool call → the whole sentence applied (the /api/intent round trip). */
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
/** The live mic stream, read-only for the HUD orb's level meter (null when off). */
const micStream = shallowRef<MediaStream | null>(null)

let session: VoiceSession | null = null
let stream: MediaStream | null = null
let stashedCtx: OpContext | null = null
let speechStoppedAt = 0
let connectTimer: ReturnType<typeof setTimeout> | undefined
let idleTimer: ReturnType<typeof setTimeout> | undefined
let failHandler: ((reason: string) => void) | null = null
const saidByItem = new Map<string, string>()
/**
 * Speaking first (Loop 1): when a response that called a tool closes, ask for a one-to-three-word
 * acknowledgement (ACK_INSTRUCTIONS) while the wish is still being built, then hold the tool result until
 * that line is done so the SDK's confirmation request never collides with it.
 */
let ackWanted = false
let acking = false
let responseHadAudio = false
/**
 * People (NPC). The genie hears everything, but a sentence said to a person is theirs. When speech starts
 * while someone is in focus (mid-conversation, looked at, or right beside you), the genie's automatic
 * reply is cancelled before it speaks or calls a tool, and the transcript goes through the same routing
 * rule as typed text (shared/npc/routing.ts): a person answers in their own voice, a world command goes to
 * the builder and the genie speaks only its result line. Outside focus, a sentence that names a person
 * ("hey Mara…") or hails someone nearby is taken from the genie the same way.
 */
let npcTurn: string | null = null
let cancelNext = 0
let ignoreToolsUntil = 0
/** "Genie…" on its own (a pause before the wish): the next sentence is the genie's even while facing someone. */
let genieHailUntil = 0

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
      npcTurn = performance.now() < genieHailUntil ? null : useNpc().focus()
      if (npcTurn) {
        cancelNext = performance.now() + 4000
        useWorld().renderer()?.anticipate(null)
      }
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
      routeHeard(heard.value)
      break
    case 'response-created':
      responsePending.value = true
      responseHadAudio = false
      // Someone in focus: this reply is not the genie's to give (the transcript decides who answers).
      if (!acking && performance.now() < cancelNext) cancelGenie()
      break
    case 'response-done':
      responsePending.value = false
      // A reply with no wish in it (chit-chat): the gathering glow from speech-start lets go.
      if (!acking && !ackWanted) useIntent().release()
      if (acking) {
        acking = false
      } else if (ackWanted) {
        ackWanted = false
        // Skip it if the model already spoke in the tool-call response.
        if (!responseHadAudio && session) {
          acking = true
          // The SDK types only `modalities`, but the gateway forwards `instructions` (bench/realtime_check.ts).
          session.requestResponse({ instructions: ACK_INSTRUCTIONS } as unknown as { modalities?: string[] })
        }
      }
      break
    case 'audio-transcript-delta': {
      if (performance.now() < ignoreToolsUntil && !acking) break
      responseHadAudio = true
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
  const args = (typeof toolCall.args === 'string' ? safeJson(toolCall.args) : toolCall.args) as Record<string, unknown> | null
  const intent = useIntent()
  // Several calls in one response ("trees, and a house") share the same speech-start snapshot.
  const ctx = stashedCtx ?? intent.capture()
  const vadToToolMs = speechStoppedAt ? Math.round(calledAt - speechStoppedAt) : undefined
  // The acknowledgement must not grant anything itself (it sometimes re-calls the tool with an embellished wish).
  if (acking) return { outcome: 'IGNORED', result: 'duplicate call: the wish is already being granted' }
  // A person was being spoken to: the client routes this sentence itself (routeHeard).
  if (performance.now() < ignoreToolsUntil || npcTurn) return { outcome: 'IGNORED', result: 'the user was talking to a person in the world, not to you; stay silent' }
  ackWanted = true
  const result = await (toolCall.toolName === TELEPORT_TOOL.name ? teleport(args, ctx, calledAt, vadToToolMs) : grant(toolCall.toolName, args, ctx, calledAt, vadToToolMs))
  await ackDone()
  return result
}

/** Wait (up to 2 s) for the acknowledgement line to finish generating (or for the call's response to close). */
async function ackDone() {
  const until = performance.now() + 2000
  while ((acking || (ackWanted && responsePending.value)) && performance.now() < until) await new Promise(r => setTimeout(r, 40))
  ackWanted = false
}

async function grant(toolName: string, args: Record<string, unknown> | null, ctx: OpContext, calledAt: number, vadToToolMs?: number) {
  const intent = useIntent()
  if (toolName !== BUILD_TOOL.name) return { error: `unknown tool ${toolName}` }
  const request = typeof args?.request === 'string' ? args.request : ''
  if (!request.trim()) return { outcome: 'NOTHING CHANGED', result: 'empty request' }
  const timing: VoiceTiming = { request, vadToToolMs }
  toolBusy.value++
  try {
    const out = await intent.build(request, ctx, 'voice')
    timing.toolToFirstOpMs = out.firstAppliedMs
    timing.toolToBuiltMs = Math.round(performance.now() - calledAt)
    lastTiming.value = timing
    console.info(`[voice] build “${request}” vad→tool ${timing.vadToToolMs ?? '?'} ms, tool→first op ${timing.toolToFirstOpMs ?? '-'} ms, tool→built ${timing.toolToBuiltMs} ms: ${out.summary}`)
    // The real outcome, so the genie never claims what didn't happen.
    return {
      outcome: out.ok ? 'done' : 'NOTHING CHANGED',
      result: out.summary,
      ...(out.notes.length ? { notes: out.notes.slice(0, 3) } : {}),
      ...(out.dropped.length ? { dropped: out.dropped.slice(0, 2).map(d => d.reason) } : {}),
      // The builder's line has already been through the honesty filter (true to the result, no "Shall I…?").
      ...(out.say ? { builderLine: out.say } : {})
    }
  } finally {
    toolBusy.value--
  }
}

/**
 * `teleport({ world, brief })`: start the Director straight away (no intent hop). The teleport batch goes
 * through `useWorld().run` like any other, so undo, save and replay behave exactly as for a typed teleport.
 * Waits (briefly) for the first Director op so the spoken welcome matches what the user sees.
 */
async function teleport(args: Record<string, unknown> | null, ctx: OpContext, calledAt: number, vadToToolMs?: number) {
  const place = typeof args?.world === 'string' ? args.world.trim() : ''
  const brief = typeof args?.brief === 'string' ? args.brief.trim() : ''
  if (!place) return { outcome: 'NOTHING CHANGED', result: 'no place named' }
  const timing: VoiceTiming = { request: `teleport → ${place}: ${brief}`, vadToToolMs }
  const res = useWorld().run([{ op: 'teleport', world: place, ...(brief ? { brief } : {}) }], `take me to ${place}`, ctx, { source: 'voice' })
  if (!res.effects.teleport) return { outcome: 'NOTHING CHANGED', result: 'the teleport was rejected', notes: [...res.effects.notes, ...res.dropped.map(d => d.reason)].slice(0, 3) }
  toolBusy.value++
  try {
    const director = useDirector()
    const deadline = calledAt + 3000
    while (performance.now() < deadline) {
      const run = director.current.value
      if (run && run.world === place && (run.firstOpAt || run.status !== 'building')) break
      await new Promise(r => setTimeout(r, 50))
    }
    const run = director.current.value
    timing.toolToFirstOpMs = run?.firstOpAt ? Math.round(run.firstOpAt - calledAt) : undefined
    lastTiming.value = timing
    console.info(`[voice] teleport “${place}” vad→tool ${vadToToolMs ?? '?'} ms, tool→first Director op ${timing.toolToFirstOpMs ?? '-'} ms · brief: ${brief}`)
    if (run?.status === 'error') return { outcome: 'NOTHING CHANGED', result: `could not build ${place}: ${run.error ?? 'error'}` }
    return { outcome: 'started', result: `${place} is assembling around the user now; it takes about ten seconds to finish` }
  } finally {
    toolBusy.value--
  }
}

function cancelGenie() {
  console.info('[voice] genie reply cancelled: a person is being spoken to')
  cancelNext = 0
  ignoreToolsUntil = performance.now() + 3500
  try {
    session?.cancelResponse()
    session?.stopPlayback()
  } catch {
    // nothing in flight
  }
  said.value = ''
}

/** A finished transcript: who was it for? (Only acts when a person is involved; otherwise the genie already has it.) */
function routeHeard(text: string) {
  const npc = useNpc()
  const ctx = stashedCtx ?? useIntent().capture()
  const wasFocused = npcTurn
  npcTurn = null
  if (!text) return
  if (npc.isEcho(text)) {
    // The mic heard a person's own voice from the speakers.
    if (wasFocused) cancelGenie()
    return
  }
  const r = npc.route(text)
  console.info(`[voice] heard “${text.slice(0, 60)}” ${speechStoppedAt ? Math.round(performance.now() - speechStoppedAt) : '?'} ms after speech end → ${r.to === 'npc' ? `person (${r.why})` : `genie (${r.why})`}`)
  if (r.to === 'npc') {
    if (!wasFocused) cancelGenie()
    void npc.talk(r.id, r.text, ctx)
    return
  }
  if (!wasFocused) return
  // Facing someone, but the sentence was the genie's ("genie, make it night", "a thunderstorm"): give the
  // turn back to the realtime genie. It heard the audio itself, so it grants with its own tools (build,
  // teleport) and its own voice, even when the transcript was cut short ("Genie." for "Genie. Make it night.").
  ignoreToolsUntil = 0
  cancelNext = 0
  if (/^\W*(?:hey |oh |ok )?(?:genie|djinn|spirit)\W*$/i.test(text)) genieHailUntil = performance.now() + 8000
  session?.requestResponse()
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
    micStream.value = stream
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
  micStream.value = null
  stashedCtx = null
  npcTurn = null
  cancelNext = 0
  ackWanted = false
  acking = false
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
    status, presence, userSpeaking, isPlaying, heard, said, lastTiming, toolCalls, lastError, micStream,
    start, stop
  }
}
