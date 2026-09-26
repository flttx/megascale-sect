# 鲲 Kun build: clean → straighten tail → scale 260 m → COM pivot → rig (spine + fins) → scripted weights
# → swim / breach_glide loops → deformation checks → GLB export (+ .blend).
#
# blender -b --factory-startup -P build_kun.py -- <simplified.glb> <out_dir>
# (previews of the final optimised files are rendered by render_kun.py)
#
# Blender coords used throughout: head points -Y, up +Z, whale's left side +X.
# (glTF export with +Y up maps this to head +Z, up +Y.)
import bpy, bmesh, sys, math, json, os
import numpy as np
from mathutils import Vector, Quaternion, Euler, kdtree

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT_DIR = (os.path.abspath(a) for a in argv[:2])
os.makedirs(OUT_DIR, exist_ok=True)

LENGTH = 260.0           # target body length (m), head tip → fluke tip along the body axis
FPS = 30
DEBRIS_GAP = 0.006       # (raw units, body length ≈ 1) parts farther than this from the main body are debris
PAVILION_S = (0.285, 0.50)  # s-range where the pavilion/trees bias the core centre line (interpolated over)
FIN_S = (0.29, 0.585)    # s-range of pectoral fins (lateral extension), from analyze.py
REPORT = {}


def log(*a):
    print('[kun]', *a, flush=True)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------- import + clean
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = FPS
bpy.ops.import_scene.gltf(filepath=SRC)
obj = [o for o in scene.objects if o.type == 'MESH'][0]
obj.name = 'Kun_body'
obj.data.name = 'Kun_body'
# bake any import transform into the mesh
mw = obj.matrix_world.copy()
obj.data.transform(mw)
obj.matrix_world.identity()
me = obj.data
tris_in = sum(len(p.vertices) - 2 for p in me.polygons)

bm = bmesh.new()
bm.from_mesh(me)
nv0 = len(bm.verts)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)  # merge UV-seam splits (UVs live on loops, so they survive)
bm.verts.ensure_lookup_table()
log('merged seam vertices', nv0, '->', len(bm.verts))

# connected components
comp = [-1] * len(bm.verts)
comps = []
for v in bm.verts:
    if comp[v.index] >= 0:
        continue
    cid = len(comps)
    stack = [v]
    comp[v.index] = cid
    members = []
    while stack:
        a = stack.pop()
        members.append(a.index)
        for e in a.link_edges:
            b = e.other_vert(a)
            if comp[b.index] < 0:
                comp[b.index] = cid
                stack.append(b)
    comps.append(members)
main = max(range(len(comps)), key=lambda i: len(comps[i]))
# proximity union: a part is attached if it touches (within DEBRIS_GAP) an attached part
kd = kdtree.KDTree(len(bm.verts))
for v in bm.verts:
    kd.insert(v.co, v.index)
kd.balance()
parent = list(range(len(comps)))


def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i


for v in bm.verts:
    ci = comp[v.index]
    for (_, j, _) in kd.find_range(v.co, DEBRIS_GAP):
        cj = comp[j]
        if cj != ci:
            ri, rj = find(ci), find(cj)
            if ri != rj:
                parent[ri] = rj
root_main = find(main)
debris = [i for i in range(len(comps)) if find(i) != root_main]
debris_verts = [bm.verts[i] for c in debris for i in comps[c]]
REPORT['components'] = len(comps)
REPORT['debris_parts'] = len(debris)
REPORT['debris_verts'] = len(debris_verts)
log('components', len(comps), 'main verts', len(comps[main]), 'debris parts', len(debris), 'verts', len(debris_verts),
    [len(comps[c]) for c in debris][:20])
if debris_verts:
    bmesh.ops.delete(bm, geom=debris_verts, context='VERTS')
# degenerate / loose geometry
bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
loose = [v for v in bm.verts if not v.link_faces]
if loose:
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
# normals: make winding consistent + outward per shell; count flips
bm.faces.ensure_lookup_table()
before = [f.normal.copy() for f in bm.faces]
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
flipped = sum(1 for f, n in zip(bm.faces, before) if f.normal.dot(n) < 0)
REPORT['faces_flipped_by_recalc'] = flipped
log('faces flipped by recalc_face_normals', flipped, 'of', len(bm.faces))
# smooth shading with sharp edges only on hard creases (pavilion roofs etc.)
for f in bm.faces:
    f.smooth = True
