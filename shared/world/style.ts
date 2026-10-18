/**
 * What the models are told about the look ("Painted Toy World", art_direction.md §3.8). One paragraph,
 * shared by every prompt that makes geometry or colour (intent define, forge refine, forge reference image,
 * the Director), so a Haiku draft and an Opus refine aim at the same target. The engine snaps every colour
 * onto the palette (shared/world/palette.ts) anyway; naming palette colours just makes the snap land on intent.
 */
import { PALETTE } from './palette.ts'

/** The palette as `name #hex` pairs, comma separated, for a prompt line. */
export const PALETTE_LINE = PALETTE.map(s => `${s.name} ${s.hex}`).join(', ')

export const STYLE = `STYLE: chunky toy-diorama. Rounded, slightly exaggerated masses; recognisable from 20 m by silhouette alone. Thick parts: nothing thinner than 6% of the object's height except rope, wire or antennae. Heads, wheels, hands, roofs and other signature features 15–30% bigger than real. 3–5 colours per object: one main colour on the big masses (slot primary), one secondary (trim), one small saturated accent. Prefer warm, slightly muted tones; never pure black or pure white. Glow only on things that give light. No text, no thin decorative detail, no tiny parts under 4 cm. Every part touches or overlaps another; the object sits on the ground.`

/** STYLE plus the palette, for prompts that choose colours. */
export const STYLE_WITH_PALETTE = `${STYLE}\nPalette (pick from these; the engine snaps every colour to the nearest): ${PALETTE_LINE}.`

/** For image models (the forge's reference picture): the reference must already look like the target. */
export const STYLE_IMAGE = 'Chunky stylised 3D toy, soft cel shading in two or three bands, rounded bevelled shapes, 3–5 muted warm colours with one bright accent, no outlines, no textures, plain light background, three-quarter view'
