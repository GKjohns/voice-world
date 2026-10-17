/**
 * NPC minds on the server: a persona at spawn (one cheap call, grounded in the scene), a reply when
 * spoken to (streamed: the spoken line first, then a `>>` line of JSON actions), a rolling memory summary,
 * and a voice (gateway speech). Haiku 5.5 pinned to Anthropic for every text call; JSON in text, never
 * structured output. Plain module (explicit imports, no Nitro globals) so a bench script can run it.
 */
import { gateway } from '@ai-sdk/gateway'
import { generateSpeech, generateText, streamText } from 'ai'
import { parsePersona } from '../../shared/npc/persona.ts'
import type { Memory, Persona, PersonSeed } from '../../shared/npc/persona.ts'
import { costUsd, MODELS } from './aiModels.ts'
import type { Usage } from './aiModels.ts'

export const NPC_MODEL = MODELS.haiku
const ANTHROPIC_ONLY = { gateway: { only: ['anthropic'] } }

// ---------- persona ----------

const PERSONA_ROLE = 'You invent one believable, specific person who lives in a small 3D world. Output only one JSON object, no prose, no code fences.'

const TEMPERS = ['cheerful and talkative', 'gruff but kind', 'shy and thoughtful', 'nosy and funny', 'proud and prickly', 'anxious and sweet', 'dreamy and distracted', 'blunt and practical', 'theatrical and vain', 'calm and wise', 'restless and adventurous', 'suspicious and dry']
const AGES = ['in their twenties', 'in their thirties', 'in their forties', 'in their fifties', 'in their sixties', 'past seventy']

function pickBy(id: string, salt: string, list: string[]): string {
  let h = 2166136261
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return list[((h >>> 0) % list.length)]!
}

export function personaPrompt(seed: PersonSeed, scene: string, others: string[] = []): string {
  // Seeded nudges so a crowd from one sentence isn't twelve copies of the same net-mender.
  const temper = pickBy(seed.id, 't', TEMPERS)
  const age = /child|kid|boy|girl/.test(seed.role ?? '') ? 'a child of 7 to 11' : /elder|old|grand/.test(seed.role ?? '') ? 'past seventy' : pickBy(seed.id, 'a', AGES)
  return `A person has just come into being in this world. Write who they are.

## The world around them
${scene.slice(0, 1800)}

## Given
name: ${seed.name ?? '(choose one)'} · role: ${seed.role ?? 'villager'}${seed.persona ? ` · they must be: ${seed.persona}` : ''} · temperament: ${temper} · age: ${age}
${others.length ? `Other people already living here (make this one clearly different from them, with their own job and story): ${others.slice(0, 8).join('; ')}\n` : ''}
## Write this JSON (every field; each text field under 25 words; concrete, a little surprising; no clichés like "mysterious past")
{"name": "${seed.name ?? '…'}", "age": 0, "occupation": "1 to 3 words", "voice": "f" or "m",
 "personality": "one line", "speech": "how they talk: rhythm, word choice, what they call strangers (no catchphrase that would open every line)",
 "backstory": "one or two sentences tied to THIS place (name real things in the scene: the dock, the lake, the houses)",
 "secret": "a secret or a want they'd only tell a friend",
 "routine": [ {"when": "dawn|morning|midday|afternoon|evening|night", "doing": "a short phrase", "place": "<a kind or tag from the world above, or home, or wander>", "activity": "stand|sit|work|fish|sweep|chat|sleep|patrol|wander|read|cast|tend"} ]}
The routine has 5 or 6 blocks covering the day, and each "place" must be ONE kind word that is actually in the world above, without its count ("pine", not "12 pine"), or home / wander. A fisherman fishes at the dock; a shopkeeper works at the storefront; a guard patrols the road.`
}

export interface PersonaResult { persona: Persona, ms: number, usage: Usage, costUsd: number, error?: string }

export async function generatePersona(seed: PersonSeed, scene: string, others: string[] = [], signal?: AbortSignal): Promise<PersonaResult> {
  const t0 = Date.now()
  try {
    const r = await generateText({
      model: NPC_MODEL,
      instructions: PERSONA_ROLE,
      prompt: personaPrompt(seed, scene, others),
      maxOutputTokens: 700,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: signal ?? AbortSignal.timeout(15_000),
      providerOptions: ANTHROPIC_ONLY
    })
    const usage = { input: r.usage.inputTokens ?? 0, output: r.usage.outputTokens ?? 0 }
    return { persona: parsePersona(r.text, seed), ms: Date.now() - t0, usage, costUsd: costUsd(NPC_MODEL, usage) }
  } catch (err) {
    return { persona: parsePersona('', seed), ms: Date.now() - t0, usage: { input: 0, output: 0 }, costUsd: 0, error: ((err as Error).message ?? String(err)).slice(0, 200) }
  }
}

