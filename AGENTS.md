# Repository Guidance

## Project

- This is a desktop WebGL exploration game built with React 19, TypeScript, Vite, React Three Fiber, Three.js, and Zustand.
- Keep gameplay scope focused on exploration, traversal, collectibles, photography, and the two playable characters. Do not add combat or quest systems without an explicit product change.
- The title is **Yunque Celestial Sect**. English is the first-visit language; Simplified Chinese remains supported.

## Commands and Dependencies

- Use Node.js 22+ and Vite+ (`vp`). The package manager is pinned to pnpm 10.34.5 in `package.json`.
- Install with `vp install --frozen-lockfile` in CI and clean checkouts.
- Use `vp add` / `vp remove` for dependency changes and update `pnpm-lock.yaml` with `package.json`. Do not add npm/yarn lockfiles.
- `vp run dev` starts the Vite+ development server. `vp run build` runs TypeScript project checks and creates the production build.
- Browser verification scripts require a reachable dev server at `BASE_URL` (default `http://127.0.0.1:5173/`). The loading verification uses a production preview at `PREVIEW_URL` (default `http://127.0.0.1:4174/`). Set `CHROME_PATH` when automatic Chrome discovery is unsuitable.
- Run the narrowest relevant `vp run verify:*` script after a change. UI changes should run `vp run verify:ui`; movement, interaction, rendering, save, and asset changes have dedicated verification scripts listed in `package.json` and `README.md`.

## Architecture

- `src/app/` owns application composition and graphics-context recovery.
- `src/ui/` owns DOM interface, overlays, save handling, input bridges, and localization.
- `src/world/` owns the Three.js scene, simulation, player controllers, weather, interaction sites, and assets.
- `scripts/` contains browser verification and asset-processing entry points. `asset-pipeline/`, `character-pipeline/`, and `environment-pipeline/` contain source and generation workflows.
- Keep game simulation and render-frame code independent of DOM presentation. Prefer the existing stores, registries, and shared world data over duplicated state.

## Localization

- English is the default when there is no saved preference or local storage is unavailable. Store the user choice under `yunque.language`; do not add language to the game-save schema.
- Put UI translations in `src/ui/i18n.ts`. Use `useTranslation()` in React components and `translate(source, language, values)` in non-React code.
- Add both language behavior and accessible names when adding or changing user-visible copy. Translate dynamic site names, notices, captions, and interpolated values as well as static labels.
- Keep translated text responsive: avoid fixed widths that only fit one language, and preserve keyboard operation and meaningful ARIA labels.

## Implementation Rules

- Follow nearby TypeScript and React patterns. Use explicit types, avoid `any`, and keep public APIs stable unless the task requires a change.
- Keep edits scoped to the owning module. Do not reformat unrelated code or change simulation behavior to solve a presentation-only issue.
- Preserve save compatibility and existing error-handling guarantees. Validate browser storage and external inputs; do not expose raw technical errors to players.
- Avoid per-frame React subscriptions for rapidly changing telemetry. Use the established mutable bridges or narrowly selected store state for high-frequency rendering paths.
- Preserve keyboard and pointer-lock behavior, focus management, and accessible names for interactive controls.
- Do not commit secrets. Tripo credentials must come from the `TRIPO_API_KEY` environment variable.
- Do not edit generated or vendored output under `node_modules/`, `dist/`, or ignored raw-asset directories. Regenerate assets through their documented scripts.

## Performance and Assets

- The established draw-call budget is at most 400 for the verified scene set. Use `vp run verify:perf` when changing scene composition, effects, materials, or asset rendering.
- Preserve the current quality tiers, lazy loading of photo/scroll panels, LOD behavior, and skinned Kun query optimizations unless measured evidence supports changing them.
- Keep asset metadata and scene layout in their existing sources of truth. Do not hand-edit generated metadata when a pipeline script owns it.

## Documentation

- Keep `README.md` and this file in English. Keep instructions accurate when commands, language behavior, assets, save compatibility, or verification workflows change.
- Use `PROGRESS.md`, `findings.md`, and `task_plan.md` for project work history and active multi-step planning; these files may retain their existing language and historical formatting.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project uses Vite+, a unified toolchain built on Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Use the `vp` CLI for project setup and frontend tooling. Run `vp help` to list commands and `vp <command> --help` for command-specific help.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install --frozen-lockfile` after pulling remote changes and before getting started.
- [ ] Run `vp run build` and the narrowest relevant `vp run verify:*` script to validate changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
