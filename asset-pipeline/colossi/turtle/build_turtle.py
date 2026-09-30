# 巨鳌 Turtle rig: decoded LOD0 → skeleton (root / neck / head / tail / flippers) → scripted weights (shell, rocks,
# pines and pavilion stay 100 % root, so the walkable deck is rigid) → `swim` loop → deformation checks → GLB (+ .blend).
#
# blender -b --factory-startup -P build_turtle.py -- <decoded.glb> <out_dir>
# (decoded.glb comes from decode.mjs; optimize_turtle.mjs turns the export into the shipped LODs)
#
# Measurements use asset metres A = (x, y up, z forward) as in the game; Blender coords are (x, -z, y), so the
# head points -Y and up is +Z (glTF export with +Y up maps them back unchanged).
import bpy, sys, math, json, os
import numpy as np
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT_DIR = (os.path.abspath(a) for a in argv[:2])
os.makedirs(OUT_DIR, exist_ok=True)

FPS = 20
STROKE = 9.0             # one fore-flipper stroke (s)
CLIP = 2 * STROKE        # the head's slow sway spans the whole clip
REPORT = {}


def log(*a):
    print('[turtle]', *a, flush=True)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def to_blender(a):
    return Vector((float(a[0]), float(-a[2]), float(a[1])))


# ---------------------------------------------------------------- import (geometry untouched: LOD1 and UVs follow)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)
obj = [o for o in scene.objects if o.type == 'MESH'][0]
obj.name = 'Turtle_body'
me = obj.data
me.name = 'Turtle_body'
me.transform(obj.matrix_world)  # node transform (dequantisation) into the vertices: asset metres
obj.matrix_world.identity()
P = np.empty(len(me.vertices) * 3)
me.vertices.foreach_get('co', P)
P = P.reshape(-1, 3)
A = np.stack([P[:, 0], P[:, 2], -P[:, 1]], 1)
x, y, z, ax = A[:, 0], A[:, 1], A[:, 2], np.abs(A[:, 0])
side = np.where(x >= 0, 1.0, -1.0)
REPORT['verts'] = len(A)
REPORT['bounds'] = [A.min(0).round(1).tolist(), A.max(0).round(1).tolist()]
log('verts', len(A), 'bounds', REPORT['bounds'])

# ---------------------------------------------------------------- regions (measured on the LOD0, see findings R11)
# Neck leaves the shell at z ≈ 95 (shell underside ≈ 70 above it); head z 125–180.
shell_over_neck = smoothstep(58, 64, y) * (1 - smoothstep(96, 100, z))
neck_f = smoothstep(90, 104, z) * (1 - smoothstep(32, 42, ax)) * (1 - shell_over_neck)
# Fore flippers stand out ahead of the shell's front corners: root |x| 44–72, z > 60, top ≤ 48 (rim above).
fore_f = smoothstep(44, 76, ax) * smoothstep(60, 86, z) * (1 - smoothstep(47, 53, y))
# Hind flippers behind the shell: root |x| 54–72, z < -76 beside it (the blade runs forward to z -68 beyond
# its width), top ≤ 40 (rim ≥ 48).
hind_f = smoothstep(54, 72, ax) * np.maximum(1 - smoothstep(-76, -64, z), smoothstep(86, 98, ax) * (1 - smoothstep(-62, -54, z))) * (1 - smoothstep(41, 47, y))
# Tail: a short stub behind the rear overhang.
tail_f = (1 - smoothstep(-124, -112, z)) * (1 - smoothstep(40, 48, y)) * (1 - smoothstep(10, 16, ax))
moving = neck_f + fore_f + hind_f + tail_f
REPORT['overlap_max'] = round(float(moving.max()), 3)
scale_down = np.maximum(moving, 1.0)
neck_f, fore_f, hind_f, tail_f = (f / scale_down for f in (neck_f, fore_f, hind_f, tail_f))
root_w = 1 - (neck_f + fore_f + hind_f + tail_f)


def centroid_polyline(mask, sgn, lo, hi, n):
    """Mid-thickness line of a flipper: centroids of |x| bins from the root pivot out to the tip."""
    F = A[mask]
    edges = np.linspace(lo, hi, n + 1)
    pts = []
    for i in range(n):
        b = F[(np.abs(F[:, 0]) >= edges[i]) & (np.abs(F[:, 0]) < edges[i + 1])]
        if len(b) > 3:
            pts.append([sgn * 0.5 * (edges[i] + edges[i + 1]), b[:, 1].mean(), b[:, 2].mean()])
    tip = F[np.argmax(np.abs(F[:, 0]))]
    pts.append([tip[0], pts[-1][1], pts[-1][2]])
    return np.array(pts)


