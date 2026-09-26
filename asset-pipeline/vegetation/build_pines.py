"""Procedural Huangshan pines (黄山松 / 迎客松) for the cloud-sea sect.

  blender -b --factory-startup -P build_pines.py -- [--only pine_1] [--no-render] [--fast]

Builds pine_0 (7 m, cliff-edge gnarled), pine_1 (13 m, welcoming pine, long arm toward +X) and
pine_2 (22 m, tall tiered). Each tree = one mesh with two materials: `bark` (tapered twisted tubes,
root flare) and `needles` (alpha cards clustered into flat, layered cloud pads).

Outputs
  raw/<name>.glb, raw/<name>.lod1.glb       unoptimised exports (optimize.mjs -> public/assets/vegetation)
  pines.blend                               the generated scene
  artifacts/assets/vegetation/*.png         EEVEE previews

Conventions (glTF, after the exporter's Y-up conversion): metres, origin at the trunk base, y = 0 ground.
COLOR_0 (linear floats): R = ambient occlusion (0 inside a pad / near trunk -> 1 outer),
G = height fraction (0 base -> 1 top), B = per-pad random phase (0 on bark), A = 1.
Foliage normals are bent outward from each pad lobe's centre ("fluffy" normals).
"""
import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
TEX = os.path.join(HERE, 'textures')
RAW = os.path.join(HERE, 'raw')
PREVIEW = os.path.join(ROOT, 'artifacts', 'assets', 'vegetation')

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
ONLY = ARGS[ARGS.index('--only') + 1].split(',') if '--only' in ARGS else None
RENDER = '--no-render' not in ARGS
FAST = '--fast' in ARGS

UP = np.array([0.0, 0.0, 1.0])
D2R = math.pi / 180

# Atlas cells in Blender UV space (v up): 0/1 radial sprays, 2 fan (base at v0), 3 dense clump.
CELLS = {0: (0.0, 0.5, 0.5, 1.0), 1: (0.5, 0.5, 1.0, 1.0), 2: (0.0, 0.0, 0.5, 0.5), 3: (0.5, 0.0, 1.0, 0.5)}

# ----------------------------------------------------------------------------------------------
# Tree recipes (Blender Z-up; heading 0 = +X). Branch: u = position along trunk (0..1), az = heading
# (deg), len (m), e0 = initial elevation, droop = mid sag, up = tip upturn, lat = laterals.
# ----------------------------------------------------------------------------------------------
SPECS = {
    'pine_0': dict(  # cliff-edge: shoots out sideways from the rock lip, then turns up; wind-swept flat crown
        seed=7, height=7.0, trunk_len=6.9, r_base=0.24, top_ratio=0.3, taper=1.0,
        flare=1.1, flare_h=0.5, gnarl=11.0, spiral=16,
        tilt=[(0, 62), (0.2, 44), (0.42, 14), (0.65, -10), (0.85, 6), (1.0, 18)], heading=0,
        turn=[(0, 0), (0.5, 30), (1.0, -20)],
        roots=[(175, 1.1, -35), (225, 0.95, -45), (130, 0.9, -30), (30, 0.7, -70), (310, 0.8, -60)],
        stubs=[(0.2, 215, 0.35), (0.34, 95, 0.25)],
        branches=[
            dict(u=0.48, az=210, len=2.4, e0=20, droop=12, up=16, lat=1),
            dict(u=0.60, az=20, len=3.9, e0=8, droop=16, up=14, lat=2),
            dict(u=0.74, az=290, len=2.8, e0=16, droop=10, up=18, lat=2),
            dict(u=0.84, az=125, len=3.1, e0=14, droop=10, up=16, lat=2),
            dict(u=0.94, az=350, len=2.9, e0=16, droop=8, up=12, lat=1),
            dict(u=1.00, az=190, len=2.3, e0=22, droop=4, up=4, lat=1),
            dict(u=1.00, az=70, len=1.9, e0=24, droop=4, up=4, lat=1),
        ],
        top_pad=1.4, pad_r=1.15, card=0.6, lod0_tris=10500, seg=0.34, sub=False,
    ),
    'pine_1': dict(  # 迎客松: trunk leans back, one long arm reaching out toward +X low on the trunk
        seed=13, height=13.0, trunk_len=11.4, r_base=0.4, top_ratio=0.26, taper=1.1,
        flare=0.95, flare_h=0.7, gnarl=8.0, spiral=12,
        tilt=[(0, 12), (0.25, 20), (0.5, 8), (0.75, -4), (1.0, 8)], heading=180,
        turn=[(0, 0), (0.6, -25), (1.0, 20)],
        roots=[(10, 1.0, -22), (80, 0.8, -28), (150, 0.9, -24), (220, 0.85, -30), (290, 0.9, -26)],
        stubs=[(0.18, 250, 0.5), (0.27, 120, 0.4), (0.47, 300, 0.35)],
        branches=[
            dict(u=0.37, az=2, len=8.8, e0=12, droop=12, up=12, lat=4, r=0.6, pad=1.0, arm=True),
            dict(u=0.58, az=235, len=3.6, e0=14, droop=10, up=16, lat=1),
            dict(u=0.69, az=125, len=4.8, e0=10, droop=12, up=14, lat=2),
            dict(u=0.72, az=320, len=5.2, e0=8, droop=12, up=12, lat=2),
            dict(u=0.84, az=205, len=5.4, e0=10, droop=10, up=14, lat=2),
            dict(u=0.86, az=45, len=4.8, e0=10, droop=10, up=14, lat=1),
            dict(u=0.95, az=285, len=4.2, e0=12, droop=8, up=12, lat=1),
            dict(u=1.00, az=10, len=3.8, e0=16, droop=6, up=6, lat=1),
            dict(u=1.00, az=150, len=3.4, e0=18, droop=6, up=6, lat=1),
        ],
        top_pad=2.1, pad_r=1.75, card=0.82, lod0_tris=11500, seg=0.5, sub=False,
    ),
    'pine_2': dict(  # tall veteran: twisted bole bare to mid-height, broad flat umbrella crown in tiers
        seed=22, height=22.0, trunk_len=19.8, r_base=0.62, top_ratio=0.26, taper=1.15,
        flare=0.85, flare_h=0.9, gnarl=9.0, spiral=10,
        tilt=[(0, 6), (0.3, 14), (0.55, 2), (0.8, 10), (1.0, -6)], heading=45,
        turn=[(0, 0), (0.5, 50), (1.0, -30)],
        roots=[(0, 1.0, -22), (70, 0.85, -26), (145, 1.0, -20), (215, 0.8, -28), (290, 0.9, -24)],
        stubs=[(0.22, 100, 0.6), (0.37, 250, 0.5), (0.48, 20, 0.45)],
        branches=[
            dict(u=0.60, az=205, len=5.8, e0=4, droop=8, up=10, lat=2),
            dict(u=0.61, az=25, len=4.8, e0=6, droop=8, up=10, lat=1),
            dict(u=0.75, az=110, len=7.6, e0=3, droop=8, up=10, lat=2),
            dict(u=0.76, az=300, len=7.2, e0=3, droop=8, up=10, lat=2),
            dict(u=0.77, az=205, len=5.6, e0=5, droop=8, up=10, lat=1),
            dict(u=0.89, az=35, len=8.4, e0=3, droop=6, up=8, lat=2),
            dict(u=0.90, az=165, len=7.8, e0=3, droop=6, up=8, lat=2),
            dict(u=0.91, az=260, len=6.8, e0=4, droop=6, up=8, lat=2),
            dict(u=1.00, az=95, len=5.6, e0=6, droop=4, up=4, lat=1),
            dict(u=1.00, az=330, len=5.2, e0=6, droop=4, up=4, lat=1),
            dict(u=1.00, az=210, len=4.4, e0=8, droop=4, up=4, lat=1),
        ],
        top_pad=3.0, pad_r=2.3, card=1.05, lod0_tris=11600, seg=0.85, sub=True,
    ),
}