sharp = 0
for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(75):
        e.smooth = False
        sharp += 1
REPORT['sharp_edges'] = sharp
bm.to_mesh(me)
bm.free()
me.update()
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
if me.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
log('mesh after clean: verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))


def get_P():
    P = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', P)
    return P.reshape(-1, 3)


def set_P(P):
    me.vertices.foreach_set('co', P.reshape(-1).astype(np.float64))
    me.update()


# ---------------------------------------------------------------- centre line + profile
def slice_profile(P, n=64):
    ymin, ymax = P[:, 1].min(), P[:, 1].max()
    Lb = ymax - ymin
    s_mid, zc, halfw, top = [], [], [], []
    for i in range(n):
        y0 = ymin + Lb * i / n
        y1 = ymin + Lb * (i + 1) / n
        S = P[(P[:, 1] >= y0) & (P[:, 1] <= y1)]
        s = (i + 0.5) / n
        if len(S) < 3:
            continue
        core = S[np.abs(S[:, 0]) < 0.05 * Lb]
        if len(core) < 3:
            core = S
        s_mid.append(s)
        zc.append((core[:, 2].min() + core[:, 2].max()) / 2)
        halfw.append(np.abs(S[:, 0]).max())
        top.append(core[:, 2].max())
    s_mid, zc, halfw, top = np.array(s_mid), np.array(zc), np.array(halfw), np.array(top)
    # pavilion / trees raise the core top → interpolate the centre over that stretch
    m = (s_mid > PAVILION_S[0]) & (s_mid < PAVILION_S[1])
    zc[m] = np.interp(s_mid[m], s_mid[~m], zc[~m])
    top[m] = np.interp(s_mid[m], s_mid[~m], top[~m])  # dorsal surface without pavilion/trees
    # fins inflate the lateral extent → interpolate body half-width over the fin range
    f = (s_mid > FIN_S[0]) & (s_mid < FIN_S[1])
    halfw_body = halfw.copy()
    halfw_body[f] = np.interp(s_mid[f], s_mid[~f], halfw[~f])
    # light smoothing
    k = np.array([0.25, 0.5, 0.25])
    zc_s = zc.copy()
    zc_s[1:-1] = np.convolve(zc, k, mode='valid')
    return dict(ymin=ymin, ymax=ymax, L=Lb, s=s_mid, zc=zc_s, halfw=halfw, halfw_body=halfw_body, top=top)


def centre_z(prof, s):
    return np.interp(s, prof['s'], prof['zc'])


def body_halfw(prof, s):
    return np.interp(s, prof['s'], prof['halfw_body'])


# ---------------------------------------------------------------- scripted smooth weights (position-only → seam safe)
def kernel_weights(t, intervals, sigma_scale=0.6, sigma_min=0.0):
    """Normalised gaussian partition over bone intervals [(a,b), ...] for parameters t."""
    W = np.zeros((len(t), len(intervals)))
    for j, (a, b) in enumerate(intervals):
        c = 0.5 * (a + b)
        sg = max(sigma_scale * abs(b - a), sigma_min)
        W[:, j] = np.exp(-((t - c) / sg) ** 2)
        # ends of the chain own everything beyond them
    first_lo = min(intervals[0])
    last_hi = max(intervals[-1])
    W[t <= min(intervals[0][0], intervals[0][1]), :] *= 1.0
    W += 1e-12
    return W / W.sum(1, keepdims=True)


def polyline_param(P, pts):
    """Arc-length parameter of the nearest point on a polyline (pts: K×D) for every row of P (N×D)."""
    seg = pts[1:] - pts[:-1]
    seglen = np.linalg.norm(seg, axis=1)
    cum = np.concatenate([[0], np.cumsum(seglen)])
    best_d = np.full(len(P), np.inf)
    best_t = np.zeros(len(P))
    for i in range(len(seg)):
        d = seg[i]
        u = np.clip(((P - pts[i]) @ d) / max(d @ d, 1e-12), 0, 1)
        q = pts[i] + u[:, None] * d
        dist = np.linalg.norm(P - q, axis=1)
        better = dist < best_d
        best_d[better] = dist[better]
        best_t[better] = cum[i] + u[better] * seglen[i]
    return best_t, cum[-1]


# ---------------------------------------------------------------- straighten the raised tail (numpy LBS)
def straighten(P, prof, s_root):
    """Rotate the tail chain so the centre line behind s_root becomes horizontal (front half kept as-is)."""
    js = np.array([s_root, 0.50, 0.57, 0.64, 0.70, 0.76, 0.82, 0.88, 0.94, 1.0])
    ys = prof['ymin'] + js * prof['L']
    zs = centre_z(prof, js)
    J = np.stack([np.zeros_like(ys), ys, zs], 1)
    # tip-up angle of every segment and cumulative rotation to make it horizontal
    ang = np.arctan2(zs[1:] - zs[:-1], ys[1:] - ys[:-1])
    # new joint positions: horizontal at root height, same segment lengths
    seglen = np.linalg.norm(J[1:] - J[:-1], axis=1)
    Jn = np.zeros_like(J)
    Jn[0] = J[0]
    for i in range(len(seglen)):
        Jn[i + 1] = Jn[i] + np.array([0, seglen[i], 0])
    # body param by nearest point on the (y,z) centre line
    dense_s = np.linspace(0, 1, 400)
    cl = np.stack([prof['ymin'] + dense_s * prof['L'], centre_z(prof, dense_s)], 1)
    t, tot = polyline_param(P[:, 1:3], cl)
    t = t / tot
    # front part (s < s_root) is weighted to a static "front" bone; tail bones blend smoothly
    intervals = [(0.0, s_root)] + [(js[i], js[i + 1]) for i in range(len(js) - 1)]
    W = kernel_weights(t, intervals, 0.6)
    out = np.zeros_like(P)
    # bone 0 = front (identity)
    out += W[:, 0:1] * P
    for i in range(len(seglen)):
        a = -ang[i]  # rotate about +X by -angle (tip down) → horizontal
        c, s_ = math.cos(a), math.sin(a)
        R = np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]])
        out += W[:, i + 1:i + 2] * ((P - J[i]) @ R.T + Jn[i])
    log('straighten: segment angles (deg)', np.round(np.degrees(ang), 1).tolist())
    REPORT['straighten_deg'] = np.round(np.degrees(ang), 2).tolist()
    return out