def polyline_param(Q, pts):
    """Arc-length parameter of the nearest point on a polyline for every row of Q."""
    seg = pts[1:] - pts[:-1]
    seglen = np.linalg.norm(seg, axis=1)
    cum = np.concatenate([[0], np.cumsum(seglen)])
    best_d = np.full(len(Q), np.inf)
    best_t = np.zeros(len(Q))
    for i in range(len(seg)):
        d = seg[i]
        u = np.clip(((Q - pts[i]) @ d) / max(d @ d, 1e-12), 0, 1)
        dist = np.linalg.norm(Q - (pts[i] + u[:, None] * d), axis=1)
        better = dist < best_d
        best_d[better] = dist[better]
        best_t[better] = cum[i] + u[better] * seglen[i]
    return best_t, cum


def joints_along(poly, fractions):
    seg = np.linalg.norm(poly[1:] - poly[:-1], axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    return [np.array([np.interp(f * cum[-1], cum, poly[:, k]) for k in range(3)]) for f in fractions]


def kernel_weights(t, intervals, sigma_scale=0.6):
    """Normalised gaussian partition over bone intervals [(a, b), ...] for parameters t."""
    W = np.zeros((len(t), len(intervals)))
    for j, (a, b) in enumerate(intervals):
        W[:, j] = np.exp(-((t - 0.5 * (a + b)) / (sigma_scale * abs(b - a))) ** 2)
    W += 1e-12
    return W / W.sum(1, keepdims=True)


CHAINS = {}  # name → (joint positions in asset metres, region weight, vertex side mask)
for s_name, sgn in (('L', 1.0), ('R', -1.0)):
    # glTF +X is the turtle's left (it faces +Z with +Y up).
    on_side = side == sgn
    fore_poly = centroid_polyline(on_side & (fore_f > 0.5), sgn, 48, 150, 12)
    root = np.array([sgn * 48.0, fore_poly[0][1], fore_poly[0][2]])
    CHAINS[f'fore_{s_name}'] = (joints_along(np.vstack([root, fore_poly]), (0.0, 0.3, 0.62, 1.0)), fore_f, on_side)
    hind_poly = centroid_polyline(on_side & (hind_f > 0.5), sgn, 60, 150, 10)
    root = np.array([sgn * 58.0, hind_poly[0][1], hind_poly[0][2]])
    CHAINS[f'hind_{s_name}'] = (joints_along(np.vstack([root, hind_poly]), (0.0, 0.5, 1.0)), hind_f, on_side)
CHAINS['neck'] = ([np.array(p) for p in ((0, 40, 88), (0, 44, 110), (0, 52, 128), (0, 70, 178))], neck_f, np.ones(len(A), bool))
CHAINS['tail'] = ([np.array(p) for p in ((0, 32, -108), (0, 28, -136))], tail_f, np.ones(len(A), bool))
BONE_NAMES = {'neck': ['neck_01', 'neck_02', 'head'], 'tail': ['tail']}
for c in ('fore_L', 'fore_R'):
    BONE_NAMES[c] = [f'{c}_01', f'{c}_02', f'{c}_03']
for c in ('hind_L', 'hind_R'):
    BONE_NAMES[c] = [f'{c}_01', f'{c}_02']
for c, (js, f, m) in CHAINS.items():
    log(f'chain {c}:', [np.round(j, 1).tolist() for j in js], 'verts > 0.5:', int(((f > 0.5) & m).sum()))
    REPORT.setdefault('chains', {})[c] = [np.round(j, 2).tolist() for j in js]

# ---------------------------------------------------------------- armature
arm_data = bpy.data.armatures.new('Turtle_rig')
arm = bpy.data.objects.new('Turtle', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
for o in scene.objects:
    o.select_set(False)
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
root_b = eb.new('root')
root_b.head = Vector((0, 0, 0))
root_b.tail = Vector((0, 0, 20.0))
root_b.use_deform = True  # carries the shell and everything on it; never keyed away from rest
for c, (js, _, _) in CHAINS.items():
    prev = None
    for i, name in enumerate(BONE_NAMES[c]):
        b = eb.new(name)
        b.head = to_blender(js[i])
        b.tail = to_blender(js[i + 1])
        b.parent = prev or root_b
        b.use_connect = prev is not None
        b.align_roll(Vector((0, 0, 1)))
        prev = b
bpy.ops.object.mode_set(mode='OBJECT')
BONES = [b.name for b in arm_data.bones]
REPORT['bones'] = {b.name: dict(head=[round(v, 2) for v in b.head_local], tail=[round(v, 2) for v in b.tail_local],
                                parent=b.parent.name if b.parent else None) for b in arm_data.bones}
log('bones', len(BONES), BONES)

# ---------------------------------------------------------------- weights (position only → UV-seam twins agree)
weights = {n: np.zeros(len(A)) for n in BONES}
weights['root'] += root_w
for c, (js, f, m) in CHAINS.items():
    names = BONE_NAMES[c]
    poly = np.array(js)
    t, cum = polyline_param(A, poly)
    W = kernel_weights(t, [(cum[i], cum[i + 1]) for i in range(len(names))], 0.55) if len(names) > 1 else np.ones((len(A), 1))
    for j, n in enumerate(names):
        weights[n] += W[:, j] * f * m
Wm = np.stack([weights[n] for n in BONES], 1)
Wm /= Wm.sum(1, keepdims=True)
order = np.argsort(-Wm, axis=1)
keep = np.zeros_like(Wm, dtype=bool)
np.put_along_axis(keep, order[:, :4], True, axis=1)
Wm = np.where(keep & (Wm > 1e-3), Wm, 0)
Wm /= Wm.sum(1, keepdims=True)
root_idx = BONES.index('root')
rigid = Wm[:, root_idx] >= 1.0 - 1e-9
Wm[rigid] = 0
Wm[rigid, root_idx] = 1.0
REPORT['rigid_verts'] = int(rigid.sum())
# Deck: everything above the shell rim within the shell's length (head and neck are allowed to move).
REPORT['shell_top_not_rigid'] = int(((y > 55) & (np.abs(z) < 95) & ~rigid).sum())
REPORT['max_influences'] = int((Wm > 0).sum(1).max())
log('rigid (100 % root) verts', int(rigid.sum()), 'of', len(A), '| shell top (y > 55, |z| < 95) moving:', REPORT['shell_top_not_rigid'])
for j, n in enumerate(BONES):
    idx = np.nonzero(Wm[:, j])[0]
    if not len(idx):
        continue
    vg = obj.vertex_groups.new(name=n)
    for i in idx:
        vg.add([int(i)], float(Wm[i, j]), 'REPLACE')
obj.parent = arm
mod = obj.modifiers.new('Armature', 'ARMATURE')
mod.object = arm

# ---------------------------------------------------------------- swim clip
UP = Vector((0, 0, 1))
rest = {b.name: b.matrix_local.to_3x3() for b in arm_data.bones}


def axes(name):
    """World (rest) axes of a bone: along it, tip-up (horizontal, ⟂ to it) and up."""
    along = (rest[name] @ Vector((0, 1, 0))).normalized()
    flat = Vector((along.x, along.y, 0)).normalized()
    return along, flat.cross(UP).normalized()


def rot(name, *terms):
    """Local rotation from (world axis, angle) terms, applied right to left in the bone's rest frame."""
    inv = rest[name].inverted()
    q = Quaternion()
    for axis, angle in terms:
        q = q @ Quaternion(inv @ axis, angle)
    return q


D = math.radians


def stroke_phase(t, lag=0.0):
    """Warped stroke angle ψ: 0 = top, π = bottom; the downstroke takes ~37 % of the cycle, the recovery the rest."""
    phi = 2 * math.pi * t / STROKE - lag
    return phi + 0.5 * (1 - math.cos(phi))


def swim_pose(t):
    pose = {}
    for c, sgn in (('fore_L', 1.0), ('fore_R', -1.0)):
        # Flying stroke: down and back with the leading edge pitched down, up and forward feathered; each
        # segment lags the one before it so the tip trails and the blade curves instead of hinging.
        for k, (lift0, lift, sweep, feather, lag) in enumerate(((2, 14, 4, 3, 0.0), (0, 6, 2, 7, 0.55), (0, 6, 0, 8, 1.1))):
            name = BONE_NAMES[c][k]
            along, tip_up = axes(name)
            psi = stroke_phase(t, lag)
            pose[name] = rot(name,
                             (UP * -sgn, D(2 * (k == 0) + sweep * math.cos(psi - 0.4))),
                             (tip_up, D(lift0 + lift * math.cos(psi))),
                             (along * sgn, D(feather * math.sin(psi))))
    for c, sgn in (('hind_L', 1.0), ('hind_R', -1.0)):
        # Hind pair: a small out-of-phase paddle and rudder sweep.
        for k, (lift, sweep, lag) in enumerate(((5, 3, 0.0), (4, 2, 0.6))):
            name = BONE_NAMES[c][k]
            along, tip_up = axes(name)
            psi = stroke_phase(t, math.pi + lag)
            pose[name] = rot(name, (UP * -sgn, D(sweep * math.sin(psi))), (tip_up, D(lift * math.cos(psi))))
    # Neck and head: one slow look to either side per clip, a light nod against the stroke's heave.
    sway = 2 * math.pi * t / CLIP
    psi = stroke_phase(t)
    for name, yaw, lag, nod, nod_lag in (('neck_01', 1.8, 0.0, -0.6, 0.3), ('neck_02', 2.6, 0.35, -0.8, 0.6), ('head', 2.4, 0.7, 1.4, 1.0)):
        _, tip_up = axes(name)
        pose[name] = rot(name, (UP, D(yaw * math.sin(sway - lag))), (tip_up, D(nod * math.cos(psi - nod_lag))))
    _, tip_up = axes('tail')
    pose['tail'] = rot('tail', (UP, D(5 * math.sin(2 * math.pi * t / STROKE - 1.0))), (tip_up, D(2 * math.cos(psi))))
    return pose


def make_action(name, T, pose_fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    nframes = int(round(T * FPS))
    data = {}
    for f in range(nframes + 1):
        for n, q in pose_fn(f / FPS).items():
            data.setdefault(n, []).append((f, q))
    for n, keys in data.items():
        path = f'pose.bones["{n}"].rotation_quaternion'
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(arm, path, index=i, group_name=n)
            fc.keyframe_points.add(len(keys))
            fc.keyframe_points.foreach_set('co', np.array([[f, q[i]] for f, q in keys], dtype=np.float64).reshape(-1))
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = nframes
    first, last = pose_fn(0.0), pose_fn(T)
    err = max(first[n].rotation_difference(last[n]).angle for n in first)
    log(f'action {name}: {nframes + 1} keys/bone, {len(data)} bones, loop seam error {err:.2e} rad')
    REPORT.setdefault('clips', {})[name] = dict(duration_s=T, fps=FPS, frames=nframes + 1, bones=len(data), loop_error_rad=err)
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    arm.animation_data.action = None
    return act


for p in arm.pose.bones:
    p.rotation_mode = 'QUATERNION'
act_swim = make_action('swim', CLIP, swim_pose)

# ---------------------------------------------------------------- deformation checks
def eval_positions():
    ev = obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    m = ev.to_mesh()
    Q = np.empty(len(m.vertices) * 3)
    m.vertices.foreach_get('co', Q)
    ev.to_mesh_clear()
    return Q.reshape(-1, 3)


arm.animation_data.action = act_swim
for tr in arm.animation_data.nla_tracks:
    tr.mute = True
E = np.empty(len(me.edges) * 2, dtype=np.int64)
me.edges.foreach_get('vertices', E)
E = E.reshape(-1, 2)
rest_P = P.copy()
rest_len = np.linalg.norm(rest_P[E[:, 0]] - rest_P[E[:, 1]], axis=1)
moving_edge = ~(rigid[E[:, 0]] & rigid[E[:, 1]])
tip_idx = {c: int(np.argmax(np.where(CHAINS[c][2] & (CHAINS[c][1] > 0.5), ax, -1))) for c in ('fore_L', 'fore_R')}
checks = []
nframes = int(round(CLIP * FPS))
for f in np.linspace(0, nframes, 13).astype(int)[:-1]:
    scene.frame_set(int(f))
    Q = eval_positions()
    disp = np.linalg.norm(Q - rest_P, axis=1)
    ratio = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1) / np.maximum(rest_len, 1e-6)
    r = ratio[moving_edge]
    tips = {c: round(float(Q[i][2]), 1) for c, i in tip_idx.items()}
    checks.append(dict(frame=int(f), rigid_max_disp_m=float(disp[rigid].max()), edge_ratio_min=round(float(r.min()), 3),
                       edge_ratio_max=round(float(r.max()), 3), edge_ratio_p999=round(float(np.percentile(np.abs(r - 1), 99.9)), 4),
                       max_disp_m=round(float(disp.max()), 2), fore_tip_height_m=tips))
    log('check', checks[-1])
    worst = np.argsort(-np.abs(np.log(np.maximum(ratio, 1e-6))) * moving_edge)[:6]
    log('  worst edges (asset midpoint, rest m, ratio):', [(np.round(A[E[e]].mean(0), 0).tolist(), round(float(rest_len[e]), 2), round(float(ratio[e]), 2)) for e in worst])
REPORT['deformation_checks'] = checks
assert all(c['rigid_max_disp_m'] < 1e-4 for c in checks), 'root-weighted vertices moved'

# ---------------------------------------------------------------- export
arm.animation_data.action = None
for tr in arm.animation_data.nla_tracks:
    tr.mute = False
scene.frame_set(0)
for o in scene.objects:
    o.select_set(o in (obj, arm))
bpy.context.view_layer.objects.active = arm
rigged = os.path.join(OUT_DIR, 'turtle_rigged.glb')
bpy.ops.export_scene.gltf(
    filepath=rigged, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
    export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
    export_optimize_animation_size=True, export_anim_slide_to_zero=False, export_reset_pose_bones=True,
    export_morph=False, export_cameras=False, export_lights=False, export_extras=False)
log('exported', rigged, os.path.getsize(rigged))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'turtle_rig.blend'), compress=True)
json.dump(REPORT, open(os.path.join(OUT_DIR, 'build_report.json'), 'w'), indent=1)
log('DONE')