LOD1_TRIS = 2400


# ----------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------
def norm(v):
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def interp(ctrl, u):
    us = [c[0] for c in ctrl]
    vs = [c[1] for c in ctrl]
    return float(np.interp(u, us, vs))


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Noise1D:
    def __init__(self, rng, amp, freqs=(0.9, 2.1, 4.3)):
        self.terms = [(amp / (1 + i), f * (0.8 + 0.4 * rng.random()), rng.random() * 2 * math.pi) for i, f in enumerate(freqs)]

    def __call__(self, u):
        return sum(a * math.sin(2 * math.pi * f * u + p) for a, f, p in self.terms)


def direction(heading_deg, elev_deg):
    h, e = heading_deg * D2R, elev_deg * D2R
    return np.array([math.cos(e) * math.cos(h), math.cos(e) * math.sin(h), math.sin(e)])


class Polyline:
    """Skeleton curve with radii; parameterised by arc-length fraction."""

    def __init__(self, pts, radii):
        self.pts = np.asarray(pts, float)
        self.radii = np.asarray(radii, float)
        seg = np.linalg.norm(np.diff(self.pts, axis=0), axis=1)
        self.s = np.concatenate([[0], np.cumsum(seg)])
        self.length = self.s[-1]

    def at(self, u):
        s = np.clip(u, 0, 1) * self.length
        i = int(np.clip(np.searchsorted(self.s, s) - 1, 0, len(self.s) - 2))
        f = (s - self.s[i]) / max(self.s[i + 1] - self.s[i], 1e-9)
        p = self.pts[i] * (1 - f) + self.pts[i + 1] * f
        r = self.radii[i] * (1 - f) + self.radii[i + 1] * f
        t = norm(self.pts[i + 1] - self.pts[i])
        return p, r, t

    def resample(self, spacing, dense_until=0.0, dense_spacing=None):
        """Evenly spaced points (optionally denser over the first `dense_until` metres)."""
        s_list = [0.0]
        while s_list[-1] < self.length - 1e-6:
            sp = dense_spacing if (dense_spacing and s_list[-1] < dense_until) else spacing
            s_list.append(min(self.length, s_list[-1] + sp))
        if len(s_list) < 3:
            s_list = [0, self.length * 0.5, self.length]
        if s_list[-1] - s_list[-2] < 0.3 * spacing and len(s_list) > 3:
            del s_list[-2]
        out_p, out_r = [], []
        for s in s_list:
            p, r, _ = self.at(s / max(self.length, 1e-9))
            out_p.append(p)
            out_r.append(r)
        return np.array(out_p), np.array(out_r)


# ----------------------------------------------------------------------------------------------
# skeleton
# ----------------------------------------------------------------------------------------------
class Branch:
    def __init__(self, line, order, kind, heading=0.0):
        self.line = line
        self.order = order        # 0 trunk, 1 main, 2 lateral, 3 sub-lateral
        self.kind = kind          # 'trunk' | 'branch' | 'root' | 'stub'
        self.heading = heading
        self.pad = None


