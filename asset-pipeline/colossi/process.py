"""Clean + orient + scale a Tripo raw GLB for the colossi set (Blender 5.x, headless).

blender -b --factory-startup -P process.py -- --in raw.glb --out clean.glb --kind statue|sword --size 150 [--yaw 0] [--report r.json]

Statue: upright, yaw applied about the vertical axis so the face looks toward glTF +Z, height = size,
        plinth bottom at y=0, origin at the centre of the bottom slice.
Sword:  long axis (PCA) made vertical, tip down, blade width along X (flat faces +-Z), length = size,
        tip at the origin.
"""
import argparse
import json
import math
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="inp", required=True)
ap.add_argument("--out", required=True)
ap.add_argument("--kind", choices=["statue", "sword"], required=True)
ap.add_argument("--size", type=float, required=True)
ap.add_argument("--yaw", type=float, default=None, help="rotation (deg) about vertical after alignment; statue default -90 (Tripo exports facing +X)")
ap.add_argument("--thin", type=float, default=1.0, help="sword: scale blade thickness (below the guard) by this factor")
ap.add_argument("--flip", action="store_true", help="sword: force tip/pommel swap after auto detection")
ap.add_argument("--min-part", type=float, default=0.04, help="drop loose parts whose bbox diagonal < this * model diagonal")
ap.add_argument("--fill-sides", type=int, default=24, help="fill boundary loops with at most this many edges")
ap.add_argument("--report")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.inp, merge_vertices=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
for o in bpy.context.scene.objects:
    o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
for o in list(bpy.context.scene.objects):
    if o is not obj:
        bpy.data.objects.remove(o, do_unlink=True)
me = obj.data
report = {"input": a.inp, "kind": a.kind, "raw_tris": sum(len(p.vertices) - 2 for p in me.polygons)}

# ---------- loose parts ----------
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table()
n = len(bm.verts)
parent = list(range(n))


def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]
        x = parent[x]
    return x


for e in bm.edges:
    ra, rb = find(e.verts[0].index), find(e.verts[1].index)
    if ra != rb:
        parent[ra] = rb
co = np.array([v.co[:] for v in bm.verts])
labels = np.array([find(i) for i in range(n)])
diag = float(np.linalg.norm(co.max(0) - co.min(0)))
parts = []
for lab in np.unique(labels):
    idx = np.nonzero(labels == lab)[0]
    pc = co[idx]
    d = float(np.linalg.norm(pc.max(0) - pc.min(0)))
    parts.append((lab, len(idx), d))
parts.sort(key=lambda t: -t[1])
drop = {lab for lab, cnt, d in parts if d < a.min_part * diag}
report["parts"] = [{"verts": cnt, "diag_rel": round(d / diag, 4), "dropped": lab in drop} for lab, cnt, d in parts[:40]]
report["parts_total"] = len(parts)
report["parts_dropped"] = len(drop)
dead = [bm.verts[i] for i in range(n) if labels[i] in drop]
if dead:
    bmesh.ops.delete(bm, geom=dead, context="VERTS")

# ---------- small holes ----------
boundary = [e for e in bm.edges if e.is_boundary]
report["boundary_edges_before"] = len(boundary)
filled = 0
if boundary:
    res = bmesh.ops.holes_fill(bm, edges=boundary, sides=a.fill_sides)
    new_faces = res.get("faces", [])
    filled = len(new_faces)
    uv = bm.loops.layers.uv.active
    if uv is not None:
        new_set = set(new_faces)
        for f in new_faces:
            for loop in f.loops:
                src = next((l for l in loop.vert.link_loops if l.face not in new_set), None)
                if src is not None:
                    loop[uv].uv = src[uv].uv
    filled_set = set(new_faces)
    if new_faces:
        filled_set |= set(bmesh.ops.triangulate(bm, faces=new_faces).get("faces", []))
else:
    filled_set = set()
report["holes_filled_faces"] = filled
report["boundary_edges_after"] = sum(1 for e in bm.edges if e.is_boundary)

# ---------- normals ----------
bm.faces.ensure_lookup_table()
before = [f.normal.copy() for f in bm.faces]
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
bm.normal_update()
flipped = sum(1 for f, nb in zip(bm.faces, before) if f not in filled_set and f.normal.dot(nb) < 0)
report["faces_flipped_by_recalc"] = flipped
nonmanifold = sum(1 for e in bm.edges if not e.is_manifold)
report["non_manifold_edges"] = nonmanifold
bm.to_mesh(me)
bm.free()
me.update()
report["normals_rebuilt"] = flipped > 0.01 * len(me.polygons)
if report["normals_rebuilt"]:
    # large-scale winding change: Tripo's custom normals no longer match, rebuild smooth normals
    # (a handful of flipped faces just had inverted winding under outward custom normals: keep them)
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception as exc:  # noqa: BLE001
            report["normals_clear_error"] = str(exc)
    me.shade_smooth()

