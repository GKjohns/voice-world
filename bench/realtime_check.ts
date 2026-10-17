/**
 * Live check (Sprint 3.1, Loop 1): the realtime voice end to end, minus the browser.
 *   node --env-file=.env bench/realtime_check.ts [wav ...]     (default: trees, castle, tranquil, dragon, hi)
 * Opens the same session the browser opens (shared/voice.ts config + the token route's tool list), streams
 * a 24 kHz mono PCM16 wav at real-time pace, then silence so server VAD closes the turn. On a `build` call it
 * streams the real /api/intent (NDJSON) from the dev server (INTENT_URL, default localhost:3091) against an
 * empty scene, applies the ops with the real kernel and returns the same honest outcome the browser sends
 * (`{ outcome, result, notes? }`). A `teleport` call is answered as started (the Director is not run here).
 * Reports per file: transcript, tool calls, speech end → first audio (dead air), → tool call, → first op.
 * Fixtures: `say -o x.aiff "…" && afconvert -f WAVE -d LEI16@24000 -c 1 x.aiff x.wav`.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { gateway } from '@ai-sdk/gateway'
import { realtimeTools } from '../server/utils/realtimeTools.ts'
import { ACK_INSTRUCTIONS, VOICE_MODEL, VOICE_NAME, voiceSessionConfig } from '../shared/voice.ts'
import { applyBatch, createWorld } from '../shared/world/state.ts'
import type { OpContext } from '../shared/world/types.ts'

const RATE = 24_000
const CHUNK_MS = 100
const INTENT_URL = process.env.INTENT_URL ?? 'http://localhost:3091/api/intent'
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['trees', 'castle', 'tranquil', 'dragon', 'hi'].map(n => `bench/fixtures/${n}.wav`)
const CTX: OpContext = { gaze: { point: [-3, 0, -8], dist: 8.5 }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 3 }

function pcmFromWav(path: string): Buffer {
  const buf = readFileSync(path)
  let off = 12
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      const ch = buf.readUInt16LE(off + 10)
      const rate = buf.readUInt32LE(off + 12)
      const bits = buf.readUInt16LE(off + 22)
      if (ch !== 1 || rate !== RATE || bits !== 16) throw new Error(`${path}: need mono 24 kHz PCM16, got ${ch}ch ${rate} Hz ${bits}-bit`)
    }
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size)
    off += 8 + size + (size % 2)
  }
  throw new Error(`${path}: no data chunk`)
}

/** ms offset of the last sample louder than ~-40 dBFS. */
function speechEndMs(pcm: Buffer): number {
  for (let i = pcm.length - 2; i >= 0; i -= 2) {
    if (Math.abs(pcm.readInt16LE(i)) > 330) return Math.round((i / 2 / RATE) * 1000)
  }
  return 0
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Result {
  file: string
  transcript?: string
  toolCalls: { name: string, args: string, atMs: number }[]
  reply?: string
  speechEndToBuildMs?: number
  vadStopToBuildMs?: number
  /** Speech end → the first audio byte of any response: the dead air the user hears. */
  speechEndToAudioMs?: number
  /** What the voice said before the first tool output went back (the "speaks first" line). */
  before?: string
  intentFirstOpMs?: number
  /** Tool calls made by the acknowledgement response (should be 0). */
  ackToolCalls?: number
  intentMs?: number
  summary?: string
  events: string[]
  error?: string
}

/** Stream /api/intent (NDJSON), apply the ops to an empty world, and build the browser's honest outcome. */
async function intent(request: string, res: Result): Promise<Record<string, unknown>> {
  const t = performance.now()
  const r = await fetch(INTENT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: request, ctx: CTX })
  })
  const text = await r.text() // the bench only needs the total; the first op time comes from the server
  res.intentMs = Math.round(performance.now() - t)
  const lines = text.split('\n').filter(Boolean).map(l => JSON.parse(l) as { t: string, op?: unknown, dropped?: { reason: string }, firstOpMs?: number })
  res.intentFirstOpMs = lines.find(l => l.t === 'done')?.firstOpMs
  const ops = lines.filter(l => l.t === 'op').map(l => l.op)
  const dropped = lines.filter(l => l.t === 'drop').map(l => l.dropped!.reason)
  const out = applyBatch(createWorld(), ops, CTX, request)
  const fx = out.effects
  const bits: string[] = []
  if (fx.spawned.length) bits.push(`spawned ${fx.spawned.length} ${[...new Set(fx.spawned.map(id => id.split('#')[0]))].join(', ')}`)
  if (fx.modified.length) bits.push(`changed ${fx.modified.length}`)
  if (fx.removed.length) bits.push(`removed ${fx.removed.length}`)
  if (fx.atmosphere) bits.push(`light → ${out.state.atmosphere.time}`)
  if (fx.teleport) bits.push(`teleport → ${fx.teleport.world}`)
  const changed = bits.length > 0
  return {
    outcome: changed ? 'done' : 'NOTHING CHANGED',
    result: bits.join(' · ') || 'nothing changed',
    ...(fx.notes.length ? { notes: fx.notes.slice(0, 3) } : {}),
    ...(dropped.length ? { dropped } : {}),
    ...(fx.say.length && changed ? { builderLine: `${fx.say.join(' ')} (use only if true to the result)` } : {})
  }
}