def grow(start, heading, e0, length, r0, r1, droop, upturn, rng, step, wander=3.0, kink_p=0.08):
    n = max(4, int(math.ceil(length / step)))
    ds = length / n
    pts = [np.array(start, float)]
    h = heading
    e_noise = 0.0
    for i in range(n):
        u = (i + 0.5) / n
        h += rng.normal(0, wander)
        if rng.random() < kink_p:          # gnarled elbow: sudden change of heading and pitch
            h += rng.choice([-1, 1]) * rng.uniform(14, 32)
            e_noise += rng.choice([-1, 1]) * rng.uniform(6, 14)
        e_noise = np.clip(e_noise + rng.normal(0, 3.0), -14, 14)
        e = e0 * (1 - u) ** 1.6 - droop * math.sin(math.pi * u) + upturn * u ** 3 + e_noise
        pts.append(pts[-1] + direction(h, e) * ds)
    u = np.linspace(0, 1, len(pts))
    radii = r1 + (r0 - r1) * (1 - u) ** 1.25
    return Polyline(pts, radii), h


def build_skeleton(sp, rng):
    k = sp['height'] / 13.0            # size factor for tips / sub-branch thresholds
    step = 0.22 * max(k, 0.6)
    branches = []

    # trunk ----------------------------------------------------------------------------------
    L = sp['trunk_len']
    n = int(L / step)
    tilt_n, head_n = Noise1D(rng, sp['gnarl']), Noise1D(rng, sp['gnarl'] * 2.2)
    depth = sp['r_base'] * 1.6
    pts = [np.array([0, 0, -depth]), np.zeros(3)]
    p = np.zeros(3)
    for i in range(n):
        u = (i + 0.5) / n
        tilt = interp(sp['tilt'], u) + tilt_n(u)
        head = sp['heading'] + interp(sp['turn'], u) + head_n(u)
        d = np.array([math.sin(tilt * D2R) * math.cos(head * D2R), math.sin(tilt * D2R) * math.sin(head * D2R), math.cos(tilt * D2R)])
        p = p + d * (L / n)
        pts.append(p.copy())
    pts = np.array(pts)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    u = np.clip((s - depth) / (s[-1] - depth), 0, 1)
    top = sp['top_ratio']
    radii = sp['r_base'] * ((1 - u) ** sp['taper'] * (1 - top) + top)
    trunk = Branch(Polyline(pts, radii), 0, 'trunk')
    branches.append(trunk)
    trunk_u = lambda uu: (depth + uu * (trunk.line.length - depth)) / trunk.line.length  # noqa: E731

    # roots ------------------------------------------------------------------------------------
    for az, lf, dip in sp['roots']:
        az = az + rng.normal(0, 8)
        start = np.array([math.cos(az * D2R), math.sin(az * D2R), 0]) * sp['r_base'] * 0.35 + np.array([0, 0, sp['r_base'] * 0.45])
        length = sp['r_base'] * 4.6 * lf
        line, _ = grow(start, az, -16, length, sp['r_base'] * 0.7, sp['r_base'] * 0.17, -dip * 0.9, 0, rng,
                       step=length / 8, wander=6, kink_p=0.15)
        branches.append(Branch(line, 1, 'root', az))

    # dead stubs -------------------------------------------------------------------------------
    for su, az, sl in sp['stubs']:
        p0, r0, _ = trunk.line.at(trunk_u(su))
        line, _ = grow(p0, az, -rng.uniform(12, 35), sl * max(k, 0.6) + r0, r0 * 0.34, r0 * 0.1, 0, 0, rng, step=0.2)
        branches.append(Branch(line, 1, 'stub', az))

    # main branches, laterals, sub-laterals --------------------------------------------------
    tip_r = 0.028 * max(k, 0.55)
    for bi, b in enumerate(sp['branches']):
        p0, r_tr, _ = trunk.line.at(trunk_u(b['u']))
        r0 = r_tr * b.get('r', 0.52)
        az = b['az'] + rng.normal(0, 6)
        line, h_end = grow(p0, az, b['e0'], b['len'], r0, tip_r * 1.2, b['droop'], b['up'], rng, step,
                           wander=2.5 if b.get('arm') else 3.5, kink_p=0.1 if b.get('arm') else 0.16)
        main = Branch(line, 1, 'branch', h_end)
        main.pad = dict(R=sp['pad_r'] * b.get('pad', 1.1) * rng.uniform(0.95, 1.15), heading=h_end)
        branches.append(main)
        nlat = b['lat']
        if nlat:
            us = np.sort(rng.uniform(0.32, 0.86, nlat)) if not b.get('arm') else np.linspace(0.3, 0.86, nlat) + rng.normal(0, 0.03, nlat)
            side = rng.choice([-1, 1])
            for li, lu in enumerate(us):
                q0, qr, qt = line.at(lu)
                ph = math.degrees(math.atan2(qt[1], qt[0]))
                lh = ph + side * rng.uniform(38, 75)
                side = -side
                remain = b['len'] * (1 - lu)
                ll = min(remain * rng.uniform(0.55, 0.85), 3.4 * max(k, 0.6)) + 0.4 * k
                if b.get('arm'):
                    ll = min(ll, 2.4)
                lline, lh_end = grow(q0, lh, rng.uniform(4, 16), ll, qr * 0.7, tip_r, rng.uniform(3, 8), rng.uniform(4, 12), rng, step)
                lat = Branch(lline, 2, 'branch', lh_end)
                lat.pad = dict(R=sp['pad_r'] * rng.uniform(0.72, 1.0), heading=lh_end)
                branches.append(lat)
                if sp['sub'] and ll > 2.0 * max(k, 0.6):
                    for su in rng.uniform(0.35, 0.8, rng.integers(1, 3)):
                        s0, sr, st = lline.at(su)
                        sh = math.degrees(math.atan2(st[1], st[0])) + rng.choice([-1, 1]) * rng.uniform(35, 70)
                        sl = ll * (1 - su) * rng.uniform(0.5, 0.8) + 0.3 * k
                        sline, sh_end = grow(s0, sh, rng.uniform(4, 14), sl, sr * 0.7, tip_r * 0.8, 3, 8, rng, step)
                        sub = Branch(sline, 3, 'branch', sh_end)
                        sub.pad = dict(R=sp['pad_r'] * rng.uniform(0.55, 0.75), heading=sh_end)
                        branches.append(sub)
    # crown pad at the trunk top
    trunk.pad = dict(R=sp['top_pad'], heading=sp['heading'] + 90)
    return branches


