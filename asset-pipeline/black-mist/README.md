# Black Mist creature assets

The eye and tentacle replace the rejected procedural preview with inspected Tripo high-fidelity PBR models. Their original geometry, UVs, color maps, normal maps, and packed occlusion/roughness/metalness maps are retained. Runtime emergence moves the complete models; it does not flatten their anatomy.

The user approved both generation calls on 2026-10-07. `generations.json` records the actual requests and charges; `realistic-plan.json` contains the approved prompts and commands. The model is `tripo-v3.1` (`v3.1-20260211`) with Ultra geometry and detailed `v3.5-20260815` textures. Both calls succeeded for **100 credits total**, leaving **13,950 credits** at the recorded balance check.

| Asset    | Generation task                        | Actual credits | Full / distant triangles |
| -------- | -------------------------------------- | -------------- | ------------------------ |
| Eye      | `ebe158ba-29e4-48fc-a5ad-1eb4d9f2ba26` | 50             | 78,032 / 23,408          |
| Tentacle | `2e1ea6a1-5001-43ff-9e51-a9320c50b275` | 50             | 79,750 / 23,924          |

Original downloads live in the ignored `tripo-out/` directory. To restore those exact assets without generating or spending again, use the authenticated CLI:

```powershell
npx --yes tripo-cli@latest task get ebe158ba-29e4-48fc-a5ad-1eb4d9f2ba26 --download -o asset-pipeline/black-mist/tripo-out/abyss-eye-ebe158ba
npx --yes tripo-cli@latest task get 2e1ea6a1-5001-43ff-9e51-a9320c50b275 --download -o asset-pipeline/black-mist/tripo-out/abyss-tentacle-2e1ea6a1
vp run assets:black-mist --eye asset-pipeline/black-mist/tripo-out/abyss-eye-ebe158ba/model.glb --tentacle asset-pipeline/black-mist/tripo-out/abyss-tentacle-2e1ea6a1/model.glb
```

Credentials come from `TRIPO_API_KEY`. Do not commit them. A new generation or reroll requires its own approved credit plan.

`scripts/build-black-mist-assets.mjs` owns `assets.json` and the four GLBs under `public/assets/black-mist/`. It records source hashes, bounds, triangle counts and texture sizes, compresses with Meshopt, and creates a distant LOD at a 0.3 simplification ratio. Full models preserve 4K maps; distant models use 1K maps. Do not hand-edit its generated metadata. Runtime poses and layout belong to `src/world/blackMist/EldritchLandmarks.tsx`.

The measured model fronts face source +X. The eye rotates toward world +Z and measures 240 m wide. Tentacles normalize uniformly about the lower root, with roots outside the sect's bridges and paths. Medium/high quality chooses LOD by distance; low quality uses the distant models. Stock physical lighting and the existing atmosphere provide surface response.

Run `vp run verify:eldritch-assets` for source provenance, mesh/material checks and actual rendered near/far views. Run `vp run verify:black-mist` for the cinematic/exploration flow and `vp run verify:black-mist-perf` / `vp run verify:perf` for scene budgets. No paid conversion, rigging, texture pass or reroll was used for this batch.

## Building and carrier mutations

The additional building and beast mutations reuse these same four GLBs and add no paid generation calls. `src/world/blackMist/fleshGeometry.ts` authors connected, irregular lobulated patches with macro folds, creases and vessel coloration. Their UVs sample an inspected, cup-free skin island in the tentacle atlas; the original color, normal and ORM maps remain shared. This local tissue geometry is distinct from the Tripo-generated eye and tentacle anatomy.

`BuildingCorruption.tsx` samples physical side faces of the imported main hall, gate and six towers using the same transforms as `WorldAsset`. Upward roof/deck surfaces and the gate passage remain clear. Three tissue variants and two distance levels are instanced in at most six meshes, with density reduced across quality tiers. The growth shader affects visible tissue only; tissue does not cast undeformed shadow proxies.

`ColossusMutation.tsx` captures sparse triangle anchors on the original skinned Kun and turtle before their mixers start. Each attachment follows three posed vertices and their current normal frame. Eyes, tentacles and tissue are instanced per creature and LOD. Original skeletons, motion paths, walkable deck queries, boarding and save behavior stay unchanged. Run `vp run verify:black-mist-mutations` for growth/replay, scene isolation, physical attachments, building coverage, LODs and live exploration on both moving decks.

## Living anatomy and additional horror creatures

`tentacleMotion.ts` binds the actual curled source to a measured 12-joint muscle centerline. Four continuous dual-quaternion weights and eight instance phases preserve volume while the distal curl moves. The root stays pinned, and both LODs use the same palette. `scripts/verify-tentacle-skinning.mjs` validates actual geometry hashes, bone lengths, pinned roots, surface edge continuity and tip displacement. `eyeMotion.ts` tags the real ocular core and surrounding socket without changing source triangles or UVs; the core turns, the outer socket stays fixed, and the transition uses the rotation Jacobian for normals and tangents.

`bodySkinTransition.ts` projects small connected membranes onto the original carrier skin, stores real triangle/barycentric controls, and updates a sparse shared bone palette. Membrane rims embed about 0.15 asset metres and blend to the sampled host color. Each carrier now has three recessed eyes and two short side tendrils, leaving mouths, fins, the pavilion and deck routes readable.

The user approved a separate two-call production plan on 2026-10-07 with “同意使用积分”. `horror-plan.json` retains the exact prompts/commands; `horror-generations.json` retains successful receipts: Shroud Watcher `28f32cbc-7556-4bd5-8a81-ca4805323aa4` and Abyss Behemoth `f4630d28-21e8-45f0-8031-7e1cbf318bd5`. Both used v3.1 Ultra geometry and detailed v3.5 PBR, for **50 + 50 = 100 credits**, with **13,850 remaining** at the recorded balance check. There was no paid rigging, conversion or reroll.

`scripts/build-horror-assets.mjs` owns the four new public GLBs and separate `horror-assets.json`. To regenerate their optimized files locally:

```powershell
vp run assets:horror --watcher asset-pipeline/black-mist/tripo-out/shroud-watcher-28f32cbc/model.glb --behemoth asset-pipeline/black-mist/tripo-out/abyss-behemoth-f4630d28/model.glb
```

The Watcher retains 76,456 / 26,312 triangles and the Behemoth 77,480 / 34,428, with 4K / 1K embedded PBR maps. `HorrorCreatures.tsx` and `horrorLayout.ts` own their emergence, local breathing, world scale and distance LOD. All eight optional creature LODs share the mode's existing loading boundary and explicit retry. Normal exploration makes no requests for them. Run `vp run verify:eldritch-motion` for real browser motion/pause/skin checks and a ten-second WebM; run `vp run verify:horror-assets` for new asset provenance and rendered views.