P = get_P()
prof = slice_profile(P)
log('raw length', round(prof['L'], 4), 'centre z at s=0,0.5,1:', np.round(centre_z(prof, np.array([0.02, 0.5, 0.98])), 4))
P = straighten(P, prof, 0.44)
# the tail got longer (arc length vs projection): rescale to target, then centre on COM
prof = slice_profile(P)
scale = LENGTH / prof['L']
P *= scale
REPORT['scale_from_raw'] = round(scale, 4)
set_P(P)


def com_of_mesh():
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    tri = np.empty(n * 3, dtype=np.int64)
    me.loop_triangles.foreach_get('vertices', tri)
    Pv = get_P()
    T = Pv[tri.reshape(-1, 3)]
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    vol = np.einsum('ij,ij->i', a, np.cross(b, c)) / 6.0
    V = vol.sum()
    com = ((a + b + c) / 4.0 * vol[:, None]).sum(0) / V
    return com, V


com, vol = com_of_mesh()
bb_c = (get_P().min(0) + get_P().max(0)) / 2
log('COM', np.round(com, 3), 'volume m3', round(vol), 'bbox centre', np.round(bb_c, 3))
REPORT['com_before_centering'] = np.round(com, 3).tolist()
REPORT['volume_m3'] = round(float(vol))
P = get_P() - com
set_P(P)

# ---------------------------------------------------------------- final profile, fins
prof = slice_profile(P)
Lb = prof['L']
s_of_y = lambda y: (y - prof['ymin']) / Lb
s_root = float(s_of_y(0.0))
log('final length', round(Lb, 2), 's_root (COM)', round(s_root, 3))
REPORT['s_root'] = round(s_root, 4)

dense_s = np.linspace(0, 1, 400)
centre_line = np.stack([prof['ymin'] + dense_s * Lb, centre_z(prof, dense_s)], 1)
t_body, t_tot = polyline_param(P[:, 1:3], centre_line)
s_body = t_body / t_tot