# ----------------------------------------------------------------------------------------------
# pads
# ----------------------------------------------------------------------------------------------
def make_pads(branches, rng):
    pads = []
    for br in branches:
        if not br.pad:
            continue
        tip = br.line.pts[-1]
        R = br.pad['R']
        h0 = br.pad['heading']
        lobes = []
        # Main lobe: a flat ellipsoid lying on the branch end, reaching back along the branch.
        a = R * rng.uniform(0.95, 1.1)
        hd = np.array([math.cos(h0 * D2R), math.sin(h0 * D2R), 0.0])
        lobes.append(dict(c=tip - hd * 0.22 * a + np.array([0, 0, 0.08 * R]), a=a, b=a * rng.uniform(0.6, 0.82),
                          h=h0 + rng.normal(0, 12), ht=0.27 * a, hb=0.11 * a))
        for _ in range(int(rng.integers(2, 5))):
            ang = h0 + rng.uniform(-130, 130)
            off = R * rng.uniform(0.5, 0.95)
            aa = R * rng.uniform(0.38, 0.68)
            c = tip + off * np.array([math.cos(ang * D2R), math.sin(ang * D2R), 0]) + np.array([0, 0, R * rng.uniform(-0.08, 0.12)])
            lobes.append(dict(c=c, a=aa, b=aa * rng.uniform(0.65, 0.9), h=ang, ht=0.3 * aa, hb=0.12 * aa))
        for lb in lobes:
            h = lb['h'] * D2R
            lb['ax'] = np.array([math.cos(h), math.sin(h), 0.0])
            lb['ay'] = np.array([-math.sin(h), math.cos(h), 0.0])
        pads.append(dict(lobes=lobes, phase=float(rng.random()), tip=tip, R=R))
    return pads


def lobe_local(lb, p):
    d = p - lb['c']
    return np.stack([d @ lb['ax'], d @ lb['ay'], d[..., 2]], -1)


def lobe_normal(lb, p):
    """Ellipsoid gradient (flat pad: separate top / bottom half-thickness), nudged upward."""
    q = lobe_local(lb, p)
    hz = np.where(q[..., 2] >= 0, lb['ht'], lb['hb'])
    g = np.stack([q[..., 0] / lb['a'] ** 2, q[..., 1] / lb['b'] ** 2, q[..., 2] / hz ** 2], -1)
    g = norm(g)
    world = g[..., :1] * lb['ax'] + g[..., 1:2] * lb['ay'] + g[..., 2:3] * UP
    return norm(world + 0.28 * UP)


def lobe_rho(lb, p):
    q = lobe_local(lb, p)
    hz = np.where(q[..., 2] >= 0, lb['ht'], lb['hb'])
    return np.sqrt((q[..., 0] / lb['a']) ** 2 + (q[..., 1] / lb['b']) ** 2 + (q[..., 2] / hz) ** 2)


# ----------------------------------------------------------------------------------------------
# mesh accumulation
# ----------------------------------------------------------------------------------------------
class MeshBuf:
    def __init__(self):
        self.P, self.N, self.UV, self.C, self.F, self.M = [], [], [], [], [], []
        self.nv = 0
        self.pad_of_vertex = []   # pad index or -1 (bark)
        self.lobe_of_vertex = []

    def add(self, P, N, UV, faces, mat, pad=-1, lobe=None):
        P = np.asarray(P, float)
        self.P.append(P)
        self.N.append(np.asarray(N, float))
        self.UV.append(np.asarray(UV, float))
        self.F.extend([tuple(int(i) + self.nv for i in f) for f in faces])
        self.M.extend([mat] * len(faces))
        self.pad_of_vertex.extend([pad] * len(P))
        self.lobe_of_vertex.extend([lobe] * len(P))
        self.nv += len(P)

    def arrays(self):
        return (np.concatenate(self.P), np.concatenate(self.N), np.concatenate(self.UV))

    def tris(self, mat=None):
        return sum((len(f) - 2) for f, m in zip(self.F, self.M) if mat is None or m == mat)