async function run(file: string): Promise<Result> {
  const pcm = pcmFromWav(file)
  const lead = Buffer.alloc((RATE * 2 * 500) / 1000)
  const tail = Buffer.alloc((RATE * 2 * 2000) / 1000)
  const audio = Buffer.concat([lead, pcm, tail])
  const speechEndAt = 500 + speechEndMs(pcm)

  const [{ token, url }, tools] = await Promise.all([
    gateway.experimental_realtime.getToken({ model: VOICE_MODEL }),
    realtimeTools()
  ])
  const ws = gateway.experimental_realtime(VOICE_MODEL).getWebSocketConfig!({ token, url })
  const sock = new WebSocket(ws.url, ws.protocols)
  const t0 = performance.now()
  const now = () => Math.round(performance.now() - t0)
  const res: Result = { file: basename(file), toolCalls: [], events: [] }
  let streamStart = 0
  let speechStopAt = 0
  let configured = false
  let replyDone: () => void = () => {}
  const finished = new Promise<void>(r => (replyDone = r))
  let phase: 'call' | 'ack' | 'confirm' = 'call'
  const pending: Promise<{ callId: unknown, output: Record<string, unknown> }>[] = []
  const send = (e: unknown) => sock.send(JSON.stringify(e))

  async function stream() {
    streamStart = performance.now()
    const step = (RATE * 2 * CHUNK_MS) / 1000
    for (let i = 0; i < audio.length; i += step) {
      send({ type: 'input-audio-append', audio: audio.subarray(i, i + step).toString('base64') })
      const due = streamStart + ((i + step) / 2 / RATE) * 1000
      await sleep(Math.max(0, due - performance.now()))
    }
  }

  sock.onopen = () => send({ type: 'session-update', config: { ...voiceSessionConfig(), tools } })
  sock.onerror = () => {
    res.error = 'socket error'
    replyDone()
  }
  sock.onclose = (e) => {
    if (!res.error && e.code !== 1000) res.error = `socket closed ${e.code} ${e.reason}`
    replyDone()
  }
  sock.onmessage = async (msg) => {
    const ev = JSON.parse(String(msg.data)) as Record<string, unknown> & { type: string }
    if (!['audio-delta', 'audio-transcript-delta', 'function-call-arguments-delta', 'content-part-added', 'content-part-done'].includes(ev.type)) {
      res.events.push(`${String(now()).padStart(6)} ms  ${ev.type}${ev.type === 'error' ? ` ${String(ev.message)}` : ''}`)
    }
    switch (ev.type) {
      case 'session-updated':
        if (!configured) {
          configured = true
          void stream()
        }
        break
      case 'speech-stopped':
        speechStopAt = performance.now()
        break
      case 'audio-delta':
        if (res.speechEndToAudioMs === undefined && streamStart) res.speechEndToAudioMs = Math.round(performance.now() - (streamStart + speechEndAt))
        break
      case 'input-transcription-completed':
        res.transcript = String(ev.transcript ?? '').trim()
        break
      case 'function-call-arguments-done': {
        const at = performance.now()
        res.toolCalls.push({ name: String(ev.name), args: String(ev.arguments), atMs: now() })
        if (res.speechEndToBuildMs === undefined) {
          res.speechEndToBuildMs = Math.round(at - (streamStart + speechEndAt))
          if (speechStopAt) res.vadStopToBuildMs = Math.round(at - speechStopAt)
        }
        // Start the work at once, like the browser; the output goes back after the acknowledgement.
        const callId = ev.callId
        if (phase !== 'call') {
          // The acknowledgement response tried to call a tool too: the browser ignores it the same way.
          res.ackToolCalls = (res.ackToolCalls ?? 0) + 1
          pending.push(Promise.resolve({ callId, output: { outcome: 'IGNORED', result: 'duplicate call: the wish is already being granted' } }))
          break
        }
        pending.push((async () => {
          let output: Record<string, unknown>
          try {
            const args = JSON.parse(String(ev.arguments)) as { request?: string, world?: string, brief?: string }
            output = String(ev.name) === 'teleport'
              ? { outcome: 'started', result: `${args.world} is assembling around the user now; it takes about ten seconds to finish` }
              : await intent(args.request ?? '', res)
          } catch (err) {
            output = { outcome: 'NOTHING CHANGED', result: `builder unreachable (${(err as Error).message})` }
          }
          res.summary = [res.summary, JSON.stringify(output)].filter(Boolean).join(' ; ')
          return { callId, output }
        })())
        break
      }
      case 'audio-transcript-done':
        res.reply = [res.reply, String(ev.transcript ?? '')].filter(Boolean).join(' / ')
        if (phase !== 'confirm') res.before = [res.before, String(ev.transcript ?? '')].filter(Boolean).join(' / ')
        break
      case 'response-done':
        if (!res.toolCalls.length || phase === 'confirm') {
          replyDone()
        } else if (phase === 'call') {
          // The tool-call response closed: ask for the out-of-band acknowledgement (speaks first).
          phase = 'ack'
          send({ type: 'response-create', options: { instructions: ACK_INSTRUCTIONS } })
        } else if (phase === 'ack') {
          phase = 'confirm'
          const outs = await Promise.all(pending)
          for (const o of outs) send({ type: 'conversation-item-create', item: { type: 'function-call-output', callId: o.callId, output: JSON.stringify(o.output) } })
          send({ type: 'response-create' })
        }
        break
      case 'error':
        res.error = String(ev.message)
        break
    }
  }

  await Promise.race([finished, sleep(25_000).then(() => {
    res.error ??= 'timed out after 25 s'
  })])
  sock.close(1000)
  return res
}

