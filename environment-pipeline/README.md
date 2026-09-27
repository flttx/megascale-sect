# Blender environment snapshot

`T02R-environment.blend` is a generated inspection scene. It stays local and is
ignored by Git, together with Blender's numbered backups. The game and the Vite
build use the exported GLB assets, so they do not require this scene file.

## Rebuild

Use Blender 5.2.1 LTS. From the repository root in PowerShell:

```powershell
$blenderExe = 'D:\Program Files\Blender Foundation\Blender 5.2\blender.exe'
& $blenderExe --background --factory-startup --python-exit-code 1 --python environment-pipeline/build_scene.py
```

The script reads the committed `runtime-environment.json` snapshot, the three
original building GLBs in `public/assets/models/`, `rock-modules.blend`, and
`review-views.json`. It creates the backup output directory automatically and
does not need an existing browser review report. Its outputs are:

- `environment-pipeline/T02R-environment.blend`: the complete inspection scene.
- `artifacts/t02r/backup/environment-graybox.blend`: the graybox backup.
- `environment-pipeline/blender-report.json`: geometry counts and Blender version.

The snapshot describes the scene at export time. Rebuilding it does not export
the current game or update `runtime-environment.json`.

To regenerate the small rock library and its runtime GLB as well, run this before
the scene command:

```powershell
& $blenderExe --background --factory-startup --python-exit-code 1 --python environment-pipeline/create_rocks.py
```

This updates `rock-modules.blend`, `rock-report.json`, and
`public/assets/environment/t02r/hero-rocks.glb`. These small outputs remain tracked.
`review-views.json` is shared with `scripts/verify-environment.mjs` so Blender and
browser captures use the same six viewpoints.