def tube(buf, pts, radii, sides, lobe_fn=None, spiral=0.0, cap=False, tile=1.4):
    """Parallel-transport tube. `lobe_fn(z, az_world, s)` returns a radius multiplier."""
    pts = np.asarray(pts, float)
    N = len(pts)
    tang = np.zeros_like(pts)
    tang[1:-1] = pts[2:] - pts[:-2]
    tang[0] = pts[1] - pts[0]
    tang[-1] = pts[-1] - pts[-2]
    tang = norm(tang)
    ref = np.array([0, 0, 1.0]) if abs(tang[0][2]) < 0.9 else np.array([1.0, 0, 0])
    nrm = norm(np.cross(tang[0], ref))
    frames = []
    for i in range(N):
        if i > 0:
            nrm = nrm - tang[i] * (nrm @ tang[i])
            nrm = norm(nrm)
        frames.append((nrm.copy(), np.cross(tang[i], nrm)))
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    circ0 = 2 * math.pi * radii[0]
    rep = max(1, int(round(circ0 / tile)))
    tile_v = circ0 / rep
    grid = np.zeros((N, sides, 3))
    for i in range(N):
        n_, b_ = frames[i]
        twist = spiral * D2R * s[i] / max(radii[0], 0.05) * 0.15
        for j in range(sides):
            th = 2 * math.pi * j / sides + twist
            off = math.cos(th) * n_ + math.sin(th) * b_
            r = radii[i]
            if lobe_fn is not None:
                r *= lobe_fn(pts[i][2], math.atan2(off[1], off[0]), s[i])
            grid[i, j] = pts[i] + off * r
    # normals from the grid (central differences, wrap around)
    dA = np.roll(grid, -1, axis=1) - np.roll(grid, 1, axis=1)
    dL = np.zeros_like(grid)
    dL[1:-1] = grid[2:] - grid[:-2]
    dL[0] = grid[1] - grid[0]
    dL[-1] = grid[-1] - grid[-2]
    nn = norm(np.cross(dA, dL))
    outward = grid - pts[:, None, :]
    flip = np.sum(nn * outward, axis=-1) < 0
    nn[flip] *= -1
    P = np.concatenate([grid, grid[:, :1]], axis=1).reshape(-1, 3)
    Nn = np.concatenate([nn, nn[:, :1]], axis=1).reshape(-1, 3)
    UV = []
    for i in range(N):
        twist_u = spiral * D2R * s[i] / max(2 * math.pi * radii[0], 0.1) * rep * 0.6
        v = s[i] / tile_v
        for j in range(sides + 1):
            UV.append((j / sides * rep + twist_u, v))
    W = sides + 1
    faces = []
    for i in range(N - 1):
        for j in range(sides):
            a, b = i * W + j, i * W + j + 1
            faces.append((a, b, b + W, a + W))
    P, Nn, UV = list(P), list(Nn), UV
    if cap:
        c = len(P)
        P.append(pts[-1] + tang[-1] * radii[-1] * 0.3)
        Nn.append(tang[-1])
        UV.append((0.5 * rep, s[-1] / tile_v + 0.2))
        base = (N - 1) * W
        for j in range(sides):
            faces.append((base + j, base + j + 1, c))
    buf.add(P, Nn, UV, faces, 0)


def trunk_lobes(sp, rng):
    roots = [r[0] * D2R for r in sp['roots']]
    burls = [(rng.uniform(0, 2 * math.pi), rng.uniform(0.04, 0.08), rng.integers(2, 5)) for _ in range(3)]
    spiral = sp['spiral'] * D2R

    def fn(z, az, s):
        e = math.exp(-max(z, 0) / sp['flare_h'])
        root = max(max(0.0, math.cos(az - ra)) ** 4 for ra in roots)
        m = 1 + sp['flare'] * e * (0.3 + 0.7 * root)
        tw = s * math.tan(spiral) / max(sp['r_base'], 0.1)
        for ph, amp, k in burls:
            m += amp * math.sin(k * (az + tw) + ph) * (1 - 0.5 * e)
        return m
    return fn


def build_bark(buf, sp, branches, lod, rng):
    k = sp['height'] / 13.0
    seg = sp['seg']
    for br in branches:
        if br.kind == 'trunk':
            sides = (14 if k > 1.4 else 12) if lod == 0 else 6
            pts, radii = br.line.resample(seg * 0.9 if lod == 0 else seg * 2.6,
                                          dense_until=br.line.pts[0][2] * -1 + 2.2 * sp['flare_h'] if lod == 0 else 0,
                                          dense_spacing=seg * 0.4)
            tube(buf, pts, radii, sides, lobe_fn=trunk_lobes(sp, np.random.default_rng(sp['seed'] + 5)), spiral=sp['spiral'])
        elif br.kind == 'root':
            if lod > 0:
                continue
            pts, radii = br.line.resample(br.line.length / 5)
            tube(buf, pts, radii, 6)
        elif br.kind == 'stub':
            if lod > 0:
                continue
            pts, radii = br.line.resample(br.line.length / 2)
            tube(buf, pts, radii, 6, cap=True)
        else:
            if lod == 0:
                sides = {1: 7, 2: 5, 3: 4}[br.order]
                spacing = seg * {1: 1.1, 2: 1.2, 3: 1.2}[br.order]
            else:
                if br.order == 3:
                    continue
                sides = {1: 4, 2: 3}[br.order]
                spacing = seg * {1: 3.2, 2: 4.0}[br.order]
            spacing = min(spacing, br.line.length / 2)
            pts, radii = br.line.resample(spacing)
            tube(buf, pts, radii, sides)


