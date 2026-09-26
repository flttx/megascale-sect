#!/usr/bin/env bash
# build.sh <asset> <raw.glb> <kind statue|sword> [extra process.py args...]
# raw -> clean (Blender) -> LOD0/LOD1 (gltf-transform) -> previews (EEVEE) -> validation
set -euo pipefail
ROOT=f:/Projects/tripo-building
ROOTM=$(cygpath -m "$ROOT")
B="/d/Program Files/Blender Foundation/Blender 5.2/blender.exe"
L=$ROOT/asset-pipeline/colossi
asset=$1; raw=$2; kind=$3; shift 3
size=150; maxt=60000; lod1=0.2
if [ "$kind" = sword ]; then size=420; maxt=20000; lod1=0.25; fi
OUT=${OUT:-$ROOT/public/assets/colossi}; PREV=${PREV:-$ROOT/artifacts/assets/colossi}; WORK=${WORK:-$L/$asset/work}
mkdir -p "$WORK" "$OUT" "$PREV"
"$B" -b --factory-startup -P "$ROOTM/asset-pipeline/colossi/process.py" -- --in "$(cygpath -m "$raw")" \
  --out "$(cygpath -m "$WORK")/clean.glb" --kind "$kind" --size $size \
  --report "$(cygpath -m "$WORK")/process.json" "$@" 2>&1 | grep -E "PROCESS_REPORT|Error|Traceback" || true
node "$L/optimize.mjs" "$WORK/clean.glb" "$OUT/$asset" --max-tris $maxt --lod1 $lod1 ${OPT_ARGS:-}
"$B" -b --factory-startup -P "$ROOTM/asset-pipeline/colossi/render.py" -- --in "$(cygpath -m "$OUT")/$asset.glb" \
  --out-prefix "$(cygpath -m "$PREV")/$asset" --kind "$kind" --views "${VIEWS:-front,34,back,low,far}" 2>&1 | grep -E "RENDERED|Error|Traceback" || true
node "$L/validate.mjs" "$OUT/$asset.glb" "$OUT/$asset.lod1.glb"
