/**
 * The realtime voice's two tools, as realtime tool definitions. No `execute`: the browser runs them
 * (`useRealtimeVoice` → `useIntent().build` or a teleport batch that starts the Director). Plain module so
 * the live check imports it too.
 */
import { experimental_getRealtimeToolDefinitions as getRealtimeToolDefinitions, tool } from 'ai'
import type { Experimental_RealtimeToolDefinition as RealtimeToolDefinition } from 'ai'
import { z } from 'zod'
import { BUILD_TOOL, TELEPORT_TOOL } from '../../shared/voice.ts'

const tools = {
  [BUILD_TOOL.name]: tool({
    description: BUILD_TOOL.description,
    inputSchema: z.object({ request: z.string().describe(BUILD_TOOL.requestDescription) })
  }),
  [TELEPORT_TOOL.name]: tool({
    description: TELEPORT_TOOL.description,
    inputSchema: z.object({
      world: z.string().describe(TELEPORT_TOOL.worldDescription),
      brief: z.string().describe(TELEPORT_TOOL.briefDescription)
    })
  })
}

let cached: Promise<RealtimeToolDefinition[]> | undefined

export function realtimeTools(): Promise<RealtimeToolDefinition[]> {
  cached ??= getRealtimeToolDefinitions({ tools })
  return cached
}
