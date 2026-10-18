# Conjure art direction: "Painted Toy World" (2026-10-17)

**The decision.** Conjure should look like a **soft-toon toy diorama under a painted sky**. Use Townscaper's materials and palette discipline, the sky and atmosphere of Firewatch and Sky: Children of the Light, and the grass and warmth of Lil Gator Game. Shapes are rounded and chunky. Light falls in two or three soft bands. Every colour comes from one curated palette. Distance dissolves into coloured height fog. There is no realism, no textures and no ink outlines.

**Why this direction.** Today a generated object is judged against PBR lighting, and PBR exposes every flaw: a single flat colour, a box with razor edges, a part floating 5 cm off the body, a grey that clashes with the sky. In a toy-diorama style those flaws read as charm, so the style does part of the model's job. A Haiku draft with 8 parts and an Opus refine with 120 parts should look like they came from the same game. The current baseline renders with PBR, ACES tone mapping, a linear fog and an unfiltered colour from any model. It looks "clean demo", not "game" (see `baseline_eval.md`).

---

## 1. References (what to take, what to leave)

| Reference | What makes it look modern with low detail | Take | Leave |
|---|---|---|---|
| **Townscaper** (Oskar Stålberg, 2020) | Every block is bevelled. The palette is small and tuned. Soft AO sits in every corner. Anything you place looks good next to anything else. | **The core argument:** palette snapping plus bevels plus contact shadows make arbitrary placement look designed. That matches Conjure's problem exactly. | The tile grid and the purely architectural vocabulary. |
| **Lil Gator Game** (2022) | Soft cel shading with 2–3 tones, saturated pastels, wind-swept grass tufts, chunky props and a warm sky. Open world, very little geometry. | Toon ramp, grass treatment, prop chunkiness, the "everything is a toy" scale. | Its thick dark outlines (too costly, and they fight the dreamy genie tone). |
| **A Short Hike** (2019) | Low-poly, rendered low-res and upscaled, with strong colour temperature by time of day and readable silhouettes at a distance. | Silhouette-first modelling, colour temperature per time of day, big readable landmarks. | The pixelation filter. It is a distinct signature and would hide our spawn animations. |
| **Zelda: The Wind Waker (HD)** | Two-tone cel shading, graphic clouds, a stylised sea with foam shapes, a huge expressive sky. | Puffy cloud billboards, stylised water (flat colour plus animated highlight shapes), a big sun disc. | The bloom and DOF of the HD release. |
| **Sky: Children of the Light** (2019) | Mood comes from light and fog, not geometry. Gradient skies, light shafts, layered haze, simple forms. | Height fog tinted by the sky, layered depth, golden-hour drama as the default "wow". | Its heavy volumetrics and particle density (mobile-tuned, but beyond our budget next to model-generated scenes). |
| **Firewatch** (2016) | Flat graphic colour planes. Distance is painted by fog that shifts hue (warm near, cool far). | Distance-banded hue-shifted fog, and the rule that each layer of depth gets its own value. | Its hand-authored per-scene colour scripts (we can't author per scene; the presets do it). |

Tunic, Journey and Alba were considered and rejected as primary references. Tunic is isometric and relies on DOF plus authored lighting. Journey is sand rendering, which is too specialised. Alba is close to Lil Gator Game but more realistic. A Short Hike and Lil Gator Game already cover that ground.

---

## 2. The look in one paragraph (for prompts and for reviewers)

> Rounded, chunky, toy-like forms with slightly exaggerated proportions. Every surface is lit in two or three soft bands (lit / mid / shade), never pitch black: shade is tinted by the sky. A thin bright rim catches silhouettes against the sky. Colours come from one warm, slightly desaturated palette, with one saturated accent per object. Things sit on soft contact shadows. The distance melts into fog that takes the sky's horizon colour. The sky is a painted gradient with big soft clouds. Glow is reserved for real light sources.

---

## 3. Technical recipe (three.js r186, 60 fps on an M-series laptop, in-browser)

Everything below is ordered by impact per hour. The first three items deliver about 70% of the look.

### 3.1 One stylised material for everything: `app/world/style/toon.ts` (new)

- **`toonMat(color, opts)`** replaces `mat()` in `app/world/kit/helpers.ts`, `tmat()` in `app/world/kit/terrain.ts`, and the material calls in `app/world/parts.ts`. Every kit builder, learned kind and forged part goes through it. `glowMat()` becomes `toonMat` plus emissive, with tone mapping off on the glow part so it reads as light.
- Base: **`MeshToonMaterial`** with a shared 4-texel **gradient ramp** (`DataTexture`, `LinearFilter`, not Nearest). The steps sit at about 0.35 / 0.62 / 0.85 / 1.0, so bands are soft. Toon materials honour fog, shadows, the hemisphere light and the fixed light pool (`app/world/perf/lights.ts`) with no extra cost.
- **Shade tint and rim** come from one `onBeforeCompile` chunk shared by every toon material. Use a constant `customProgramCacheKey` so it adds no program variants, which keeps `perf/precompile.ts` valid.
  - Shade tint: the darkest band mixes toward a global `uShadeTint` uniform (the preset's `hemiSky` darkened). Shadows become blue-violet by day and indigo by night, never black.
  - Rim: `pow(1 - dot(N, V), 3) * uRim` adds the sky-horizon colour. `uRim` is 0.35 by day, 0.6 at golden and dusk, and 0.25 at night.
- **Material presets** (`app/world/look.ts` `PRESETS`) map onto the toon base. Stylise them; do not drop them:
  - `matte`/`wood`/`stone`: plain toon. Wood and stone get a ±4% lightness jitter per part (deterministic by part index) so big merged objects aren't one flat slab.
  - `metal`: toon plus a hard specular band (one `smoothstep` on N·H in the same chunk, keyed by a `uMetal` uniform on the material, not a define).
  - `glass`: toon at opacity 0.45 with a doubled rim and a pale tint. Keep `transparent` set at build time (it is already a program key today).
- `flatShading` stays off. The ramp on smooth normals gives the toy look; flat shading makes low-poly spheres look broken.

### 3.2 Palette snapping: `shared/world/palette.ts` (new, pure, unit-tested)

- **The palette:** 9 hue families (red, orange, yellow, green, teal, blue, purple, pink, brown) × 4 values (deep / base / light / pale), plus 6 neutrals (warm white, cream, warm grey, cool grey, charcoal, near-black `#24222a`). That makes 42 swatches. Lightness and chroma are tuned in **OKLCH**: base chroma about 0.11, which is not candy, and nothing below L 0.18. The current intent palette (`server/utils/intent.ts` line ~98) becomes a named subset of it.
- **`stylize(hex, role)`**, applied at the material boundary (`toonMat`, `lookTargets` in `app/world/look.ts`, and the `modify` colour wipe):
  1. Convert to OKLCH, clamp chroma to ≤ 0.16, and clamp L to [0.2, 0.93] (no pure black or pure white).
  2. Find the nearest swatch by ΔE in OKLab, then **blend 75% toward it**. That keeps a little of the model's intent while killing off-key colours.
  3. `role: 'glow'` skips the chroma clamp, because lights may be vivid. `role: 'terrain'` gets an extra −15% chroma so the ground never out-shouts props.
- When a player asks for a colour ("make it red"), it resolves to the palette's red. The colour is honoured; the hex isn't.
- Per-instance hue jitter (`look.ts`) stays, but runs **after** snapping and only on lightness ±6%, so a cluster still varies without leaving the palette.

### 3.3 Atmosphere: sky, fog, clouds (`app/world/renderer.ts`, `app/world/atmosphere.ts`)

- **Height fog** replaces the linear `THREE.Fog`. Override `ShaderChunk.fog_fragment` once, globally:
  - fog = distance fog (exp², from `fogNear`/`fogFar`) × height falloff (`exp(-max(worldY - fogBase, 0) * uFogHeight)`).
  - Mountains keep their peaks while valleys fill with haze, which is the Sky and Firewatch layering.
  - The fog colour is **a mix of `skyHorizon` and `fog` by view elevation**, so the ground's far edge always meets the sky with no seam. This also drops the separate `veil` hack in the sky shader to one code path.
- **Hue-shifted distance:** add `fogWarm` and `fogCool` to each preset. Near fog leans warm and far fog leans cool. That is Firewatch's depth trick, and it costs one mix in the fog chunk.
- **Sky dome shader:** keep the gradient and add (a) a big flat **sun disc** with a soft ring (`smoothstep` on the angle to `sunPos`) instead of the `glowSprite`, and (b) a horizon **glow band** at golden and dusk.
- **Clouds** (`app/world/fx/clouds.ts`, new): 24–40 puffy cloud clusters. Each is 4–7 overlapping sphere billboards from one `InstancedMesh` with a toon-shaded impostor (a radial normal from UV), lit by the sun direction. They drift slowly and are tinted by the preset (`cloudLit` and `cloudShade`). Use one draw call. Storm weather darkens them and raises their count. No raymarched or volumetric clouds.
- **Preset changes** in `ATMOSPHERES`: add `shadeTint`, `rim`, `fogWarm`, `fogCool`, `fogHeight`, `cloudLit`, `cloudShade`, `cloudCover` and `grade` (see 3.4). Retune every preset against the palette. The default starting look becomes **golden-hour day**, not the current dusk with a grid. The grid survives as a faint "dream canvas" line pattern on the ground in the first-run empty world only.

### 3.4 Tone mapping and one post pass: `app/world/style/post.ts` (new)

- **Tone mapping: switch from ACES to `NeutralToneMapping`** (Khronos PBR Neutral). ACES desaturates and hue-shifts the palette (reds go orange, blues go purple). Neutral keeps snapped colours on-model.
- **One full-screen composite pass, and only one.** Render the scene into a `WebGLRenderTarget` with `samples: 4` (MSAA, replacing canvas AA) and a depth texture. A single fragment shader then does:
  1. a **colour grade**: lift the shadows toward the preset's `grade.shadow` and push the highlights toward `grade.highlight`, saturation ×1.08, with a gentle S-curve;
  2. **soft depth edges**: a 4-tap depth discontinuity, darkened by 18% and faded to zero by 40 m. This gives the "drawn" separation between overlapping props without ink outlines or a normal buffer;
  3. a **vignette** at 0.12;
  4. **fake bloom off**. Glow is carried by halo sprites (3.6), so there is no blur pyramid.
- **Budget:** under 1.2 ms at 1440×900 on an M4 Pro. Cap the pixel ratio at 1.5 while post is on. Add a **dynamic resolution** guard: if the 1 s average frame time is above 18 ms for 2 s, drop the render-target scale to 0.85, and if it is above 22 ms, to 0.7. Recover after 5 s under 14 ms.
- No SSAO, SSR, DOF, motion blur, god rays or `UnrealBloomPass`.

### 3.5 Shapes: bevels and contact shadows (`app/world/parts.ts`, `app/world/kit/*`)

- **Rounded boxes.** The unit `box` in `parts.ts` `GEOMETRY` becomes `RoundedBoxGeometry(1, 1, 1, 2, r)`. Because parts are scaled non-uniformly, bevel in the **vertex shader** instead (the shared toon chunk pushes normals toward the box corner by `uBevel`). That is a "normal bevel": free, and identical for every scale. Kit builders that use `BoxGeometry` get the same treatment through `toonMat`, with no geometry changes.
- **Segment counts drop:** spheres 14×10, cylinders and cones 14 radial, tubes 10. The ramp hides facets and the draw count stays flat.
- **Contact shadows** (`app/world/fx/contact.ts`, new): one instanced radial-gradient quad under every grounded entity, scaled to its footprint, at 35% opacity and multiplied with the ground. This grounds every generated object even when the sun shadow is soft or off-screen, and covers the "floats 5 cm off the ground" look. The sun shadow map stays (2048, `PCFSoftShadowMap`) but its frustum tightens to ±30 m around the player for sharper close shadows.

### 3.6 Glow and lights

- The **fixed light pool stays exactly as it is** (6 point + 6 spot, constant count, `perf/lights.ts`). The style must not add lights. Toon materials respond to the pool lights like standard ones, and the shade tint keeps unlit areas readable at night.
- **Glow halos:** each `glow`-slot mesh above 0.15 m gets an additive camera-facing halo sprite from one shared `InstancedMesh` (pooled to 256), sized by the mesh's bounds and tinted by its colour. This is the "bloom" of lamps, lanterns, neon and eyes at near-zero cost.
- Emissive intensities are normalised by role: lamps 1.6, neon 2.2, eyes and crystals 1.2. Model-chosen glow values are clamped to this table.

### 3.7 Ground, grass, water

- **Ground** (`renderer.ts` ground plane and `kit/terrain.ts`): two-tone world-space noise patches (large and low-frequency) in the toon chunk, with the base and an alternate swatch taken from the preset's ground family. A lighter tint is added on upward-facing slopes and a darker one on steep faces, which replaces the per-triangle colour jitter. No textures.
- **Grass** (`app/world/fx/grass.ts`, new): one `InstancedMesh` of 3-triangle blade tufts, about 12k instances in a 28 m disc that recentres on the player in 4 m steps. Vertex-shader wind sway uses a world-space noise "gust" wave (Lil Gator). Colour comes from the ground colour at the root, lighter at the tip. Grass is skipped where the ground has `water`/`floor`/`road` entities on it (a coarse 1 m occupancy grid rebuilt on world change) and on non-grass presets (interior, city, desert, snow). It costs one draw call and about 0.4 ms. It is also the single biggest "this is a game" cue, and it makes "make me tiny" read (see eval issue 8 in `loops/final_eval.md`).
- **Water** (`kit/terrain.ts` river/lake/ocean and `kit/outdoor.ts` water): one shared stylised water material. A flat deep-to-shallow colour from the palette's teal/blue family uses fresnel toward the sky colour. Animated cellular highlight shapes (Wind Waker style) come from two scrolling noise lookups in the shader. There is a gentle vertex swell and a foam ring texture on the `shore` kind. No reflections or refraction render targets.

### 3.8 What the models are told about style

The point of art direction is that the models aim at a narrower, friendlier target. Add one shared constant, `STYLE`, in `server/utils/style.ts` (new), and use it in all four prompts:

> STYLE: chunky toy-diorama. Rounded, slightly exaggerated masses; recognisable from 20 m by silhouette alone. Thick parts: nothing thinner than 6% of the object's height except rope, wire or antennae. Heads, wheels, hands, roofs and other signature features 15–30% bigger than real. 3–5 colours per object, using palette names: one main colour on the big masses (slot primary), one secondary (trim), one small saturated accent. Prefer warm, slightly muted tones; never pure black or white. Glow only on things that give light. No text, no thin decorative detail, no tiny parts under 4 cm. Every part touches or overlaps another; the object sits on the ground.

- **Haiku define** (`server/utils/intent.ts`, define rule): add `STYLE` plus "**6–16 parts**: big masses first". Today's limit is up to 32. Fewer, chunkier parts look better in this style and land faster. The palette line lists **names**, and the client resolves them through `stylize` anyway.
- **Forge refine** (`server/utils/forge.ts` `FRAME`/`LIVE`): replace "Use 3–6 harmonious colours" with `STYLE`. Set the part targets to **good 30–90** and **hero 90–180**. The current cap of 200 stays as a cap, but more parts are not better in this look. Change "low-poly 3D sculptor" to "toy-diorama sculptor".
- **Forge reference image** (`refPrompt`): "Chunky stylised 3D toy, soft cel shading, rounded bevelled shapes, 3–5 muted colours with one bright accent, three-quarter view…". The reference must already look like the target style, or the refine chases realism.
- **Director** (`server/utils/director.ts`): add `STYLE` plus "Pick a colour script for the place: one dominant family and one accent family from the palette. Tint walls, floors and props within those two families. Night places stay dark with lit accents." This replaces the ad hoc per-example hexes.
- **Judge** (`/api/forge/judge`): add "prefers chunky readable silhouettes and the palette over detail count".

### 3.9 Performance guardrails (non-negotiable)

- **One** post pass. **No** new lights. **No** per-object custom shaders written by a model. The toon chunk is one cached program family. The program count after warm-up must not grow when a place builds (check with `renderer.info.programs.length` in `scripts/gauntlet.mjs` once the style lands).
- Draw calls: grass 1, clouds 1, halos 1, contact shadows 1, post 1. The forge's merged bodies stay merged.
- The gauntlet's fps column must stay at 60 avg / ≥ 55 worst 1 s on every scenario. Re-run `node scripts/gauntlet.mjs` before and after each style sprint and compare screenshots side by side.

---

## 4. Anti-goals (do not do these)

- **No PBR realism, textures, photo-sourced assets or normal maps.** No HDRI environment beyond the current dim RoomEnvironment for glass and metal speculars.
- **No black ink outlines on everything** (Borderlands or a strong Lil Gator look). Use soft depth edges only.
- **No bloom-soaked neon** in daylight, and no saturated rainbow "AI demo" colour. The palette clamp exists to prevent it.
- **No pure black shadows** and no pitch-black night. Night is indigo and readable.
- **No heavy post stack** (SSAO, SSR, DOF, god rays, TAA). It doesn't fit next to model-built scenes at 60 fps.
- **No pixelation or dithering filter.** It is a signature look, not ours, and it hides arrivals.
- **No letting the model invent materials, shaders or exact hexes that bypass `stylize`.** The model chooses intent (colour name, slot, material); the engine owns the look.
- **No chasing detail counts.** A 200-part object that breaks the silhouette rule loses to a 40-part object that keeps it.

---

## 5. Rollout (one sprint each, re-run the gauntlet after each)

| # | Sprint | Files | Expected gain |
|---|---|---|---|
| S1 | Toon material factory, shade tint, rim, palette `stylize`, Neutral tone mapping | `app/world/style/toon.ts`, `shared/world/palette.ts`, `kit/helpers.ts`, `kit/terrain.ts`, `parts.ts`, `look.ts`, `renderer.ts` | Cohesion jumps: forged, Haiku and kit objects stop looking like three games. |
| S2 | Height fog, sun disc, clouds, preset retune, golden default start | `renderer.ts`, `atmosphere.ts`, `fx/clouds.ts` | The "painted sky" wow, and depth layering in every teleport. |
| S3 | Composite post pass (grade, depth edges, vignette, MSAA, dynamic res) | `style/post.ts`, `renderer.ts` | A finished, filmic frame. |
| S4 | Normal-bevel, contact shadows, glow halos | toon chunk, `fx/contact.ts`, `fx/halo.ts` | Generated objects look grounded and toy-like. |
| S5 | Grass and water | `fx/grass.ts`, water material in `kit/terrain.ts` and `kit/outdoor.ts` | "This is a game", and tiny mode reads. |
| S6 | `STYLE` in all prompts, part targets, reference prompt, judge | `server/utils/style.ts`, `intent.ts`, `forge.ts`, `director.ts` | Models aim at the style; fewer parts give faster drafts. |