def build_cards(buf, sp, pads, n_cards, card_size, lod, rng):
    lobes = [(pi, li, lb) for pi, pd in enumerate(pads) for li, lb in enumerate(pd['lobes'])]
    area = np.array([lb['a'] * lb['b'] for _, _, lb in lobes])
    counts = np.maximum(3 if lod else 6, np.round(n_cards * area / area.sum())).astype(int)
    # trim to budget (largest lobes give up cards first)
    while counts.sum() > n_cards:
        counts[np.argmax(counts)] -= 1
    for (pi, li, lb), cnt in zip(lobes, counts):
        for _ in range(cnt):
            th = rng.random() * 2 * math.pi
            r = rng.random() ** 0.42
            hmax = math.sqrt(max(0.0, 1 - r * r))
            layer = rng.random()
            under = False
            if layer < 0.52:
                zf = rng.uniform(0.45, 1.0) * hmax
            elif layer < 0.74:
                zf = rng.uniform(-0.45, 0.45) * hmax
            else:                                   # underside skin: seen from the paths below
                zf = rng.uniform(-1.0, -0.55) * hmax
                r = min(r, 0.92)
                under = True
            loc = np.array([r * math.cos(th) * lb['a'], r * math.sin(th) * lb['b']])
            z = zf * (lb['ht'] if zf >= 0 else lb['hb'])
            p = lb['c'] + loc[0] * lb['ax'] + loc[1] * lb['ay'] + z * UP
            out_h = loc[0] * lb['ax'] + loc[1] * lb['ay']
            out_h = out_h / max(np.linalg.norm(out_h), 1e-6) if np.linalg.norm(out_h) > 1e-4 else lb['ax']
            nf_c = lobe_normal(lb, p[None])[0]
            w = min(0.75, 0.08 + 0.72 * r ** 2.5)
            if under:
                w *= 0.45
            pn = UP * math.cos(w * math.pi / 2) + out_h * math.sin(w * math.pi / 2) + rng.normal(0, 0.14, 3)
            pn = pn / np.linalg.norm(pn)
            if pn @ nf_c < 0:
                pn = -pn
            rim = r > 0.7 and not under
            if lod == 0:
                if under:
                    cell = 3 if rng.random() < 0.4 else int(rng.integers(0, 2))
                elif rim and rng.random() < 0.7:
                    cell = 2
                elif lobe_rho(lb, p[None])[0] < 0.55:
                    cell = 3
                else:
                    cell = int(rng.integers(0, 2))
            else:
                cell = 2 if (rim and rng.random() < 0.5) else 3
            if cell == 2:
                g = out_h * 0.75 + UP * (0.65 if zf > -0.3 * hmax else -0.2)
                t2 = g - pn * (g @ pn)
                if np.linalg.norm(t2) < 1e-3:
                    t2 = np.cross(pn, lb['ax'])
            else:
                rnd = rng.normal(0, 1, 3)
                t2 = rnd - pn * (rnd @ pn)
            t2 = t2 / np.linalg.norm(t2)
            t1 = np.cross(t2, pn)
            hs = 0.5 * card_size * rng.uniform(0.8, 1.2)
            c = p + (t2 * hs * 0.8 if cell == 2 else 0)
            P = np.array([c - t1 * hs - t2 * hs, c + t1 * hs - t2 * hs, c + t1 * hs + t2 * hs, c - t1 * hs + t2 * hs])
            u0, v0, u1, v1 = CELLS[cell]
            UV = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
            Nf = lobe_normal(lb, P)
            buf.add(P, Nf, UV, [(0, 1, 2, 3)], 1, pad=pi, lobe=(pi, li))


def vertex_colors(buf, pads, P, trunk_line):
    n = len(P)
    col = np.ones((n, 4))
    zmax = P[:, 2].max()
    col[:, 1] = np.clip(P[:, 2] / zmax, 0, 1)
    pad_idx = np.array(buf.pad_of_vertex)
    # occlusion from pads above (their main lobe)
    centres = np.array([pd['lobes'][0]['c'] for pd in pads])
    radii = np.array([pd['R'] for pd in pads])
    dz = centres[None, :, 2] - P[:, None, 2]
    dh = np.linalg.norm(centres[None, :, :2] - P[:, None, :2], axis=-1)
    above = (dz > 0.25 * radii[None]) & (dh < radii[None] * 1.15)
    occ = 1.0 / (1.0 + 0.45 * above.sum(axis=1))
    # distance to the trunk axis at the same height
    tp = trunk_line.pts
    idx = np.clip(np.searchsorted(tp[:, 2], P[:, 2]), 0, len(tp) - 1)
    dtr = np.linalg.norm(P[:, :2] - tp[idx, :2], axis=1)
    crown = max(np.percentile(dtr, 90), 1.0)
    near_trunk = 0.65 + 0.35 * smoothstep(0.0, 0.3 * crown, dtr)
    ao = np.ones(n)
    bark = pad_idx < 0
    ao[bark] = (0.55 + 0.45 * smoothstep(-0.2, 1.4, P[bark, 2])) * (0.55 + 0.45 * occ[bark])
    leaf = ~bark
    lobe_ids = [buf.lobe_of_vertex[i] for i in np.nonzero(leaf)[0]]
    leaf_idx = np.nonzero(leaf)[0]
    rho = np.zeros(len(leaf_idx))
    vert = np.zeros(len(leaf_idx))
    for k, (vi, (pi, li)) in enumerate(zip(leaf_idx, lobe_ids)):
        lb = pads[pi]['lobes'][li]
        q = lobe_local(lb, P[vi])
        hz = lb['ht'] if q[2] >= 0 else lb['hb']
        rho[k] = math.sqrt((q[0] / lb['a']) ** 2 + (q[1] / lb['b']) ** 2 + (q[2] / hz) ** 2)
        vert[k] = np.clip(q[2] / (lb['ht'] if q[2] >= 0 else lb['hb']), -1, 1)
    ao_local = 0.28 + 0.72 * smoothstep(0.15, 1.0, rho)
    ao_vert = 0.62 + 0.38 * (vert + 1) / 2
    ao[leaf] = ao_local * ao_vert * (0.45 + 0.55 * occ[leaf]) * near_trunk[leaf]
    ao[leaf] /= max(np.percentile(ao[leaf], 98), 1e-3)
    col[:, 0] = np.clip(ao, 0, 1)
    col[:, 2] = 0.0
    col[leaf, 2] = np.array([pads[pi]['phase'] for pi in pad_idx[leaf]])
    return col


# ----------------------------------------------------------------------------------------------
# Blender materials / objects
# ----------------------------------------------------------------------------------------------
def load_image(name, colorspace):
    path = os.path.join(TEX, name)
    img = bpy.data.images.get(name) or bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = colorspace
    return img


