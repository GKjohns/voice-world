/**
 * The per-person state machine's decisions, as pure functions (the client's People runtime owns the
 * clocks, the positions and the bodies; this decides what they should be doing). Priority, highest first:
 *
 *   flee      something burning or monstrous landed right next to them
 *   (react)   a dragon or a thunderclap stops even a commanded dancer, for a moment
 *   (act)     the genie told them to dance or sit: even mid-conversation (until it runs its course)
 *   talk      a conversation is open and you're still close
 *   act       the genie told them to (dance, sit, follow) or they agreed to follow you
 *   react     a big event just happened (a dragon, thunder): they stop and look
 *   routine   their day: a gentle one, mostly in place (calm mode: they never come to you unasked)
 *
 * Calm mode: there is no "notice" mode. Stand close and look at someone and they glance at you (head only,
 * `GLANCE_RANGE`), but they don't stop what they're doing, walk over or speak first.
 */

export type Mode = 'flee' | 'talk' | 'act' | 'react' | 'routine'

export interface ModeInput {
  fleeing: boolean
  talking: boolean
  /** Metres to the player. */
  playerDist: number
  /** A lasting act: dance, sit or follow (from the genie or their own "I'll come with you"). */
  lasting: boolean
  /** The genie told them to dance or sit: that wins even mid-conversation (they keep talking while they do it). */
  commanded?: boolean
  reacting: boolean
}

/** Stand this close and look at someone, and they glance back (head only). */
export const GLANCE_RANGE = 3.5
export const TALK_LEAVE_RANGE = 8

export function chooseMode(i: ModeInput): Mode {
  if (i.fleeing) return 'flee'
  if (i.commanded && i.reacting) return 'react'
  if (i.commanded) return 'act'
  if (i.talking && i.playerDist <= TALK_LEAVE_RANGE) return 'talk'
  if (i.lasting) return 'act'
  if (i.reacting) return 'react'
  return 'routine'
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
