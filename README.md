# Yunque Celestial Sect

A desktop Web 3D exploration game set around a 420 m mountain sect above a sea of clouds, with four outer regions across a world about 6 km on a side. In ordinary exploration, walk the grand stairs or fly on a sword, ride the spirit winds and race flight trials, board the Kun or the cloud-sea turtle, discover inscriptions and overlooks, gather spirit lights, and photograph colossi and sky phenomena through a day-night cycle and five weather states. Black Mist Invasion adds environmental attacks and evasion to the altered world. The focus remains atmosphere, traversal, and exploration, without player weapon combat, health bars, or quests.

The game supports English and Simplified Chinese. English is the first-visit default. Change languages from the title screen or the pause/settings menu; the choice is saved locally and does not alter game-save data.

Historical product proposals are kept in `docs/archive/`. The retired combat pipeline retains only its archive note and generation manifest in Git; paid original downloads remain local and ignored. `.tripo/` contains local CLI state and is not versioned. Current assets and rebuild recipes are documented in `asset-pipeline/black-mist/README.md`.

## Quick Start

Requirements: Node.js 22+ and the Vite+ CLI (`vp`, [installation guide](https://viteplus.dev/guide/)). The package manager is pinned to pnpm 10.34.5 in `package.json`.

```bash
vp install --frozen-lockfile
vp run dev
vp run build
```

Open the Vite URL, choose a character, wait for the world to load, then select **Enter the sect**. The game targets desktop Chrome and Edge with a discrete GPU.

Select **Black Mist Invasion** on the title screen for a 68-second environmental cinematic: an enormous eastern storm front engulfs the sect, its stonework becomes veined and darkened, giant tentacles emerge around the mountain, and a colossal eye is revealed above the main hall. Flesh growths spread across the main hall, gate and side towers; the Kun and giant turtle develop attached eyes, tendrils and swollen tissue. Close views follow both beasts without changing their paths. The eye and tentacles use inspected Tripo models with sculpted organic anatomy, 4K PBR color/normal/roughness maps, and reduced distant LODs. The changed sky, ash, living landmarks, and ominous soundscape persist during exploration, with no additional disciples. Press Space or choose **Skip cinematic** to reach the same altered world immediately. Esc pauses the cinematic and opens settings; **Explore the altered world** hands back mouse control. **Replay cinematic** restarts the event. Walking, sword flight, boarding, interactions, and photography remain available. Spirit lights, their collection compass, and collection are disabled in this mode; saved collection progress is retained for ordinary exploration. Creature assets load only after selecting this mode; the cinematic waits for them and offers a localized retry if loading fails.

Black Mist reveals six horror creatures: a 530 m Shroud Watcher, a 430 m Abyss Behemoth, and four 130–210 m variants distributed across separate cloud-sea patrols. The variants reuse the two existing paid models without additional generation credits. Their real PBR bodies breathe, articulate their limbs, plant them, and raise their heads to roar. Each actor has its own patrol clock, which slows while it senses a nearby player, turns, anticipates a strike, and swings an actual limb. Roar voices follow that actor's current pose, with distance attenuation, stereo direction, and pause/mute handling. Rooted giant tentacles change idle direction and carry contractions through their complete curled anatomy; their upper bodies and tips track and swing toward nearby players. The iris turns within a fixed socket. Kun and turtle parasites remain recessed into their hosts, with skin-colored membranes following the original skinned surface.

Twelve smaller organisms grow from the plaza and actual lower building faces. They use original Behemoth wrist/claw geometry, real tentacle and eye meshes, and pulsing PBR membranes. A visible 1.3-second membrane bulge and limb rise precedes each short strike; move away, sprint past, or fly around it. Main arrival routes and waygates retain open space. Contact with an active limb returns the character to the nearest of all nine waygates by world distance, including altitude, releases a ridden carrier, and gives four seconds of protection. Attacks are disabled during the cinematic, settings, photo mode, review, hidden pages, and graphics recovery. A separate living clock preserves pose and sound pauses; low heartbeats, wet anticipation sounds, and proximity pressure accompany exploration.

Use `vp add` / `vp remove` for dependency changes and commit both `package.json` and `pnpm-lock.yaml`. The lockfile remains pnpm-managed through the `packageManager` declaration; do not introduce another package manager or lockfile. Vercel uses the Vite preset, `vp run build`, and the `dist` output directory. To make Vercel honor the `packageManager` version through Corepack, set `ENABLE_EXPERIMENTAL_COREPACK=1`; see [Vercel package managers](https://vercel.com/docs/package-managers).

## Controls

| Action                                                                                      | Input            |
| ------------------------------------------------------------------------------------------- | ---------------- |
| Move / look                                                                                 | W A S D / mouse  |
| Sprint / accelerate in flight                                                               | Shift            |
| Jump on foot                                                                                | Space            |
| Summon sword, board, and fly; press again to land; F in midair calls the sword to catch you | F                |
| Ascend / descend / brake in flight                                                          | Space / C / X    |
| Look around while keeping the flight heading                                                | Hold Alt + mouse |
| Switch characters and matching swords                                                       | 1 / 2            |
| Interact with steles, bell, altar, overlooks, cushions, or waygates                         | E                |
| Open the map, codex, and collection scroll                                                  | Tab              |
| Photo mode: free camera, focal length, filters, vignette, PNG export                        | P                |
| Hide the HUD                                                                                | H                |
| Pause, settings, and controls / exit a cinematic                                            | Esc              |
| Mute                                                                                        | M                |
| Debug panel / collision helpers                                                             | F3 / G           |

Movement and photo mode use physical key codes. Ctrl is not used to descend. Blur, pointer-lock loss, and Cmd shortcuts clear held keys. Settings and the scroll suspend player input while the world continues to run; riding the Kun and cloud-entry rescue remain active. Esc exits photo mode directly; click the scene to resume, then press Esc again to open settings. Consecutive PNG exports use unique filenames.

## World

- **The sect:** a 380 × 450 m stone plaza, a 420 m main hall, a mountain gate, six side towers, walkable slopes, and a long central stair. The surrounding world includes 36 procedural karst pillars, eight floating isles, two walkable suspension bridges, waterfalls, distant ridges, and a horizon of mountain ranges.
- **Outer regions:** the flyable world spans x ±3000 m and z −3300…2700 m, with a 1600 m flight ceiling. Azure Vault Peaks to the north hold a seated sage about 375 m tall on a terrace facing the main hall. Dragonspine Ridge to the east rises around a dragon-coiled pillar about 660 m tall. The Tomb of Myriad Swords to the west is a broken mesa with sword-scar canyons, five great swords, and 180 instanced lesser swords. The Guixu Cloud Sea to the south has 20 sea stacks and a sky gate about 360 m wide. Six outer pillar clusters fill the gulfs between regions, and the horizon ranges sit 5.8–8.5 km out.
- **Colossal landmarks:** two guardian statues rise from the clouds; a 460 m sword pierces an eastern peak; the 310 m Kun circles the mountain and breaches the cloud sea; a 120 m armillary sphere turns above the main hall; five chains tether Cloudbound Isle to the pillars.
- **Vegetation and atmosphere:** procedural Huangshan pines sway in the wind. Nearby GPU grass reacts to wind, footsteps, low flight, and snow. The sky uses atmospheric-scattering look-up tables; medium and high quality render volumetric clouds. Clear weather, mist, rain, snow, and storms cycle over a moving day-night clock.
- **Movement:** walk, sprint, jump, climb the roof tiers, and fly at 45 m/s cruise speed or up to 140 m/s boosted speed. The shoulder camera avoids walls and props; the sword catches the player during a dangerous fall.
- **Kunback exploration:** during the level-flight segment of its route, board the Kun, walk or jump across its animated back, and collect six spirit lights in ordinary exploration. The character, feet, and camera follow its skinned surface. Press F to leave with the Kun's velocity; cloud-entry rescue is available near the end of the route.
- **Turtleback:** a mountain-bearing turtle cruises a closed loop through the southern cloud sea. It can be boarded at any point on its route; walk its shell among rocks, pines, and a pavilion, and collect three spirit lights on the pavilion's terrace in ordinary exploration. Press F over any gentle, open part of the back to land on it. A Blender-rigged `swim` clip strokes its flippers and turns its head while the shell and everything on it stay rigid; the head and neck are not walkable.
- **Spirit winds and flight trials:** six wind streams link the regions: a ring through all four, four spokes from the sect, and an updraft coiling the dragon pillar. Flying with a stream borrows its speed; flying against it slows you. Each region has a ring course (10, 11, 10, and 8 rings): pass through the first ring from the front to start the timer, then take the rings in order. Landing, teleporting, straying more than 1500 m, or exceeding 10 minutes ends the run. Best times appear in the scroll.
- **Compendium:** 14 entries cover seven colossi, three creatures (the Kun, the turtle, and cranes), and four sky phenomena. Photos taken in photo mode count when the subject fills enough of the frame and is not hidden behind terrain, the cloud sea, or other colliders; a framing hint shows before the shutter. Entries appear on their own scroll tab.
- **Discoveries:** 37 interaction sites include steles, a bell, a weather altar, meditation cushions, overlooks, and waygates; each outer region has its own stele, overlook, and waygate. Overlooks reveal their region on the map, and waygates are discovered by visiting them. In ordinary exploration, gather all 86 spirit lights; the compass points toward the nearest uncollected cluster, and the map markers follow the Kun and the turtle.
- **Sound:** wind, rain, thunder, wildlife, a pentatonic music bed, guzheng plucks, and movement effects are synthesized locally. Set channel volumes in the pause menu.
- **Black Mist sound:** a bronze alarm, approaching layered wind and pressure, thunder, cracking stone, resonant transformation cues and deep organic pulses for the two beast reveals use the same master/music/ambience/SFX settings. Pausing or hiding the page silences the cinematic; the original calm music gives way to the altered-world ambience.
- **Assets:** Tripo models include the guardians, sword, Kun, seated sage, dragon pillar, sky gate, turtle, and several props. Other assets use Blender procedural modeling and animation. Props use instancing and distance-based LODs.

## Saves and Recovery

Progress, character choice, and settings are autosaved to `yunque.save.v2`. A fixed mapping migrates the 60 legacy v1 spirit-light IDs while retaining the old data. Malformed JSON is backed up before recovery; unknown versions and backup failures preserve the original and pause writes. Storage errors stop retries for the session and are shown on the title or settings screen.

Flight-trial best times and compendium entries are optional fields of the same v2 save. Only safe static ground positions are saved; jumping, falling, and riding the Kun or the turtle do not become checkpoints. Hidden tabs suspend audio and restore the unlocked audio context when visible again. If WebGL loses its context, the game rebuilds the canvas, preserves in-session progress and settings, and returns to the last safe checkpoint. A 12-second timeout exposes a manual retry.

## Rendering and Performance

The settings menu offers **Low**, **Medium**, and **High** quality. Resolution adapts to frame rate; optional auto quality can step down a preset after resolution scaling reaches its minimum. High quality includes four cascaded shadow levels, N8AO, Bloom, god rays, and 4× MSAA. The established draw-call budget is at most 400; the R9 baseline peaked at 296 on an RTX 5060 Ti. Final R18 verification covers 84 Black Mist views across all three tiers, including all six creatures' patrol/roar views and ground/wall tissue, and peaks at 318 calls in the high-quality aftermath hero view. Ordinary exploration's 45 views also peak at 318 calls, on the high-quality storm road. Both reports have zero budget breaches and browser errors. Outer-region terrain casts shadows only while the camera is within 500 m of that region; all wind streams share one draw, as do all trial rings. CPU throttling is not a substitute for testing on a low-end GPU. See [PROGRESS.md](PROGRESS.md) for the recorded environment and measurements.

Photo mode and the scroll load on first use. The current main bundle with Black Mist is 824.52 kB JavaScript (284.52 kB gzip). R18 completed final validation on October 8, 2026: 142 hazard cases, 57 cinematic-flow cases, 70 creature-motion cases including graphics recovery, 157 tentacle/eye/carrier motion cases with a 14-second full-body recording, and 35 sky checks with zero seam-byte jumps. All passed with no browser errors. Kunback queries reuse skinned bone matrices each frame; the recorded local index time improved from 3.40 ms to 1.69 ms.

## Asset Pipelines

- `vp run assets:buildings` generates building LOD0/LOD1 assets from source GLBs under `public/assets/models/`.
- `vp run assets:optimize` generates optimized character and sword GLBs. See [CHARACTER_PIPELINE.md](CHARACTER_PIPELINE.md) and [OPTIMIZATION.md](OPTIMIZATION.md).
- `vp run assets:black-mist --eye <source.glb> --tentacle <source.glb>` preserves the inspected creature anatomy and creates 4K/1K PBR LODs; see [the Black Mist asset pipeline](asset-pipeline/black-mist/README.md) for source task IDs, costs, and regeneration.
- `vp run assets:horror --watcher <source.glb> --behemoth <source.glb>` builds the two approved horror-creature LOD chains and their separate source metadata.
- `asset-pipeline/` contains source and generation tools for buildings, colossi, the Kun, rocks, vegetation, textures, and retargeted animation. Large source assets are ignored by Git. Blender scripts require Blender 5.2.
- `node scripts/tripo/generate.mjs [--only id1,id2] [--force] [--optimize-only]` runs the prop-generation pipeline. Set `TRIPO_API_KEY` in the environment; never commit credentials. Generated downloads under `asset-pipeline/tripo/` are ignored.

## Verification

Browser scripts locate Chrome on Windows, macOS, and Linux, then try Playwright Chromium. Set `CHROME_PATH` to override discovery. Most scripts expect the dev server at `BASE_URL` (default `http://127.0.0.1:5173/`). `verify:loading` uses the production preview at `PREVIEW_URL` (default `http://127.0.0.1:4174/`). Reports and screenshots go under the ignored `artifacts/` directory.

| Command                                 | Coverage                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp run verify:smoke`                   | Load, pointer lock, real input, flight, and rendered output                                                                                 |
| `vp run verify:ui`                      | Language switching, accessibility targets, settings, saves, photo mode, React commits, and audio-node cleanup                               |
| `vp run verify:black-mist`              | Mode entry, cinematic timeline/pause/skip, altered-world landmarks, audio lifecycle, and exploration handoff                                |
| `vp run verify:black-mist-perf`         | Cinematic shots and altered-world views on all three quality tiers; draw calls ≤400                                                         |
| `vp run verify:black-mist-sky`          | Actual sky-material direction probes across the former longitude seam and varied times/quality tiers                                        |
| `vp run verify:black-mist-hazards`      | Real posed limb contacts, anticipation/evasion, nearest-waygate respawn, safe footing/grace, mode and pause gates                           |
| `vp run verify:black-mist-attack-poses` | CPU real-source anticipation/strike/recovery, indexed strain, rooted attachment, capsule anatomy and render culling                         |
| `vp run verify:eldritch-assets`         | Tripo provenance, actual GLB anatomy/PBR maps, loading behavior, near/far LODs and detailed screenshots                                     |
| `vp run verify:black-mist-mutations`    | Building flesh coverage, animated beast attachments, mode isolation, LODs and retained carrier decks                                        |
| `vp run verify:eldritch-motion`         | Actual rooted tentacle skinning, ocular rotation, skin fusion, life-clock pause gates and a WebM motion capture                             |
| `vp run verify:horror-assets`           | Approved horror-generation receipts, geometry/PBR maps, LODs, and creature apparition/detail views                                          |
| `vp run verify:horror-clearance`        | Both continuous carrier loops/native skins and 91 body pairs, with coherent real triangle interaction envelopes and explicit sample margins |
| `vp run verify:horror-terrain`          | All six actors' 22 normal poses plus 768 attack poses each; actual high/low source vertices against terrain/pillar cylinders                |
| `vp run verify:horror-motion`           | Actual articulated vertices, patrol/stop/roar behavior, synchronized audio, pauses and LODs                                                 |
| `vp run verify:interact`                | Interactions, exact spirit-light count, scroll, focus, photo, save/restore, draw-call deltas, and page errors                               |
| `vp run verify:perf`                    | Three quality levels across 45 scenes plus the Kun deck; draw calls ≤400; supports `MIN_FPS`                                                |
| `vp run verify:visual`                  | Time-of-day and weather views with brightness/contrast checks                                                                               |
| `vp run verify:characters`              | Both characters, sword summon/flight, switching, and pause/resume                                                                           |
| `vp run verify:navigation`              | Gate, stairs, hall collision, and high-altitude traversal                                                                                   |
| `vp run verify:optimization`            | Asset size, foot constraints, switching, braking, camera, and audio                                                                         |
| `vp run verify:riding-pose`             | Flight pose, foot contact, and non-black screenshots                                                                                        |
| `vp run verify:controls`                | 60/144 fps jumps, repeated keys, blur/lock loss, and photo input                                                                            |
| `vp run verify:save`                    | v1 migration, malformed/unknown saves, storage failures, and safe positions                                                                 |
| `vp run verify:motion`                  | Sword summon/landing avoidance and cliff paths at 20/60/144 fps                                                                             |
| `vp run verify:jumps`                   | Both characters jumping onto a 1.2 m ledge at 60/144 fps                                                                                    |
| `vp run verify:kun`                     | Boarding, movement, jumps, edge cases, rescue, collection, map, and docking window                                                          |
| `vp run verify:turtle`                  | Turtle spirit lights over open deck, collected on foot around the pavilion                                                                  |
| `vp run verify:stability`               | Audio lifecycle and WebGL context-loss recovery                                                                                             |
| `vp run verify:framerate`               | Jump and trail behavior at 20/60/144 fps                                                                                                    |
| `vp run verify:environment`             | Graybox/review views, geometry, and source-building hashes                                                                                  |
| `vp run verify:profile`                 | CPU throttle, Kun index/anchor timing, static queries, and GPU passes                                                                       |
| `vp run verify:loading`                 | Production lazy loading, first use, quality/character changes, and WebGL recovery                                                           |

The clearance check runs without a dev server or GPU and writes `artifacts/horror-clearance/report.json`, including exact shared layouts and source hashes. It analytically bounds both carriers' native skins, keyed translations/scales, complete continuous routes, and the turtle's heave. Interaction checks clip the actual high/low source triangles into their current height bands: 64 tentacle gesture poses across all eight slots with a 0.05-height margin, and 384 creature poses across eight target octants, four target heights and both leading hands with a 0.03-height margin. Cinematic emergence and fully revealed attacks are checked as distinct phase sets. These interaction envelopes are dense samples with declared margins, not all-time analytic proofs. The earlier natural-muscle bound and production culling evidence remain separately recorded. Horror idle reserves of 0.09/0.18 height are also sampling cushions, checked over two full cycles.

To check the creatures' actual four-weight skinning, planted limbs, gait/roar transitions, continuous root transforms, and sampled terrain/pillar clearance without a browser, run:

```bash
node --experimental-strip-types scripts/verify-horror-skinning.mjs
node --experimental-strip-types scripts/verify-horror-terrain.mjs
vp run verify:black-mist-attack-poses
```

The skinning report is saved to `artifacts/black-mist/horror-motion/skinning-report.json`, and the attack report to `artifacts/black-mist/attack-poses/report.json`. The terrain report at `artifacts/horror-terrain/report.json` retains the original 22 fully revealed normal poses per actor and adds both real LODs at four patrol anchors, eight turn/target octants, four target heights, and either leading hand during windup/strike. It tests visible vertices at stride 47 against the actual terrain functions and shared pillar cylinders, with zero penetration required. This is sampled vertex coverage, not a continuous-time or full-triangle terrain proof. These CPU checks require Node.js 22+ and the generated local GLBs.

The browser motion check saves its pose/audio report, screenshots, and WebM captures containing the actual game audio under `artifacts/horror-motion/`.

The full hazard check passes 142 cases, including actual hits from all four hazard kinds, nearest-waygate selection across all nine gates and altitude, stable recovery/grace, summoning interruption, boosted flight above 100 m/s, teleport-sweep isolation, pause/photo/review/audio gates, delayed patrol roars, exact saved spirit-light IDs, and all three quality tiers. Its report is `artifacts/black-mist-hazards/report.json`. The [12-second creature attack](artifacts/black-mist-hazards/creature-watcher-approach-windup-strike-12s.webm) and [12-second ground-organ attack](artifacts/black-mist-hazards/ground-organ-0-approach-windup-strike-12s.webm) recordings each contain one actual mastered game-audio track in VP9/Opus WebM.

The tentacle CPU check uses both original GLB LODs and 13 poses selected from muscle-region extrema and all eight phases. It evaluates the actual four-weight buffers, checks all three edges of each triangle apart from near-degenerate edges, measures volume and root drift, and retains the source-file hashes and PBR maps:

```bash
node --experimental-strip-types scripts/verify-tentacle-skinning.mjs
```

Its report is saved to `artifacts/black-mist/tentacle-motion/skinning-report.json`. The browser `verify:eldritch-motion` check also inspects real indexed vertices from the lower shaft, middle, crook and tip in both LODs.

To run a throttled low-quality performance sample in PowerShell:

```powershell
$env:QUALITIES = 'low'
$env:WIDTH = '1280'
$env:HEIGHT = '720'
$env:CPU_THROTTLE = '4'
$env:PERF_OUT = 'artifacts/perf-low.json'
vp run verify:perf
Remove-Item Env:QUALITIES, Env:WIDTH, Env:HEIGHT, Env:CPU_THROTTLE, Env:PERF_OUT
```

For production loading checks, run `vp run build`, start `vp run preview --port 4174 --strictPort` in another terminal, then run `vp run verify:loading`. GPU pass profiling is enabled in a development build with `?profileGpu`; normal performance checks use production rendering behavior.

Development query parameters include `?quality=low|mid|high`, `?hours=17.5`, `?weather=storm`, `?kunAt=40`, and `?env=graybox`. Development builds expose verification hooks such as `__environmentReview`, `__setWeather`, `__setTimeOfDay`, `__kunSetTime`, `__ui`, and `__interact`. Rebuild the Kunback triangle/anchor index with `node asset-pipeline/kun/deck.mjs`.

The main scene layout is defined in `src/world/worldLayout.ts` and `src/world/sites.ts`; colossal placement is in `src/world/colossi/layout.ts`; atmosphere is in `src/world/sky/atmosphere.ts`; asset registration is in `src/world/worldAssets.ts`; and prop metadata is in `src/world/props/propCatalog.ts`. Known limitations and hardware-dependent follow-up work are tracked in [REMAINING_ISSUES.md](REMAINING_ISSUES.md).