hw = body_halfw(prof, s_body)
lat = np.abs(P[:, 0])
fin_window = smoothstep(FIN_S[0] - 0.02, FIN_S[0] + 0.03, s_body) * (1 - smoothstep(FIN_S[1] - 0.03, FIN_S[1] + 0.02, s_body))
z_rel = P[:, 2] - centre_z(prof, s_body)
fin_gate = 1 - smoothstep(-4.0, 4.0, z_rel)
fin_f = smoothstep(hw * 0.85, hw * 1.35, lat) * fin_window * fin_gate

fins = {}
for side, sgn in (('L', 1.0), ('R', -1.0)):
    m = (fin_f > 0.5) & (np.sign(P[:, 0]) == sgn)
    Fp = P[m]
    dmax = np.abs(Fp[:, 0]).max()
    edges = np.linspace(np.abs(Fp[:, 0]).min(), dmax, 13)
    pts = []
    for i in range(12):
        b = Fp[(np.abs(Fp[:, 0]) >= edges[i]) & (np.abs(Fp[:, 0]) <= edges[i + 1])]
        if len(b):
            pts.append([sgn * 0.5 * (edges[i] + edges[i + 1]), b[:, 1].mean(), b[:, 2].mean()])
    pts = np.array(pts)
    tip = Fp[np.argmax(np.abs(Fp[:, 0]))]
    pts[-1] = [tip[0], pts[-1][1], pts[-1][2]]
    near = Fp[np.abs(Fp[:, 0]) <= edges[1]]
    w_root = float(np.mean(body_halfw(prof, s_of_y(near[:, 1]))))
    # pivot just inside the body surface so the skin around the fin root bends over a short lever
    root = np.array([sgn * 0.9 * w_root, pts[0][1], pts[0][2]])
    poly = np.vstack([root, pts])
    seg = np.linalg.norm(poly[1:] - poly[:-1], axis=1)
    cum = np.concatenate([[0], np.cumsum(seg)])
    joints = [np.array([np.interp(f * cum[-1], cum, poly[:, k]) for k in range(3)]) for f in (0.0, 0.32, 0.66, 1.0)]
    fins[side] = dict(poly=poly, joints=joints, length=cum[-1], mask=m)
    log(f'fin {side}: root {np.round(root, 1)} tip {np.round(tip, 1)} length {cum[-1]:.1f} m, verts {m.sum()}')
REPORT['fin_length_m'] = round(float(fins['L']['length']), 1)

# ---------------------------------------------------------------- armature
J_FRONT = [s_root, 0.27, 0.14, 0.0]                       # chest → neck → head (pointing forward)
J_TAIL = [s_root, 0.51, 0.575, 0.64, 0.70, 0.755, 0.81, 0.86, 0.905, 1.0]  # spine_03 … spine_11_fluke
FRONT_NAMES = ['spine_02_chest', 'spine_01_neck', 'spine_00_head']
TAIL_NAMES = ['spine_03', 'spine_04', 'spine_05', 'spine_06', 'spine_07', 'spine_08', 'spine_09', 'spine_10', 'spine_11_fluke']
FIN_NAMES = {side: [f'fin_{side}_01', f'fin_{side}_02', f'fin_{side}_03'] for side in 'LR'}


def cl_point(s):
    return Vector((0.0, prof['ymin'] + s * Lb, float(centre_z(prof, s))))


