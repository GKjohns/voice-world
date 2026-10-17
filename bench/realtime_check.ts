/**
 * Live check (Sprint 3.1): does the AI Gateway forward function calls for the realtime voice?
 *   node --env-file=.env bench/realtime_check.ts [wav ...]     (default: the two fixtures)
 * Opens the same session the browser opens (shared/voice.ts config + the token route's tool list), streams
 * a 24 kHz mono PCM16 wav at real-time pace, then silence so server VAD closes the turn. On a `build` call it
 * runs the real /api/intent on the dev server (INTENT_URL, default localhost:3091) with an empty scene,
 * returns the summary as the tool output, and waits for the spoken confirmation.
 * Reports per file: transcript, tool call args, and speech-end → build-start latency.
 * Fixtures: `say -o x.aiff "…" && afconvert -f WAVE -d LEI16@24000 -c 1 x.aiff x.wav`.
 */
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { gateway } from '@ai-sdk/gateway'
import { realtimeTools } from '../server/utils/realtimeTools.ts'
import { VOICE_MODEL, voiceSessionConfig } from '../shared/voice.ts'

const RATE = 24_000
const CHUNK_MS = 100
const INTENT_URL = process.env.INTENT_URL ?? 'http://localhost:3091/api/intent'
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['bench/fixtures/trees.wav', 'bench/fixtures/hi.wav']

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
  intentMs?: number
  summary?: string
  events: string[]
  error?: string
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
  let responses = 0
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
      case 'input-transcription-completed':
        res.transcript = String(ev.transcript ?? '').trim()
        break
      case 'function-call-arguments-done': {
        const at = performance.now()
        res.toolCalls.push({ name: String(ev.name), args: String(ev.arguments), atMs: now() })
        res.speechEndToBuildMs = Math.round(at - (streamStart + speechEndAt))
        if (speechStopAt) res.vadStopToBuildMs = Math.round(at - speechStopAt)
        let summary: string
        try {
          const request = (JSON.parse(String(ev.arguments)) as { request?: string }).request ?? ''
          const t = performance.now()
          const r = await fetch(INTENT_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text: request, ctx: { gaze: { point: [-3, 0, -8], dist: 8.5 }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 3 } })
          })
          const body = await r.json() as { ops?: { op: string, kind?: string, count?: number }[] }
          res.intentMs = Math.round(performance.now() - t)
          const spawned = (body.ops ?? []).filter(o => o.op === 'spawn').map(o => `${o.count ?? 1} ${o.kind}`)
          summary = spawned.length ? `spawned ${spawned.join(', ')}` : `ops: ${(body.ops ?? []).map(o => o.op).join(', ') || 'none'}`
        } catch (err) {
          summary = `builder unreachable (${(err as Error).message}); pretend it worked`
        }
        res.summary = summary
        send({ type: 'conversation-item-create', item: { type: 'function-call-output', callId: ev.callId, output: JSON.stringify({ result: summary }) } })
        send({ type: 'response-create' })
        break
      }
      case 'audio-transcript-done':
        res.reply = [res.reply, String(ev.transcript ?? '')].filter(Boolean).join(' / ')
        break
      case 'response-done':
        responses++
        // A tool call takes two responses (the call, then the spoken confirmation).
        if (!res.toolCalls.length || responses >= 2) replyDone()
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

const lines: string[] = [`realtime live check — ${new Date().toISOString()} — ${VOICE_MODEL} via AI Gateway, server-vad, tools: [build]`, '']
for (const f of files) {
  const r = await run(f)
  lines.push(`## ${r.file}`)
  lines.push(`heard:        ${JSON.stringify(r.transcript ?? null)}`)
  lines.push(`tool calls:   ${r.toolCalls.length ? r.toolCalls.map(c => `${c.name}(${c.args}) @${c.atMs} ms`).join('; ') : 'none'}`)
  if (r.toolCalls.length) {
    lines.push(`speech end → build call:  ${r.speechEndToBuildMs} ms (VAD speech-stopped → build call: ${r.vadStopToBuildMs ?? '?'} ms)`)
    lines.push(`/api/intent:  ${r.intentMs ?? '?'} ms → ${JSON.stringify(r.summary)}`)
  }
  lines.push(`voice said:   ${JSON.stringify(r.reply ?? null)}`)
  if (r.error) lines.push(`error:        ${r.error}`)
  lines.push('events:', ...r.events.map(e => `  ${e}`), '')
}
console.log(lines.join('\n'))
