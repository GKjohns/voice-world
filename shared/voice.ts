/**
 * The realtime voice's session config (Sprint 3). Plain data, shared by the client composable
 * (`useRealtimeVoice`) and the live check (`bench/realtime_check.ts`), so both open the same session.
 * The voice gets exactly one tool, `build({ request })`; the op schema stays with the intent model.
 */

export const VOICE_MODEL = 'openai/gpt-realtime-mini'
export const VOICE_TRANSCRIBER = 'whisper-1'
export const VOICE_NAME = 'marin'

export const BUILD_TOOL = {
  name: 'build',
  description: 'Change the world: pass the user\'s building request in their words, resolved only enough to stand alone.',
  requestDescription: 'The request in the user\'s own words, e.g. "put a bunch of trees over there", "make them red", "undo that", "take me to a pool hall".'
} as const

export const VOICE_INSTRUCTIONS = `You are the voice of a world builder. The user stands inside a 3D world and changes it by talking to you.

- Whenever the user asks to make, add, change, move, remove, undo, light or go somewhere, call the build tool with their request in their own words. Keep words like "there", "it", "those" and "that" as they said them; the builder knows where they were looking. Only fill in what the sentence needs to stand alone ("make it red" right after "a house over there" stays "make it red").
- Call build at once. Do not ask for confirmation and do not say anything before the call.
- After the tool result, confirm in under 8 words ("There you go.", "Nine pines, coming up."). If the result says nothing changed, say so briefly.
- Never read out coordinates, ids, counts of parts or the tool result itself.
- Otherwise chit-chat briefly and warmly, in one short sentence.
- Speak English unless the user speaks another language.`

/** Server VAD: barge-in is native. A slightly shorter silence window than a conversation app: commands are short. */
export const VOICE_TURN_DETECTION = {
  type: 'server-vad' as const,
  threshold: 0.6,
  silenceDurationMs: 600,
  prefixPaddingMs: 300
}

export function voiceSessionConfig(transcriber: string = VOICE_TRANSCRIBER) {
  return {
    instructions: VOICE_INSTRUCTIONS,
    voice: VOICE_NAME,
    outputModalities: ['audio' as const],
    inputAudioTranscription: { model: transcriber, language: 'en' },
    turnDetection: VOICE_TURN_DETECTION
  }
}
