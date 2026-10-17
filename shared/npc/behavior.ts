/**
 * The per-person state machine's decisions, as pure functions (the client's People runtime owns the
 * clocks, the positions and the bodies; this decides what they should be doing). Priority, highest first:
 *
 *   flee      something burning or monstrous landed right next to them
 *   (act)     the genie told them to dance or sit: even mid-conversation
 *   talk      a conversation is open and you're still close
 *   act       the genie told them to (dance, sit, follow) or they agreed to follow you
 *   react     a big event just happened (a dragon, thunder): they stop and look
 *   notice    you came close and looked at them: they turn to you (and may greet you)
 *   routine   their day: walk to the place for this time of day, then do the thing there
 */

export type Mode = 'flee' | 'talk' | 'act' | 'react' | 'notice' | 'routine'

export interface ModeInput {
  fleeing: boolean
  talking: boolean
  /** Metres to the player. */
  playerDist: number
  /** The player is looking roughly at them (within ~12° of the crosshair). */
  playerLooking: boolean
  /** A lasting act: dance, sit or follow (from the genie or their own "I'll come with you"). */
  lasting: boolean
  /** The genie told them to dance or sit: that wins even mid-conversation (they keep talking while they do it). */
  commanded?: boolean
  reacting: boolean
}

export const NOTICE_RANGE = 4
export const TALK_LEAVE_RANGE = 8

export function chooseMode(i: ModeInput): Mode {
  if (i.fleeing) return 'flee'
  if (i.commanded) return 'act'
  if (i.talking && i.playerDist <= TALK_LEAVE_RANGE) return 'talk'
  if (i.lasting) return 'act'
  if (i.reacting) return 'react'
  if (i.playerDist <= NOTICE_RANGE && i.playerLooking) return 'notice'
  return 'routine'
}

/** Should a person who just noticed you say something? Once per approach, not within `cooldown` s of the last time. */
export function shouldGreet(lookedFor: number, sinceLastGreet: number, sinceLastTalk: number, cooldown = 90): boolean {
  return lookedFor >= 0.8 && sinceLastGreet >= cooldown && sinceLastTalk >= 20
}

/** Is the player looking at a point: the angle between the view and the direction to it, in radians. */
export function viewAngle(eye: [number, number, number], yaw: number, pitch: number, at: [number, number, number]): number {
  const fx = -Math.sin(yaw) * Math.cos(pitch)
  const fy = Math.sin(pitch)
  const fz = -Math.cos(yaw) * Math.cos(pitch)
  const dx = at[0] - eye[0]
  const dy = at[1] - eye[1]
  const dz = at[2] - eye[2]
  const d = Math.hypot(dx, dy, dz) || 1
  return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fy * dy + fz * dz) / d)))
}

/** What kinds make people stop and look (tags), and what makes them run if it lands close. */
export const STARTLING = ['dragon', 'whale', 'monster', 'beast', 'volcano', 'mountain', 'planet', 'moon']
export const SCARY = ['fire', 'dragon', 'monster', 'lava', 'volcano']
export const FLEE_RANGE = 7

/** Walking speeds (m/s) by gait. */
export const SPEED = { stroll: 1.1, walk: 1.45, hurry: 2.4, run: 4.2 }
