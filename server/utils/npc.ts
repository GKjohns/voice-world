/**
 * NPC minds on the server: a persona at spawn (one cheap call, grounded in the scene), a reply when
 * spoken to (streamed: the spoken line first, then a `>>` line of JSON actions), a rolling memory summary,
 * and a voice (gateway speech). Haiku 5.5 pinned to Anthropic for every text call; JSON in text, never
 * structured output. Plain module (explicit imports, no Nitro globals) so a bench script can run it.
 */
import { gateway } from '@ai-sdk/gateway'
import { generateSpeech, generateText, streamText } from 'ai'
import { parseCast, parsePersona } from '../../shared/npc/persona.ts'
import { parseBanter } from '../../shared/npc/reply.ts'
import type { BanterLine } from '../../shared/npc/reply.ts'
import type { CastEntry, Memory, Persona, PersonSeed } from '../../shared/npc/persona.ts'
import { costUsd, MODELS } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import { hash01 } from '../../shared/hash.ts'

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

export function personaPrompt(seed: PersonSeed, scene: string, others: string[] = [], cast?: CastEntry, place = ''): string {
  // Seeded nudges so a crowd from one sentence isn't twelve copies of the same net-mender (salted with
  // the name and the place, so the same id in a new world is someone new).
  const salt = `${seed.name ?? ''}|${place}`
  const temper = cast?.temperament ?? pickBy(seed.id + salt, 't', TEMPERS)
  const age = cast ? String(cast.age) : /child|kid|boy|girl/.test(seed.role ?? '') ? 'a child of 7 to 11' : /elder|old|grand/.test(seed.role ?? '') ? 'past seventy' : pickBy(seed.id + salt, 'a', AGES)
  const job = cast?.occupation ? ` · occupation: ${cast.occupation}` : ''
  const ties = cast?.ties.length ? `\nTheir ties to the others here (keep these exactly; they are true): ${cast.ties.join('; ')}` : ''
  return `A person has just come into being in this world. Write who they are.

## The world around them
${scene.slice(0, 1800)}

## Given
name: ${seed.name ?? '(choose one)'} · role: ${seed.role ?? 'villager'}${job}${seed.persona ? ` · they must be: ${seed.persona}` : ''} · temperament: ${temper} · age: ${age}${ties}
${others.length ? `Other people living here (make this one clearly different from them, with their own job and story): ${others.slice(0, 14).join('; ')}\n` : ''}
## Write this JSON (every field; each text field under 25 words; concrete, a little surprising; no clichés like "mysterious past")
{"name": "${seed.name ?? '…'}", "age": 0, "occupation": "1 to 3 words", "voice": "f" or "m",
 "personality": "one line", "speech": "how they talk: rhythm, word choice, one habit used rarely (never a fixed way of addressing people, never 'stranger', never answering questions with questions or repeating what was said back)",
 "backstory": "one or two sentences tied to THIS place: only things listed in the world above exist (never invent a lake, sea, dock or river that isn't listed)",
 "secret": "a secret or a want they'd only tell a friend",
 "routine": [ {"when": "dawn|morning|midday|afternoon|evening|night", "doing": "a short phrase", "place": "<a kind or tag from the world above, or a person's name, or home, or wander>", "activity": "stand|sit|work|fish|sweep|chat|sleep|patrol|wander|read|cast|tend|play|serve"} ]}
The routine has 5 or 6 blocks covering the day, and each "place" must be ONE kind word that is actually in the world above, without its count ("pine", not "12 pine"), or home / wander. Match the work to the place and the job (play = a game such as pool or cards; serve = behind a counter or bar). Night is for sleeping at home unless the job says otherwise.`
}

const CAST_ROLE = 'You cast the people of a small living world: a varied, believable group who know each other. Output only one JSON object, no prose, no code fences.'

/** Everyone in a group at once, so jobs, ages and temperaments differ and the ties between them agree. */
export function castPrompt(seeds: (PersonSeed & { gender: 'f' | 'm' })[], scene: string, residents: string[] = []): string {
  return `${seeds.length} people have just come into being here, together. Cast them.

## The world around them
${scene.slice(0, 1500)}
${residents.length ? `\nAlready living here (they may have ties to these too): ${residents.slice(0, 12).join('; ')}\n` : ''}
## The group (keep each name and gender)
${seeds.map(s => `- ${s.name} (${s.gender === 'f' ? 'woman' : 'man'}${s.role && s.role !== 'villager' ? `, ${s.role}` : ''}${s.persona ? `, ${s.persona}` : ''})`).join('\n')}

## Rules
- Only things listed in the world above exist: no river, lake, sea, ferry, dock or mine unless it's listed. Jobs and ties live in this place as it is.
- Every person gets a different occupation that fits THIS place (a role word like "villager" is only a costume: give them a real job). No two share a job unless the role says so (two guards may both guard).
- Ages spread out (some young, some middle-aged, some old, unless the role fixes it: a child is 6–12, an elder 65+). Temperaments all differ.
- Give the group 2 to ${Math.max(2, Math.min(6, Math.ceil(seeds.length / 2)))} ties: siblings, a married couple, rivals, best friends, a debt, a crush, a feud. Each tie appears on BOTH people, with the same facts.

## Write
{"cast": [ {"name": "…", "age": 0, "occupation": "1 to 3 words", "temperament": "2 to 4 words", "ties": ["Ines's older brother", "…"]} ]}`
}