// ---------- talk ----------

export interface TalkRequest {
  persona: Persona
  memory: Pick<Memory, 'summary' | 'turns' | 'events' | 'facts' | 'met'>
  /** What they can see and the state of the world, written by the client (shared/npc/scene.ts). */
  scene: string
  /** What they're doing right now ("mending nets on the dock"). */
  doing: string
  /** What the player said. Absent for a greeting (they noticed you walk up). */
  utterance?: string
  mode: 'talk' | 'greet'
}

const TALK_ROLE = 'You are a person who lives inside a small world. You speak out loud, in character, to someone standing in front of you. Never say you are an AI, a character or an NPC. Follow the format exactly.'

const HOW = `## How you answer
- Speak like a real person in a real moment: 1–3 short sentences, under 40 words, the way you'd actually say it out loud. Vary rhythm. No narration, no *actions*, no stage directions, no emoji.
- Your way of talking is a flavour, not a script: use a pet word or tic at most once every few replies, and never open two replies the same way (look at what you already said below).
- Be specific: name things around you, what's happening in the sky, what you remember. Answer what was actually asked. Ask back now and then, the way people do.
- The stranger is no ordinary traveller: when they speak a wish, the world obeys (things appear, the sky changes). You saw it happen (see "what you've seen"). React like a person would: awe, nerves, curiosity, a joke, depending on who you are.
- You remember. If you've met before, it shows ("you're back"). Bring up something from your memory or a recent event when it fits.
- You can't change the world yourself; only the stranger can. You can walk, follow, point, wave, sit, give what you have.
- Then, on a new line, write ">>" and one JSON object with what you DO (empty list if nothing): {"do": [ ... ], "remember": "only when you learned something new worth keeping about the stranger (their name, a promise, what they want); otherwise leave it out"}
  actions: {"act":"walk_to","target":"<kind, tag or name in the scene>"} · {"act":"follow"} (go with the stranger) · {"act":"stay"} (stop following) · {"act":"wave"} · {"act":"sit"} · {"act":"stand"} · {"act":"bow"} · {"act":"cheer"} · {"act":"dance"} · {"act":"point","target":"<thing or player>"} · {"act":"look_at","target":"<thing>"} · {"act":"give","item":"<a thing you'd plausibly have, e.g. fish, apple, map, flower>"}
  Do what you say: if you say "follow me" or "come with me", include walk_to; if you agree to come along, include follow. If asked to wave, sit, dance, show the way, do it.

Example:
Ha! You again. That storm nearly took my hat clean off. You did that, didn't you?
>> {"do":[{"act":"look_at","target":"sky"}],"remember":"the stranger came back after the storm"}`

function personaBlock(p: Persona): string {
  const routine = p.routine.map(b => `${b.when}: ${b.doing} (${b.place})`).join('; ')
  return `## You
${p.name}, ${p.age}, ${p.occupation}. ${p.personality}.
How you talk: ${p.speech}.
Your story: ${p.backstory}
Kept close: ${p.secret}
Your day: ${routine}`
}

function memoryBlock(m: TalkRequest['memory']): string {
  const lines: string[] = []
  lines.push(m.met ? `You have talked with the stranger ${m.met} time${m.met === 1 ? '' : 's'} before.` : 'You have never met the stranger before.')
  if (m.summary) lines.push(`What you remember of them: ${m.summary}`)
  if (m.facts.length) lines.push(`Facts you keep: ${m.facts.slice(-8).join(' · ')}`)
  if (m.events.length) lines.push(`What you've seen happen (oldest first): ${m.events.slice(-6).map(e => e.text).join(' · ')}`)
  if (m.turns.length) {
    lines.push('The conversation so far:')
    for (const t of m.turns.slice(-8)) lines.push(`${t.who === 'player' ? 'Stranger' : 'You'}: ${t.text}`)
  }
  return `## Your memory\n${lines.join('\n')}`
}

/** How their last few lines began, so the next one doesn't open the same way ("Oh, sorry…" every time). */
function openings(m: TalkRequest['memory']): string {
  const firsts = m.turns.filter(t => t.who === 'npc').slice(-3).map(t => t.text.split(/\s+/).slice(0, 3).join(' ').replace(/[,.!?]+$/, ''))
  return firsts.length ? `\nYour last replies began "${firsts.join('", "')}": begin this one differently.` : ''
}

export function talkPrompt(req: TalkRequest): string {
  const said = req.mode === 'greet' || !req.utterance
    ? '(The stranger has walked up to you and is looking at you. Greet them first, in a few words, in character. If you have met before, show that you remember.)'
    : `Stranger: "${req.utterance.slice(0, 400)}"`
  return `${HOW}

${personaBlock(req.persona)}

${memoryBlock(req.memory)}

## Right now
${req.scene.slice(0, 1600)}
You are: ${req.doing}${openings(req.memory)}

${said}
You:`
}

