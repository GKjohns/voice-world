# Gen loop 2: deterministic scale, framing, three-quarter view (2026-10-18)

Run: `npm run gen:gauntlet -- --loop loop2` (6 prompts, 2.9 min, ~$0.25 on the gateway). Review page: `index.html` here. Two `--only` checks (triceratops, locomotive) before it, discarded.

## What changed

- **One size, decided at the spawn.** `shared/world/size.ts` `targetSize(kind, text, hint)`: a diorama-scale table on the kind's words (locomotive 9 m, pagoda 11, triceratops 6, telescope 1.9, flytrap 1.4, cottage 7…) times an adjective factor (giant ×2.2, little ×0.6, tiny ×0.35). Kinds not in the table fall back to the new `size` field Haiku now puts on a new kind's spawn (`shared/world/ops.ts`, intent prompt in `server/utils/intent.ts`), and then to 2.5 m. `useIntent.apply` decides it once per kind and writes it onto the spawn op.
- **Both models build to it, and both streams are held to it.** Opus gets "its largest dimension is S m" (`server/utils/forge.ts`, `/api/forge` takes `size`). In the renderer, the draft overlays and the refine overlay are scaled by `sizeK` (`shared/world/forge.ts`), which only shrinks while parts stream. The first part snaps to the right scale, and after that the scale eases (dt × 10). The draft's define and the refine's final parts are normalised with the same rule; once the object is complete the rule also grows anything under 0.6 S. The draft and the refine therefore agree on size, and the hand-over has no jump. `fitToDraft` at the hand-over is gone (`renderer.handOff`; `refineScale` is replaced by `refineFinalK`).
- **Placement uses the real size.** A new kind's spawn with `size` is laid out with footprint 0.45 S and height 0.75 S (`shared/world/state.ts`), so "right in front of me" steps back far enough. The camera is no longer inside the triceratops.
- **Framing.** Whenever a new design lands (the draft define, then the forged upgrade), `frameWish` runs on it. `solveFrame` checks the height, width and depth samples and leaves the camera alone if everything already fits. It used to run only when the new design was 1.3× taller (`app/world/renderer.ts`).
- **Three-quarter view.** A single new kind with facing `player` gets +0.65 rad (37°) of yaw (`shared/world/layout.ts`). The refine prompt now says long things run along z.

## Timings (means, s from Enter)

| | draft | first refined | 50% parts | settled good | settled hero |
|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 |
| **loop 2** | **2.0** | **5.5** | **9.8** | **12.5** | 20.1 |

The hero's 20.1 s is low only because the polish lost the judge, so nothing was swapped at about 80 s. That is variance, not something this loop fixed. fps stayed at 60 on every prompt, with the worst frame gap at 17–33 ms.

## Quality (final stills)

| prompt | l0 | l1 | l2 | why |
|---|---|---|---|---|
| flytrap | 7 | 6 | 8 | Whole plant in frame, pot, toothy trap, side traps. Charming |
| locomotive | 5 | 3 | 6 | Finally a three-quarter view that reads as a train, but the camera is close: the cowcatcher is clipped at the bottom right |
| pagoda | 7 | 8 | 6 | Five tiers, finial. Seen from close below: the plinth is cut off and it looks squat and front-on |
| triceratops | 3 | 2 | 6 | Fully framed three-quarter view, horns and frill read. Chunky stub legs |
| telescope | 5 | 5 | 7 | The tube is side-on on the tripod, so for the first time it reads as a telescope |
| teapot_house | 8 | 6 | 7 | Spout, handle, lid roof, door, window, garden. The polish lost, so it has less detail (41 parts) |
| **avg** | **5.8** | **5.0** | **6.7** | |

## Regressions / open

- Big things (locomotive, pagoda) are framed a little tight. The placement height of 0.75 S and `solveFrame`'s margin still let the bottom edge clip. Next: place at a distance where S fits about 70% of the vertical FOV, and/or loosen `MARGIN` for the post-land frame.
- The pagoda is symmetric, so the yaw doesn't help it. Things that are long only in height could skip the turn.
- The hero quality depends on whether the polish wins. Its loop 1 problems (serial reference image, ~65 s polish) are still unaddressed.
