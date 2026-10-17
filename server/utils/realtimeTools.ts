/**
 * The realtime voice's one tool, as realtime tool definitions. No `execute`: the browser runs it
 * (`useRealtimeVoice` → `useIntent().build`). Plain module so the live check imports it too.
 */
import { experimental_getRealtimeToolDefinitions as getRealtimeToolDefinitions, tool } from 'ai'
import type { Experimental_RealtimeToolDefinition as RealtimeToolDefinition } from 'ai'
import { z } from 'zod'
import { BUILD_TOOL } from '../../shared/voice.ts'

const tools = {
  [BUILD_TOOL.name]: tool({
    description: BUILD_TOOL.description,
    inputSchema: z.object({ request: z.string().describe(BUILD_TOOL.requestDescription) })
  })
}

let cached: Promise<RealtimeToolDefinition[]> | undefined

export function realtimeTools(): Promise<RealtimeToolDefinition[]> {
  cached ??= getRealtimeToolDefinitions({ tools })
  return cached
}