export type TalkEvent
  = | { t: 'text', delta: string, ms: number }
    | { t: 'done', ms: number, firstMs?: number, usage: Usage, costUsd: number, error?: string }

/** Stream an NPC's reply. Yields text deltas as they come, then one `done`. Never throws. */
export async function* streamTalk(req: TalkRequest, signal?: AbortSignal): AsyncGenerator<TalkEvent> {
  const t0 = Date.now()
  let firstMs: number | undefined
  let streamError: string | undefined
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort(new Error('client closed'))
  signal?.addEventListener('abort', onOuter, { once: true })
  const timer = setTimeout(() => ctrl.abort(new Error('no answer in 15 s')), 15_000)
  try {
    const r = streamText({
      model: NPC_MODEL,
      instructions: TALK_ROLE,
      prompt: talkPrompt(req),
      maxOutputTokens: 260,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: ctrl.signal,
      providerOptions: ANTHROPIC_ONLY,
      onError: ({ error }) => {
        streamError = ((error as Error)?.message ?? String(error)).slice(0, 200)
      }
    })
    for await (const delta of r.textStream) {
      firstMs ??= Date.now() - t0
      yield { t: 'text', delta, ms: Date.now() - t0 }
    }
    let usage: Usage = { input: 0, output: 0 }
    try {
      const u = await r.usage
      usage = { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0 }
    } catch {
      // best-effort
    }
    yield { t: 'done', ms: Date.now() - t0, firstMs, usage, costUsd: costUsd(NPC_MODEL, usage), error: streamError }
  } catch (err) {
    yield { t: 'done', ms: Date.now() - t0, firstMs, usage: { input: 0, output: 0 }, costUsd: 0, error: ((err as Error).message ?? String(err)).slice(0, 200) }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onOuter)
  }
}

// ---------- memory summary ----------

export async function summarizeMemory(name: string, prev: string, turns: { who: string, text: string }[]): Promise<string | null> {
  try {
    const r = await generateText({
      model: NPC_MODEL,
      instructions: 'You compress a person\'s memory of conversations into a few plain sentences, in their own first person. Output only the summary.',
      prompt: `You are ${name}. Your memory of the stranger so far: ${prev || '(nothing yet)'}\n\nNew exchanges:\n${turns.map(t => `${t.who === 'player' ? 'Stranger' : 'Me'}: ${t.text}`).join('\n')}\n\nRewrite your memory of the stranger in at most 3 sentences (under 70 words): who they seem to be, what they told you, what you did together, how you feel about them. Keep names and promises.`,
      maxOutputTokens: 160,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(12_000),
      providerOptions: ANTHROPIC_ONLY
    })
    return r.text.trim().slice(0, 600) || null
  } catch {
    return null
  }
}

// ---------- voice ----------

/** Gateway speech voices. The genie is OpenAI realtime `cedar`; people never use it. */
export const NPC_VOICES = { f: ['ara', 'eve', 'una'], m: ['leo', 'rex', 'sal'] } as const
const TTS_PRIMARY = 'spacexai/grok-tts'
const TTS_FALLBACK = 'openai/tts-1'
const FALLBACK_VOICE: Record<string, string> = { ara: 'nova', eve: 'shimmer', una: 'alloy', leo: 'onyx', rex: 'echo', sal: 'fable' }

const cache = new Map<string, { audio: Uint8Array, type: string }>()

/** Speak `text` in `voice`. Returns mp3 bytes, or null when every voice failed (the client falls back to the browser's). */
export async function speak(text: string, voice: string, speed?: number): Promise<{ audio: Uint8Array, type: string, model: string, ms: number } | null> {
  const key = `${voice}|${speed ?? 1}|${text}`
  const t0 = Date.now()
  const hit = cache.get(key)
  if (hit) return { ...hit, model: 'cache', ms: 0 }
  for (const [model, v] of [[TTS_PRIMARY, voice], [TTS_FALLBACK, FALLBACK_VOICE[voice] ?? 'alloy']] as const) {
    try {
      const r = await generateSpeech({
        model: gateway.speech(model),
        text: text.slice(0, 600),
        voice: v,
        ...(speed && speed !== 1 && model === TTS_FALLBACK ? { speed } : {}),
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(8000)
      })
      const out = { audio: r.audio.uint8Array, type: r.audio.mediaType || 'audio/mpeg' }
      cache.set(key, out)
      if (cache.size > 80) cache.delete(cache.keys().next().value!)
      return { ...out, model, ms: Date.now() - t0 }
    } catch (err) {
      console.warn(`[npc] speech ${model}/${v} failed: ${((err as Error).message ?? String(err)).slice(0, 160)}`)
    }
  }
  return null
}
