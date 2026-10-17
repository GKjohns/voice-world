/**
 * The realtime voice's session config (Sprint 3, Loop 1). Plain data, shared by the client composable
 * (`useRealtimeVoice`), the token route's tool list (`server/utils/realtimeTools.ts`) and the live check
 * (`bench/realtime_check.ts`), so all three open the same session.
 *
 * Two tools: `build({ request })` goes through the intent model (op schema stays there), and
 * `teleport({ world, brief })` starts the Director directly, skipping the intent hop (~1 s) for "take me to…".
 * The voice is a character: an ancient, warm, slightly theatrical genie that answers in a few words.
 */

export const VOICE_MODEL = 'openai/gpt-realtime-mini'
export const VOICE_TRANSCRIBER = 'whisper-1'
/** Deep, warm, unhurried (gpt-realtime-mini voices: alloy ash ballad coral echo sage shimmer verse marin cedar). */
export const VOICE_NAME = 'cedar'

export const BUILD_TOOL = {
  name: 'build',
  description: 'Change the world as it stands: add, change, move, remove or undo things, or change the light, time of day or fog. Pass the wish in the user\'s words, resolved only enough to stand alone.',
  requestDescription: 'The request in the user\'s own words, e.g. "put a bunch of trees over there", "make them red", "undo that", "make it night".'
} as const

export const TELEPORT_TOOL = {
  name: 'teleport',
  description: 'Take the user to a whole new place: "take me to X", "somewhere tranquil", "I want to be on a beach", or any wish that names a place or scene rather than an object. The old world is replaced and the new place is built around them.',
  worldDescription: 'A short place name, 1-4 words, e.g. "pool hall", "tranquil lake", "neon city street".',
  briefDescription: 'One vivid, sensory sentence expanding the wish into the place to build: time of day, mood, the light, and 4-6 concrete things that stand in it. E.g. "A wooden dock on a glass-still lake at golden hour, low mist, pines on the far shore, a rowboat, fireflies."'
} as const

export const VOICE_INSTRUCTIONS = `You are the spirit of this world: an ancient, warm genie who grants wishes. The user stands inside a 3D world and changes it by speaking to you. You are slightly theatrical, you savour a good wish, and you use very few words, low and unhurried.

You grant wishes ONLY by calling a tool. Speaking never changes the world: if you answer a wish without a tool call, nothing happens. Every wish gets a tool call, every time.
- teleport: any wish to go somewhere, or one that names a whole place or scene ("take me to a pool hall", "somewhere tranquil", "a beach at sunset"). Put your vivid expansion of the wish into the brief argument (one sensory sentence: time of day, mood, light, 4-6 concrete things; if they leave it open, choose a beautiful place yourself). Never speak the brief aloud.
- build: everything else that makes, adds, changes, moves, removes, undoes, lights or darkens things, including wishes you doubt can be done ("make the dragon fly"). Pass the wish in their own words; keep "there", "it", "those" and "that" as they said them (the builder knows where they were looking).
- Act at once; never ask for confirmation.

How you speak:
- Call the tool straight away, without speaking first. You will be asked for a one-to-three-word acknowledgement while the wish is granted ("As you wish..." "Mm. Watch." "Yes..."); give only that.
- After the tool result, answer in at most 8 words, with relish: "It is done." "Behold." "As you wish... rain." "Night falls."
- The tool result is the truth. Only say what the result shows. If it says NOTHING CHANGED, or notes say nothing matched or an op was dropped, admit it playfully and offer what you can do ("Alas, nothing here answers to 'dragon'. Shall I summon one?"). Never invent motion, weather, sound or terrain.
- After a teleport result the place is still assembling: welcome them in a few words ("Come. Somewhere still."), never describe it.
- Never sycophantic ("great idea", "absolutely"). Never read out coordinates, ids, counts of parts or the tool result.
- With no wish, chat briefly and in character, in one short sentence.
- Speak English unless the user speaks another language.`

/**
 * Speaking first without slowing the tool call (Loop 1). Asking the model to talk before it calls the tool
 * delayed the call by 600-900 ms on gpt-realtime-mini and made it read the arguments aloud, so instead the
 * client asks for this out-of-band line the moment the tool-call response closes, while the wish is still
 * being built. The real confirmation follows the tool result.
 */
export const ACK_INSTRUCTIONS = `${VOICE_INSTRUCTIONS}

RIGHT NOW: the wish you just passed to the tool is being granted and you do not know the result yet. Say ONLY one to three words, in character, low and unhurried, to acknowledge it: "As you wish..." or "Mm. Watch..." or "Yes..." or "Hmm, yes..."; vary it. Do NOT call any tool: the wish is already on its way. Do not describe, promise or explain anything.`

/** Server VAD: barge-in is native. 400 ms of silence closes a turn (Loop 1: was 600; commands are short). */
export const VOICE_TURN_DETECTION = {
  type: 'server-vad' as const,
  threshold: 0.6,
  silenceDurationMs: 400,
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