const lines: string[] = [`realtime live check — ${new Date().toISOString()} — ${VOICE_MODEL} via AI Gateway, voice ${VOICE_NAME}, server-vad, tools: [build, teleport]`, '']
for (const f of files) {
  const r = await run(f)
  lines.push(`## ${r.file}`)
  lines.push(`heard:        ${JSON.stringify(r.transcript ?? null)}`)
  lines.push(`tool calls:   ${r.toolCalls.length ? r.toolCalls.map(c => `${c.name}(${c.args}) @${c.atMs} ms`).join('; ') : 'none'}`)
  lines.push(`speech end → first audio: ${r.speechEndToAudioMs ?? '-'} ms`)
  if (r.toolCalls.length) {
    lines.push(`speech end → tool call:   ${r.speechEndToBuildMs} ms (VAD speech-stopped → tool call: ${r.vadStopToBuildMs ?? '?'} ms)`)
    if (r.intentMs !== undefined) lines.push(`/api/intent:  first op ${r.intentFirstOpMs ?? '-'} ms (server), done ${r.intentMs} ms → speech end → first op ≈ ${r.speechEndToBuildMs! + (r.intentFirstOpMs ?? r.intentMs)} ms`)
    lines.push(`tool output:  ${r.summary}`)
    lines.push(`said first:   ${JSON.stringify(r.before ?? null)}${r.ackToolCalls ? ` (ack made ${r.ackToolCalls} ignored tool call(s))` : ''}`)
  }
  lines.push(`voice said:   ${JSON.stringify(r.reply ?? null)}`)
  if (r.error) lines.push(`error:        ${r.error}`)
  lines.push('events:', ...r.events.map(e => `  ${e}`), '')
}
console.log(lines.join('\n'))