arm_data = bpy.data.armatures.new('Kun_rig')
arm = bpy.data.objects.new('Kun', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
for o in scene.objects:
    o.select_set(False)
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
root_b = eb.new('root')
root_b.head = Vector((0, 0, 0))
root_b.tail = Vector((0, 0, 12.0))  # points up, stays static (path follower attaches here)
root_b.use_deform = False
chain_bones = {}
prev = None
for i, name in enumerate(FRONT_NAMES):
    b = eb.new(name)
    b.head = cl_point(J_FRONT[i]) if i else Vector((0, 0, 0))
    b.tail = cl_point(J_FRONT[i + 1])
    b.parent = prev or root_b
    b.use_connect = prev is not None
    b.align_roll(Vector((0, 0, 1)))
    prev = b
prev = None
for i, name in enumerate(TAIL_NAMES):
    b = eb.new(name)
    b.head = cl_point(J_TAIL[i]) if i else Vector((0, 0, 0))
    b.tail = cl_point(J_TAIL[i + 1])
    b.parent = prev or root_b
    b.use_connect = prev is not None
    b.align_roll(Vector((0, 0, 1)))
    prev = b
for side in 'LR':
    prev = None
    js = fins[side]['joints']
    for i, name in enumerate(FIN_NAMES[side]):
        b = eb.new(name)
        b.head = Vector(js[i])
        b.tail = Vector(js[i + 1])
        b.parent = prev or eb['spine_02_chest']
        b.use_connect = prev is not None
        b.align_roll(Vector((0, 0, 1)))
        prev = b
bpy.ops.object.mode_set(mode='OBJECT')
BONES = [b.name for b in arm_data.bones]
bone_info = {b.name: dict(head=[round(v, 2) for v in b.head_local], tail=[round(v, 2) for v in b.tail_local],
                          parent=b.parent.name if b.parent else None, length=round(b.length, 2)) for b in arm_data.bones}
REPORT['bones'] = bone_info
log('bones', BONES)

# ---------------------------------------------------------------- weights
spine_intervals = [(J_FRONT[i + 1], J_FRONT[i]) for i in range(3)] + [(J_TAIL[i], J_TAIL[i + 1]) for i in range(9)]
spine_names = FRONT_NAMES + TAIL_NAMES
pav_win = smoothstep(PAVILION_S[0] - 0.02, PAVILION_S[0] + 0.02, s_body) * (1 - smoothstep(PAVILION_S[1] - 0.06, PAVILION_S[1] - 0.02, s_body))
top_z = np.interp(s_body, prof['s'], prof['top'])
pav_g = smoothstep(top_z - 6.0, top_z + 2.0, P[:, 2]) * pav_win * (1 - fin_f)
S_PAV = 0.37
s_eff = s_body * (1 - pav_g) + S_PAV * pav_g
REPORT['pavilion_rigid_verts'] = int((pav_g > 0.5).sum())
log('pavilion/tree vertices on the rigid station', int((pav_g > 0.5).sum()))
Wb = kernel_weights(s_eff, spine_intervals, 0.6)
weights = {n: np.zeros(len(P)) for n in BONES}
for j, n in enumerate(spine_names):
    weights[n] += Wb[:, j] * (1 - fin_f)
for side in 'LR':
    sgn = 1.0 if side == 'L' else -1.0
    poly = fins[side]['poly']
    tf, _ = polyline_param(P, poly)
    js = fins[side]['joints']
    seg = [np.linalg.norm(js[i + 1] - js[i]) for i in range(3)]
    cum = np.concatenate([[0], np.cumsum(seg)])
    Wf = kernel_weights(tf, [(cum[i], cum[i + 1]) for i in range(3)], 0.55)
    side_mask = (np.sign(P[:, 0]) == sgn).astype(float)
    for j, n in enumerate(FIN_NAMES[side]):
        weights[n] += Wf[:, j] * fin_f * side_mask
# vertices with fin_f on the wrong side (never, but keep partition of unity)
tot = sum(weights.values())
for n in BONES:
    weights[n] = weights[n] / np.maximum(tot, 1e-9)
# top-4 influences, renormalised
Wm = np.stack([weights[n] for n in BONES], 1)
order = np.argsort(-Wm, axis=1)
keep = np.zeros_like(Wm, dtype=bool)
np.put_along_axis(keep, order[:, :4], True, axis=1)
Wm = np.where(keep & (Wm > 1e-4), Wm, 0)
Wm /= Wm.sum(1, keepdims=True)
REPORT['max_influences'] = int((Wm > 0).sum(1).max())
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
log('weights assigned; bones with weights', [n for j, n in enumerate(BONES) if Wm[:, j].any()])

# ---------------------------------------------------------------- animation
pb = arm.pose.bones
for p in pb:
    p.rotation_mode = 'QUATERNION'
bone_len = {b.name: b.length for b in arm_data.bones}
# arc-length param of every spine joint (m) for the travelling-wave curve
front_s = J_FRONT      # joints from root to head tip
tail_s = J_TAIL


def wave_angles(t, T, cycles, amp_fn, wavelength, arch_fn=None):
    """Tip-up pitch (rad) of every spine bone following h(s,t) = A(s) sin(ωt − 2πs/λ) (+ static arch)."""
    w = 2 * math.pi * cycles / T

    def h(s):
        v = amp_fn(s) * math.sin(w * t - 2 * math.pi * s / wavelength)
        if arch_fn:
            v += arch_fn(s)
        return v

    ang = {}
    for chain, js, names in ((0, front_s, FRONT_NAMES), (1, tail_s, TAIL_NAMES)):
        prev_world = 0.0
        for i, n in enumerate(names):
            s0, s1 = js[i], js[i + 1]
            dy = abs(s1 - s0) * Lb
            world = math.atan2(h(s1) - h(s0), dy)
            ang[n] = world - prev_world
            prev_world = world
    return ang


def smooth01(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


CLIPS = {}


def swim_pose(t):
    T = 12.0
    amp = lambda s: Lb * (0.006 + 0.052 * smooth01(0.30, 1.0, s) ** 1.5)
    rot = {n: (a, 0.0, 0.0) for n, a in wave_angles(t, T, 2, amp, 1.15).items()}
    w = 2 * math.pi * 2 / T
    ph_tail = 2 * math.pi * 1.0 / 1.15
    # flukes lead the tail displacement (angle of attack), largest motion
    x, y, z = rot['spine_11_fluke']
    rot['spine_11_fluke'] = (x - math.radians(11) * math.cos(w * t - ph_tail - 0.35), y, z)
    x, y, z = rot['spine_10']
    rot['spine_10'] = (x - math.radians(4) * math.cos(w * t - ph_tail + 0.2), y, z)
    # subtle head nod slightly ahead of the body wave
    x, y, z = rot['spine_00_head']
    rot['spine_00_head'] = (x + math.radians(1.2) * math.sin(w * t + 0.6), y, z)
    # pectoral fins: slow wing-like sweep, bending wave root → tip, gentle twist and fore-aft
    # (fin_01 carries a +6° lift so the stroke centres nearer horizontal instead of the sculpt's ~16° droop)
    for k, (amp_d, lag, twist_d, lift_d) in enumerate(((9.0, 0.0, 2.5, 6.0), (6.0, 0.55, 2.0, 0.0), (5.0, 1.1, 1.5, 0.0))):
        ph = w * t + 1.2 - lag
        for side in 'LR':
            m = 1 if side == 'L' else -1
            rot[FIN_NAMES[side][k]] = (math.radians(lift_d + amp_d * math.sin(ph)),
                                       m * math.radians(twist_d) * math.sin(ph - 1.2),
                                       m * (math.radians(2.5) * math.cos(ph) if k == 0 else 0.0))
    return rot


def glide_pose(t):
    T = 8.0
    amp = lambda s: Lb * (0.004 + 0.028 * smooth01(0.35, 1.0, s) ** 1.5)

    def arch(s):  # gently arched back: head and tail lowered relative to the middle
        if s < s_root:
            return -Lb * 0.022 * ((s_root - s) / s_root) ** 2
        return -Lb * 0.05 * ((s - s_root) / (1 - s_root)) ** 2

    rot = {n: (a, 0.0, 0.0) for n, a in wave_angles(t, T, 1, amp, 1.3, arch).items()}
    w = 2 * math.pi / T
    ph_tail = 2 * math.pi * 1.0 / 1.3
    x, y, z = rot['spine_11_fluke']
    rot['spine_11_fluke'] = (x - math.radians(6) * math.cos(w * t - ph_tail - 0.35), y, z)
    x, y, z = rot['spine_00_head']
    rot['spine_00_head'] = (x + math.radians(3.0) + math.radians(0.8) * math.sin(w * t), y, z)
    # fins spread wide: raised to ~horizontal, swept forward, tips curled up, slow soaring drift
    for k, (lift, sweep, drift, lag) in enumerate(((12.0, 6.0, 2.5, 0.0), (6.0, 2.0, 2.0, 0.5), (4.0, 0.0, 2.0, 1.0))):
        ph = w * t - lag
        for side in 'LR':
            m = 1 if side == 'L' else -1
            rot[FIN_NAMES[side][k]] = (math.radians(lift + drift * math.sin(ph)),
                                       m * math.radians(1.5) * math.sin(ph - 1.0),
                                       -m * math.radians(sweep))  # L: -Z sweeps forward, R mirrored
    return rot


def make_action(name, T, pose_fn):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    nframes = int(round(T * FPS))
    frames = np.arange(nframes + 1)
    data = {}
    for f in frames:
        rot = pose_fn(f / FPS)
        for n, (rx, ry, rz) in rot.items():
            q = Euler((rx, ry, rz), 'XYZ').to_quaternion()
            data.setdefault(n, []).append((f, q))
    for n, keys in data.items():
        path = f'pose.bones["{n}"].rotation_quaternion'
        for i in range(4):
            fc = act.fcurve_ensure_for_datablock(arm, path, index=i, group_name=n)
            fc.keyframe_points.add(len(keys))
            co = np.array([[f, q[i]] for f, q in keys], dtype=np.float64).reshape(-1)
            fc.keyframe_points.foreach_set('co', co)
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
            fc.update()
    act.use_frame_range = True
    act.frame_start = 0
    act.frame_end = nframes
    # seamless check: first and last frame identical
    first = pose_fn(0.0)
    last = pose_fn(T)
    err = max(abs(a - b) for n in first for a, b in zip(first[n], last[n]))
    log(f'action {name}: {nframes + 1} keys/bone, {len(data)} bones, loop seam error {err:.2e} rad')
    CLIPS[name] = dict(duration_s=T, frames=nframes + 1, bones=len(data), loop_error_rad=err)
    # stash on NLA so the exporter sees every clip
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, act)
    arm.animation_data.action = None
    return act


act_swim = make_action('swim', 12.0, swim_pose)
act_glide = make_action('breach_glide', 8.0, glide_pose)
REPORT['clips'] = CLIPS

# ---------------------------------------------------------------- deformation checks
def eval_positions():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    m = ev.to_mesh()
    Q = np.empty(len(m.vertices) * 3)
    m.vertices.foreach_get('co', Q)
    ev.to_mesh_clear()
    return Q.reshape(-1, 3)


def play(action, frame):
    arm.animation_data.action = action
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
    scene.frame_set(frame)


E = np.empty(len(me.edges) * 2, dtype=np.int64)
me.edges.foreach_get('vertices', E)
E = E.reshape(-1, 2)
rest = get_P()
rest_len = np.linalg.norm(rest[E[:, 0]] - rest[E[:, 1]], axis=1)
checks = []
for act, frames in ((act_swim, (0, 45, 90, 135, 180, 270)), (act_glide, (0, 60, 120, 180))):
    for f in frames:
        play(act, f)
        Q = eval_positions()
        ln = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1)
        ratio = ln / np.maximum(rest_len, 1e-6)
        disp = np.linalg.norm(Q - rest, axis=1)
        tail_tip = Q[np.argmax(rest[:, 1])]
        checks.append(dict(clip=act.name, frame=f, edge_ratio_min=round(float(ratio.min()), 3), edge_ratio_max=round(float(ratio.max()), 3),
                           edge_ratio_p999=round(float(np.percentile(np.abs(ratio - 1), 99.9)), 4), max_disp_m=round(float(disp.max()), 2),
                           fluke_tip_z=round(float(tail_tip[2]), 2)))
        log('check', checks[-1])
REPORT['deformation_checks'] = checks

# ---------------------------------------------------------------- export
arm.animation_data.action = None
for tr in arm.animation_data.nla_tracks:
    tr.mute = False
scene.frame_set(0)
for o in scene.objects:
    o.select_set(o in (obj, arm))
bpy.context.view_layer.objects.active = arm
rigged = os.path.join(OUT_DIR, 'kun_rigged.glb')
bpy.ops.export_scene.gltf(
    filepath=rigged, export_format='GLB', use_selection=True, export_yup=True, export_apply=False,
    export_texcoords=True, export_normals=True, export_tangents=False, export_materials='EXPORT', export_image_format='AUTO',
    export_skins=True, export_influence_nb=4, export_def_bones=False, export_leaf_bone=False, export_rest_position_armature=True,
    export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_step=1,
    export_optimize_animation_size=True, export_anim_slide_to_zero=False, export_reset_pose_bones=True,
    export_morph=False, export_cameras=False, export_lights=False, export_extras=False)
log('exported', rigged, os.path.getsize(rigged))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, 'kun_rig.blend'), compress=True)

json.dump(REPORT, open(os.path.join(OUT_DIR, 'build_report.json'), 'w'), indent=1)
log('DONE')