# ---------- orientation ----------
V = np.array([v.co[:] for v in me.vertices])
R = Matrix.Identity(4)
if a.kind == "sword":
    c = V.mean(0)
    w, vecs = np.linalg.eigh(np.cov((V - c).T))
    axis = Vector(vecs[:, np.argmax(w)].tolist())
    R = axis.rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
    V2 = (np.array(R.to_3x3()) @ (V - c).T).T
    z = V2[:, 2]
    L = z.max() - z.min()
    # the crossguard (widest slice) sits much nearer the pommel than the tip
    bins = np.linspace(z.min(), z.max(), 101)
    widths = []
    for i in range(100):
        m = (z >= bins[i]) & (z < bins[i + 1])
        widths.append(np.ptp(V2[m, 0]) + np.ptp(V2[m, 1]) if m.sum() > 3 else 0)
    guard_bin = int(np.argmax(widths))
    pommel_top = guard_bin > 50
    if a.flip:
        pommel_top = not pommel_top
    report["guard_bin_from_min"] = guard_bin
    if not pommel_top:
        R = Matrix.Rotation(math.pi, 4, "X") @ R
        V2 = (np.array(R.to_3x3()) @ (V - c).T).T
    # blade width direction (mid-blade slices) -> X
    z = V2[:, 2]
    zmin = z.min()
    L = z.max() - zmin
    m = (z > zmin + 0.15 * L) & (z < zmin + 0.55 * L)
    xy = V2[m][:, :2]
    w2, v2 = np.linalg.eigh(np.cov((xy - xy.mean(0)).T))
    major = v2[:, np.argmax(w2)]
    ang = math.atan2(major[1], major[0])
    R = Matrix.Rotation(-ang, 4, "Z") @ R
    report["blade_thickness_ratio"] = float(math.sqrt(w2.min() / w2.max()))
yaw = a.yaw if a.yaw is not None else (-90.0 if a.kind == "statue" else 0.0)
report["yaw"] = yaw
if yaw:
    R = Matrix.Rotation(math.radians(yaw), 4, "Z") @ R
me.transform(R)
if a.kind == "sword":
    # PCA is biased by the guard/tassel mass: make the blade spine (slice centres 5..60% up) exactly vertical
    V = np.array([v.co[:] for v in me.vertices])
    z = V[:, 2]
    zmin, L = z.min(), np.ptp(z)
    zs, cx, cy = [], [], []
    for t0 in np.linspace(0.05, 0.6, 23):
        m = (z >= zmin + t0 * L) & (z < zmin + (t0 + 0.02) * L)
        if m.sum() > 3:
            zs.append(z[m].mean())
            cx.append((V[m, 0].min() + V[m, 0].max()) / 2)
            cy.append((V[m, 1].min() + V[m, 1].max()) / 2)
    bx = np.polyfit(zs, cx, 1)[0]
    by = np.polyfit(zs, cy, 1)[0]
    S = Matrix.Rotation(math.atan(by), 4, "X") @ Matrix.Rotation(-math.atan(bx), 4, "Y")
    me.transform(S)
    report["straighten_deg"] = [round(math.degrees(math.atan(bx)), 3), round(math.degrees(math.atan(by)), 3)]
geometry_edited = False
if a.kind == "sword" and a.thin != 1.0:
    # guard = widest slice; flatten everything below it (blade) along thickness (Y), blend over 3% length
    V = np.array([v.co[:] for v in me.vertices])
    z = V[:, 2]
    zmin, L = z.min(), np.ptp(z)
    bins = np.linspace(zmin, z.max(), 201)
    widths = [np.ptp(V[(z >= bins[i]) & (z < bins[i + 1]), 0]) if ((z >= bins[i]) & (z < bins[i + 1])).sum() > 3 else 0 for i in range(200)]
    gi = int(np.argmax(widths))
    guard_lo = bins[gi] - 0.01 * L
    # blade centre line in Y per height (so a curved/offset blade flattens about its own spine)
    t = np.clip((guard_lo - z) / (0.03 * L), 0, 1)
    f = 1 - t * (1 - a.thin)
    yc = np.median(V[(z < guard_lo) & (z > zmin + 0.1 * L), 1])
    for v, fi in zip(me.vertices, f):
        v.co.y = yc + (v.co.y - yc) * fi
    report["thin"] = {"factor": a.thin, "guard_z_rel": round(float((guard_lo - zmin) / L), 3)}
    geometry_edited = True
if geometry_edited:
    with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj]):
        try:
            bpy.ops.mesh.customdata_custom_splitnormals_clear()
        except Exception as exc:  # noqa: BLE001
            report["normals_clear_error"] = str(exc)
    me.shade_smooth()
    try:
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    except Exception as exc:  # noqa: BLE001
        report["smooth_by_angle_error"] = str(exc)

# ---------- scale + pivot ----------
V = np.array([v.co[:] for v in me.vertices])
if a.kind == "statue":
    h = V[:, 2].max() - V[:, 2].min()
else:
    h = V[:, 2].max() - V[:, 2].min()
s = a.size / h
me.transform(Matrix.Scale(s, 4))
V *= s
zmin = V[:, 2].min()
bottom = V[V[:, 2] < zmin + (0.03 if a.kind == "statue" else 0.004) * a.size]
cx, cy = (bottom[:, 0].min() + bottom[:, 0].max()) / 2, (bottom[:, 1].min() + bottom[:, 1].max()) / 2
me.transform(Matrix.Translation((-cx, -cy, -zmin)))
me.update()
V = np.array([v.co[:] for v in me.vertices])
report["bounds_blender_zup"] = {"min": V.min(0).round(3).tolist(), "max": V.max(0).round(3).tolist()}
report["tris"] = sum(len(p.vertices) - 2 for p in me.polygons)
obj.name = me.name = a.out.replace("\\", "/").split("/")[-1].split(".")[0]

bpy.ops.export_scene.gltf(
    filepath=a.out, export_format="GLB", export_yup=True, export_apply=True,
    export_image_format="AUTO", export_texcoords=True, export_normals=True, export_materials="EXPORT",
    export_cameras=False, export_lights=False, export_extras=False,
)
if a.report:
    with open(a.report, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)
print("PROCESS_REPORT", json.dumps({k: v for k, v in report.items() if k != "parts"}))