def export_material(name):
    """Plain glTF-friendly Principled setups."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
    tex = nt.nodes.new('ShaderNodeTexImage')
    nmap = nt.nodes.new('ShaderNodeNormalMap')
    ntex = nt.nodes.new('ShaderNodeTexImage')
    if name == 'bark':
        tex.image = load_image('bark_basecolor.png', 'sRGB')
        ntex.image = load_image('bark_normal.png', 'Non-Color')
        bsdf.inputs['Roughness'].default_value = 0.92
        nmap.inputs['Strength'].default_value = 1.0
    else:
        tex.image = load_image('needles_basecolor.png', 'sRGB')
        ntex.image = load_image('needles_normal.png', 'Non-Color')
        bsdf.inputs['Roughness'].default_value = 0.78
        nmap.inputs['Strength'].default_value = 0.7
        rnd = nt.nodes.new('ShaderNodeMath')
        rnd.operation = 'ROUND'
        nt.links.new(tex.outputs['Alpha'], rnd.inputs[0])
        nt.links.new(rnd.outputs[0], bsdf.inputs['Alpha'])
        mat.surface_render_method = 'DITHERED'
        mat.use_backface_culling = False
        mat.use_transparent_shadow = True
    bsdf.inputs['Metallic'].default_value = 0.0
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    nt.links.new(ntex.outputs['Color'], nmap.inputs['Color'])
    nt.links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def preview_material(mat):
    """Adds COLOR_0.R ambient occlusion to the base colour for the EEVEE previews only."""
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tex = next(n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image.colorspace_settings.name == 'sRGB')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(attr.outputs['Color'], sep.inputs['Color'])
    mp = nt.nodes.new('ShaderNodeMapRange')
    mp.inputs['To Min'].default_value = 0.3 if mat.name == 'needles' else 0.45
    nt.links.new(sep.outputs['Red'], mp.inputs['Value'])
    mul = nt.nodes.new('ShaderNodeMix')
    mul.data_type = 'RGBA'
    mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mul.inputs['A'])
    nt.links.new(mp.outputs['Result'], mul.inputs['B'])
    nt.links.new(mul.outputs['Result'], bsdf.inputs['Base Color'])


def to_object(name, buf, pads, trunk_line, height, mats):
    P, N, UV = buf.arrays()
    # uniform scale so the highest point sits exactly at the target height
    s = height / P[:, 2].max()
    P = P * s
    col = vertex_colors(buf, pads, P, Polyline(trunk_line.pts * s, trunk_line.radii * s))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(P.tolist(), [], buf.F)
    mesh.update()
    loops_v = np.zeros(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get('vertex_index', loops_v)
    uv = mesh.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', UV[loops_v].astype(np.float32).ravel())
    ca = mesh.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', col.astype(np.float32).ravel())
    mesh.color_attributes.active_color = ca
    mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
    mesh.polygons.foreach_set('material_index', np.array(buf.M, dtype=np.int32))
    mesh.polygons.foreach_set('use_smooth', np.ones(len(mesh.polygons), dtype=bool))
    for m in mats:
        mesh.materials.append(m)
    mesh.normals_split_custom_set_from_vertices(norm(N).tolist())
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj, col


def export_glb(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_normals=True, export_tangents=False, export_texcoords=True,
        export_materials='EXPORT', export_image_format='AUTO', export_yup=True, export_apply=False,
        export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False, export_extras=False)


# ----------------------------------------------------------------------------------------------
# previews
# ----------------------------------------------------------------------------------------------
def setup_render_scene():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.eevee.taa_render_samples = 24 if FAST else 48
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast' if 'AgX - Medium High Contrast' in [
        i.identifier for i in sc.view_settings.bl_rna.properties['look'].enum_items] else 'None'
    world = bpy.data.worlds.new('sky')
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes['Background']
    # sky gradient for camera rays, softer uniform fill for lighting
    coord = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.78, 0.84, 0.90, 1)
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (0.33, 0.50, 0.78, 1)
    nt.links.new(coord.outputs['Generated'], sep.inputs['Vector'])
    nt.links.new(sep.outputs['Z'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.9
    sc.world = world
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 4.2
    sun_data.angle = 2.5 * D2R
    sun_data.color = (1.0, 0.95, 0.86)
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (50 * D2R, 0, 35 * D2R)
    sc.collection.objects.link(sun)
    # rock-coloured ground
    gm = bpy.data.meshes.new('ground')
    S = 60
    gm.from_pydata([(-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', gm)
    gmat = bpy.data.materials.new('ground')
    gmat.use_nodes = True
    gmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.36, 0.36, 0.34, 1)
    gmat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
    gm.materials.append(gmat)
    sc.collection.objects.link(g)
    cam_data = bpy.data.cameras.new('cam')
    cam = bpy.data.objects.new('cam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def world_bounds(objs):
    pts = []
    for o in objs:
        m = o.matrix_world
        arr = np.zeros(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', arr)
        arr = arr.reshape(-1, 3)
        M = np.array(m)
        pts.append(arr @ M[:3, :3].T + M[:3, 3])
    pts = np.concatenate(pts)
    return pts.min(0), pts.max(0)


def look_at(cam, eye, target):
    from mathutils import Vector
    cam.location = Vector(eye)
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def render(path, res):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('rendered', path)


CLOSE_TARGET = {}


def render_tree(cam, obj, name):
    lo, hi = world_bounds([obj])
    lo[2] = min(lo[2], 0)
    ctr = (lo + hi) / 2
    size = hi - lo
    # front (looking +Y) and side (looking -X) orthographic views
    cam.data.type = 'ORTHO'
    cam.data.sensor_fit = 'HORIZONTAL'
    for tag, eye_dir, horiz in (('front', np.array([0, -1, 0]), size[0]), ('side', np.array([1, 0, 0]), size[1])):
        res = (900, int(900 * min(1.6, max(0.7, (size[2] + 0.6) / horiz))))
        aspect = res[0] / res[1]
        cam.data.ortho_scale = max(horiz * 1.08, (size[2] + 0.6) * 1.08 * aspect)
        eye = ctr + eye_dir * (max(size) * 3)
        eye[2] = ctr[2] + max(size) * 3 * math.tan(6 * D2R)
        look_at(cam, eye, ctr)
        render(os.path.join(PREVIEW, f'{name}_{tag}.png'), res)
    # three-quarter perspective from slightly below the crown (visitor's eye line)
    cam.data.type = 'PERSP'
    cam.data.lens = 35
    dist = max(size) * 1.2
    eye = np.array([ctr[0] + dist * 0.62, ctr[1] - dist * 0.78, 1.7])
    look_at(cam, eye, ctr + np.array([0, 0, size[2] * 0.05]))
    render(os.path.join(PREVIEW, f'{name}_persp.png'), (900, 900))
    # close-up from below a pad at walking eye height
    cam.data.lens = 50
    tgt = np.array(CLOSE_TARGET[name]) if name in CLOSE_TARGET else ctr
    eye = tgt + np.array([3.5, -6.0, -tgt[2] + 1.7]) * (1 if tgt[2] < 9 else 1.6)
    eye[2] = 1.7
    look_at(cam, eye, tgt)
    render(os.path.join(PREVIEW, f'{name}_closeup.png'), (1000, 800))


def render_lineup(cam, objs):
    xs = 0.0
    placed = []
    for o in objs:
        lo, hi = world_bounds([o])
        o.location.x += xs - lo[0]
        xs += (hi[0] - lo[0]) + 2.5
        placed.append(o)
    bpy.context.view_layer.update()
    human = bpy.data.meshes.new('human')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.22, radius2=0.22, depth=1.75)
    bmesh.ops.translate(bm, vec=(0, 0, 0.875), verts=bm.verts)
    bm.to_mesh(human)
    hmat = bpy.data.materials.new('human')
    hmat.use_nodes = True
    hmat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.12, 0.08, 1)
    human.materials.append(hmat)
    h = bpy.data.objects.new('human_1.75m', human)
    bpy.context.scene.collection.objects.link(h)
    lo0, hi0 = world_bounds(placed[:1])
    h.location = (hi0[0] + 1.0, -3.0, 0)
    bpy.context.view_layer.update()
    lo, hi = world_bounds(placed)
    ctr = (lo + hi) / 2
    size = hi - lo
    cam.data.type = 'ORTHO'
    cam.data.sensor_fit = 'HORIZONTAL'
    res = (1600, 800)
    cam.data.ortho_scale = max(size[0] * 1.05, (size[2] + 1) * 2.0 * 1.05)
    look_at(cam, np.array([ctr[0], ctr[1] - 200, ctr[2] + 200 * math.tan(5 * D2R)]), np.array([ctr[0], ctr[1], ctr[2]]))
    render(os.path.join(PREVIEW, 'lineup.png'), res)


# ----------------------------------------------------------------------------------------------
def build(name, sp, mats):
    rng = np.random.default_rng(sp['seed'])
    branches = build_skeleton(sp, rng)
    pads = make_pads(branches, np.random.default_rng(sp['seed'] + 1))
    trunk = branches[0]
    out = {}
    for lod in (0, 1):
        buf = MeshBuf()
        build_bark(buf, sp, branches, lod, np.random.default_rng(sp['seed'] + 2))
        bark_tris = buf.tris()
        budget = sp['lod0_tris'] if lod == 0 else LOD1_TRIS
        n_cards = max(60, (budget - bark_tris) // 2)
        size = sp['card'] if lod == 0 else sp['card'] * min(2.3, 0.78 * math.sqrt(((sp['lod0_tris'] - 3000) / 2) / n_cards))
        build_cards(buf, sp, pads, n_cards, size, lod, np.random.default_rng(sp['seed'] + 3 + lod))
        oname = name if lod == 0 else f'{name}.lod1'
        obj, col = to_object(oname, buf, pads, trunk.line, sp['height'], mats)
        s = sp['height'] / np.concatenate(buf.P)[:, 2].max()
        big = max(pads[1:], key=lambda pd: pd['R'] / (1 + 0.15 * pd['tip'][2]))
        CLOSE_TARGET[name] = (big['tip'] * s).tolist()
        print(f'{oname}: bark {bark_tris} tris, needles {buf.tris(1)} tris, total {buf.tris()}, pads {len(pads)}, cards {n_cards}')
        out[lod] = obj
    return out


def main():
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(PREVIEW, exist_ok=True)
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    mats = [export_material('bark'), export_material('needles')]
    built = {}
    for name, sp in SPECS.items():
        if ONLY and name not in ONLY:
            continue
        built[name] = build(name, sp, mats)
        export_glb(built[name][0], os.path.join(RAW, f'{name}.glb'))
        export_glb(built[name][1], os.path.join(RAW, f'{name}.lod1.glb'))
    if not ONLY:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'pines.blend'), relative_remap=True)
    if not RENDER:
        return
    for m in mats:
        preview_material(m)
    cam = setup_render_scene()
    for name, lods in built.items():
        for o in bpy.data.objects:
            if o.name in [x.name for v in built.values() for x in v.values()]:
                o.hide_render = True
        lods[0].hide_render = False
        render_tree(cam, lods[0], name)
        if '--lod1' in ARGS:
            lods[0].hide_render = True
            lods[1].hide_render = False
            render_tree(cam, lods[1], name + '_lod1')
            lods[1].hide_render = True
    if len(built) == len(SPECS):
        for v in built.values():
            v[0].hide_render = False
            v[1].hide_render = True
        render_lineup(cam, [built[n][0] for n in SPECS])


main()