export async function generateCast(seeds: (PersonSeed & { gender: 'f' | 'm' })[], scene: string, residents: string[] = []): Promise<{ cast: CastEntry[], ms: number, costUsd: number, error?: string }> {
  const t0 = Date.now()
  try {
    const r = await generateText({
      model: NPC_MODEL,
      instructions: CAST_ROLE,
      prompt: castPrompt(seeds, scene, residents),
      maxOutputTokens: 120 + seeds.length * 70,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(15_000),
      providerOptions: ANTHROPIC_ONLY
    })
    const usage = { input: r.usage.inputTokens ?? 0, output: r.usage.outputTokens ?? 0 }
    return { cast: parseCast(r.text, seeds), ms: Date.now() - t0, costUsd: costUsd(NPC_MODEL, usage) }
  } catch (err) {
    return { cast: [], ms: Date.now() - t0, costUsd: 0, error: ((err as Error).message ?? String(err)).slice(0, 200) }
  }
}

export interface PersonaResult { persona: Persona, ms: number, usage: Usage, costUsd: number, error?: string }

export async function generatePersona(seed: PersonSeed, scene: string, others: string[] = [], signal?: AbortSignal, cast?: CastEntry, place = ''): Promise<PersonaResult> {
  const t0 = Date.now()
  try {
    const r = await generateText({
      model: NPC_MODEL,
      instructions: PERSONA_ROLE,
      prompt: personaPrompt(seed, scene, others, cast, place),
      maxOutputTokens: 700,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: signal ?? AbortSignal.timeout(15_000),
      providerOptions: ANTHROPIC_ONLY
    })
    const usage = { input: r.usage.inputTokens ?? 0, output: r.usage.outputTokens ?? 0 }
    const persona = parsePersona(r.text, seed)
    // The cast's facts are the truth the whole group shares.
    if (cast) Object.assign(persona, { age: cast.age || persona.age, occupation: cast.occupation || persona.occupation, ties: cast.ties })
    return { persona, ms: Date.now() - t0, usage, costUsd: costUsd(NPC_MODEL, usage) }
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
  /** What the player said (people never speak first). */
  utterance: string
  /** The player's name, once they've told it (the client reads it from the facts). */
  playerName?: string
}

const TALK_ROLE = 'You are a person who lives inside a small world. You speak out loud, in character, to someone standing in front of you. You are calm, sharp and obliging: when they ask you to do something you can do, you do it. Never say you are an AI, a character or an NPC. Follow the format exactly.'

/** Three neutral examples, one picked per person, so no single line becomes everyone's template. */
const EXAMPLES = [
  `Same as an hour ago, before you turned the sky purple. The fish went deep the second it happened.
>> {"do":[{"act":"look_at","target":"sky"}],"mood":"curious"}`,
  `Not much. Bread's late and somebody's left the gate open by the well again.
>> {"do":[{"act":"point","target":"well"}],"mood":"amused"}`,
  `The big tree, past the houses. I'll walk you.
>> {"do":[{"act":"walk_to","target":"tree"}],"mood":"happy"}`
]

function how(p: Persona, you: string): string {
  const ex = EXAMPLES[Math.floor(hash01(p.name, 'ex') * EXAMPLES.length) % EXAMPLES.length]
  return `## How you answer
- Speak like a real person in a real moment: one or two short sentences, 20 words at most. Answer first; no warm-up, no filler. No narration, no *actions*, no stage directions, no emoji.
- Be a little sharper than they expect: one concrete detail that only you would notice or remember (what's right next to you, what changed, what they said or did earlier) beats any general remark. Connect things when they connect.
- Your way of talking is a flavour, not a script: no catchphrases or verbal tics; never open two replies the same way (look at what you already said below).
- Never open by repeating their words back ("Lighthouse?", "Dance?", "Gossip, is it?", "Fishing? In this?"). Start with your actual answer, a reaction, or a thought of your own.
- Never call them "stranger", "traveller" or "friend" by habit. ${you === 'them' ? 'You don\'t know their name yet; just talk to them.' : `Their name is ${you}; use it now and then, not every line.`}
- Never say distances as numbers or metres. Say "over by the shop", "just behind you", "across the way".
- Be specific: name things around you, what's happening in the sky, what you remember. Only things listed under "Right now" exist; never invent places or things that aren't there. Answer what was actually asked. Ask back only when you really need to know something.
- The visitor is no ordinary traveller: when they speak a wish, the world obeys (things appear, the sky changes). Only talk about a wish that is in "what you've seen happen"; if they say they're about to do something, you haven't seen it yet, so wait and see. React like a person would: awe, nerves, curiosity, a joke, depending on who you are.
- You remember. If you've met before, it shows. Bring up something from your memory or a recent event when it fits. Never claim someone told you something unless it's in your memory.
- You can't change the world yourself; only the visitor can. You can walk, follow, point, wave, sit, give what you have.
- Then, on a new line, write ">>" and one JSON object with what you DO (empty list if nothing): {"do": [ ... ], "mood": "happy|amused|curious|afraid|annoyed|sad|calm", "remember": "only when you learned something new worth keeping about the visitor (their name, a promise, what they want); otherwise leave it out"}
  actions: {"act":"walk_to","target":"<kind, tag or person's name in the scene>"} · {"act":"follow"} (go with the visitor) · {"act":"stay"} (stop following) · {"act":"wave"} · {"act":"sit"} · {"act":"stand"} · {"act":"bow"} · {"act":"cheer"} · {"act":"dance"} · {"act":"point","target":"<thing or player>"} · {"act":"look_at","target":"<thing>"} · {"act":"give","item":"<a thing you'd plausibly have, e.g. fish, apple, map, flower>"}
  Do what you say: if you say "follow me" or "come with me", include walk_to; if you agree to come along, include follow. To introduce them to someone, walk_to that person.
- When the visitor asks you to do something you can do (come along, go somewhere, wait somewhere, sit, wave, dance, show them), you do it now: agree in a few words and include the action. Never refuse, stall or say "give me a minute"; whatever you were busy with can wait. Your personality can grumble, but you still do it.
- Otherwise you're calm and get on with your own day: don't offer to tag along or walk them places unasked.

Example (the shape only; never reuse its words):
${ex}`
}

function personaBlock(p: Persona): string {
  const routine = p.routine.map(b => `${b.when}: ${b.doing} (${b.place})`).join('; ')
  return `## You
${p.name}, ${p.age}, ${p.occupation}. ${p.personality}.
How you talk: ${p.speech}.
Your story: ${p.backstory}
Kept close: ${p.secret}${p.ties?.length ? `\nYour people here: ${p.ties.join('; ')}` : ''}
Your day: ${routine}`
}

/** "just now", "a few minutes ago": so a storm that just began is never one "since dawn". */
export function ago(at: number, now = Date.now()): string {
  const s = (now - at) / 1000
  if (s < 45) return 'just now'
  if (s < 240) return 'a minute or two ago'
  if (s < 1200) return 'a little while ago'
  if (s < 7200) return 'earlier today'
  return 'some time ago'
}

function memoryBlock(m: TalkRequest['memory'], you: string): string {
  const lines: string[] = []
  const who = you === 'them' ? 'the visitor' : you
  lines.push(m.met ? `You have talked with ${who} ${m.met} time${m.met === 1 ? '' : 's'} before.` : 'You have never met the visitor before.')
  if (m.summary) lines.push(`What you remember of them: ${m.summary}`)
  if (m.facts.length) lines.push(`Facts you keep: ${m.facts.slice(-8).join(' · ')}`)
  if (m.events.length) lines.push(`What you've seen and heard happen (oldest first): ${m.events.slice(-8).map(e => `${e.text} (${ago(e.at)})`).join(' · ')}`)
  if (m.turns.length) {
    lines.push('The conversation so far:')
    for (const t of m.turns.slice(-8)) lines.push(`${t.who === 'player' ? (you === 'them' ? 'Visitor' : you) : 'You'}: ${t.text}`)
  }
  return `## Your memory\n${lines.join('\n')}`
}

/** How their last few lines began, so the next one doesn't open the same way ("Oh, sorry…" every time). */
export function openings(m: Pick<Memory, 'turns'>): string {
  const mine = m.turns.filter(t => t.who === 'npc').slice(-3)
  const firsts = mine.map(t => t.text.split(/\s+/).slice(0, 3).join(' ').replace(/[,.!?]+$/, ''))
  if (!firsts.length) return ''
  const echoes = mine.filter(t => /^\W*[\w' -]{1,24}\?|^\W*[\w' -]{1,24}, is (?:it|that|he|she|they)\?/i.test(t.text)).length
  const dots = mine.filter(t => /^\W*(?:\.\.\.|…)/.test(t.text)).length
  // The same first word twice in three replies ("Mm.", "Mm, alright"): name it, so it stops.
  const heads = mine.map(t => (t.text.match(/^\W*([\w']+)/)?.[1] ?? '').toLowerCase()).filter(Boolean)
  const tic = heads.find((w, i) => heads.indexOf(w) !== i)
  return `\nYour last replies began "${firsts.join('", "')}": begin this one differently${echoes >= 1 ? ', and not by repeating their words back ("X?", "X, is it?")' : ''}${dots >= 1 ? ', and not with "..."' : ''}${tic ? `, and not with "${tic}"` : ''}.`
}

export function talkPrompt(req: TalkRequest): string {
  const you = req.playerName?.trim() || 'them'
  const label = you === 'them' ? 'Visitor' : you
  const said = `${label}: "${req.utterance.slice(0, 400)}"`
  return `${how(req.persona, you)}

${personaBlock(req.persona)}

${memoryBlock(req.memory, you)}

## Right now
${req.scene.slice(0, 1600)}
You are: ${req.doing}${openings(req.memory)}

${said}
(Answer in your own words: never start by repeating theirs back as a question. If they asked you to do something you can do, such as come along, go or wait somewhere, sit or show them, you say yes and do it now, with the action in ">>".)
You:`
}

// ---------- people talking to each other ----------

export interface BanterSpeaker {
  id: string
  persona: Pick<Persona, 'name' | 'age' | 'occupation' | 'personality' | 'speech' | 'ties'>
  doing: string
  /** A few of their latest memories (events, facts about the visitor). */
  recent: string[]
}

/** Calm mode: the only thing said aside is one person's line about a truly huge wish they just watched. */
export interface BanterRequest {
  speakers: BanterSpeaker[]
  scene: string
  /** What just happened. */
  event?: string
  playerName?: string
  /** The visitor is how far off, in words ("right here", "a few steps away"). */
  visitor?: string
}

const BANTER_ROLE = 'You write one real, overheard line from a person who lives in a small world. Output only one JSON object, no prose, no code fences.'

export function banterPrompt(req: BanterRequest): string {
  const you = req.playerName?.trim() || 'the visitor'
  const people = req.speakers.map(s => `- ${s.persona.name}, ${s.persona.age}, ${s.persona.occupation}. ${s.persona.personality}. Talks: ${s.persona.speech}.${s.persona.ties?.length ? ` Ties: ${s.persona.ties.join('; ')}.` : ''} Now: ${s.doing}.${s.recent.length ? ` Remembers: ${s.recent.slice(-3).join(' · ')}` : ''}`).join('\n')
  const who = req.speakers[0]!.persona.name
  const task = `${you} (who makes wishes come true) just did this, in front of ${who}: ${req.event ?? 'something impossible'}\nWrite 1 line: ${who}'s gut reaction, said half to themselves, 2 to 8 words, in their own voice. Quiet awe, a worry or a dry joke; not a speech. Don't open with "Well" or "Oh".`
  return `## The people
${people}

## Where they are
${req.scene.slice(0, 900)}

## Write
${task}
Rules: real speech, no narration, no *actions*, no emoji, never "stranger", no catchphrases. Distances never as numbers. Only things in "Where they are" exist. Nobody claims someone told them something unless it's in what they remember.
{"lines": [{"who": "<name>", "to": "<name or visitor>", "line": "…", "mood": "happy|amused|curious|afraid|annoyed|sad|calm", "act": "none|point|look_at|wave|cheer|flinch", "target": "<thing, a name, sky, or visitor>"}]}`
}

export async function generateBanter(req: BanterRequest): Promise<{ lines: BanterLine[], ms: number, costUsd: number, error?: string }> {
  const t0 = Date.now()
  try {
    const r = await generateText({
      model: NPC_MODEL,
      instructions: BANTER_ROLE,
      prompt: banterPrompt(req),
      maxOutputTokens: 120,
      reasoning: 'none',
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(10_000),
      providerOptions: ANTHROPIC_ONLY
    })
    const usage = { input: r.usage.inputTokens ?? 0, output: r.usage.outputTokens ?? 0 }
    return { lines: parseBanter(r.text, req.speakers.map(s => s.persona.name)), ms: Date.now() - t0, costUsd: costUsd(NPC_MODEL, usage) }
  } catch (err) {
    return { lines: [], ms: Date.now() - t0, costUsd: 0, error: ((err as Error).message ?? String(err)).slice(0, 200) }
  }
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
      prompt: `You are ${name}. Your memory of the visitor so far: ${prev || '(nothing yet)'}\n\nNew exchanges:\n${turns.map(t => `${t.who === 'player' ? 'Visitor' : 'Me'}: ${t.text}`).join('\n')}\n\nRewrite your memory of the visitor in at most 3 sentences (under 70 words): who they seem to be, what they told you, what you did together, how you feel about them. Keep names and promises.`,
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
