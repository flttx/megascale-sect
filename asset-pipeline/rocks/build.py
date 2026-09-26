"""Build one rock asset (and its debris chunks) headlessly in Blender.

  blender -b --factory-startup -P build.py -- <name> [--h-scale 1.0]

SDF -> grid -> surface nets -> Newton projection -> Blender Decimate (LOD0, LOD1)
-> per-vertex COLOR_0 (R cavity/AO, G vegetation, B strata) -> cache/<name>.npz (+ .json meta).
All arrays are stored in glTF space (Y-up, metres).
"""
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
import rocklib as rl  # noqa: E402
import shapes  # noqa: E402
from blendio import from_blender, make_object  # noqa: E402

CACHE = os.path.join(HERE, 'cache')
T0 = time.time()


def log(msg):
    print(f'[{time.time() - T0:7.1f}s] {msg}', flush=True)


# ---------------------------------------------------------------- high-res surface
def high_mesh(spec, h_scale):
    h = spec.h * h_scale
    F, org = rl.eval_grid(spec.full, spec.base, spec.lo, spec.hi, h, spec.band, log=log)
    if (F[0] < 0).any() or (F[-1] < 0).any() or (F[:, -1] < 0).any() or (F[:, :, 0] < 0).any() or (F[:, :, -1] < 0).any():
        log('WARNING: rock touches the grid border (open surface)')
    V, Q = rl.surface_nets(F, org, h)
    del F
    V = rl.project(spec.full, V, iters=2, eps=0.3 * h, max_step=h)
    a, b, c, d = Q[:, 0], Q[:, 1], Q[:, 2], Q[:, 3]
    short = np.linalg.norm(V[a] - V[c], axis=1) < np.linalg.norm(V[b] - V[d], axis=1)
    T = np.concatenate([np.where(short[:, None], np.stack([a, b, c], 1), np.stack([a, b, d], 1)),
                        np.where(short[:, None], np.stack([a, c, d], 1), np.stack([b, c, d], 1))]).astype(np.int32)
    vol = np.einsum('ij,ij->i', V[T[:, 0]], np.cross(V[T[:, 1]], V[T[:, 2]])).sum() / 6
    log(f'high mesh: {len(V)} verts, {len(T)} tris, h={h:.3f} m, volume {vol:.0f} m3')
    if vol < 0:
        T = T[:, ::-1].copy()
    return V.astype(np.float32), T, h


def topology(V, T):
    """(non-manifold edge count, component sizes in triangles, largest first)."""
    E = np.sort(np.concatenate([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]]), 1).astype(np.int64)
    key = E[:, 0] * len(V) + E[:, 1]
    _, cnt = np.unique(key, return_counts=True)
    nonman = int((cnt > 2).sum()) + int((cnt == 1).sum())
    lab = np.arange(len(V))
    for _ in range(4000):
        m = np.minimum(np.minimum(lab[T[:, 0]], lab[T[:, 1]]), lab[T[:, 2]])
        new = lab.copy()
        for k in range(3):
            np.minimum.at(new, T[:, k], m)
        new = new[new]
        if np.array_equal(new, lab):
            break
        lab = new
    comp = lab[T[:, 0]]
    _, sizes = np.unique(comp, return_counts=True)
    return nonman, np.sort(sizes)[::-1], comp


def drop_small(V, T, min_frac=0.03):
    """Keep only substantial connected pieces (no floating crumbs; debris chunks are their own meshes)."""
    nonman, sizes, comp = topology(V, T)
    _, inv, counts = np.unique(comp, return_inverse=True, return_counts=True)
    keep = counts[inv.ravel()] >= max(40, min_frac * len(T))
    log(f'topology: {nonman} non-manifold/boundary edges, {len(sizes)} components '
        f'(largest {sizes[:4].tolist()}), dropping {int((~keep).sum())} tris in small pieces')
    return T[keep]


# ---------------------------------------------------------------- Blender decimation
def read_mesh(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh()
    m.calc_loop_triangles()
    co = np.empty(len(m.vertices) * 3, np.float32)
    m.vertices.foreach_get('co', co)
    tr = np.empty(len(m.loop_triangles) * 3, np.int32)
    m.loop_triangles.foreach_get('vertices', tr)
    ev.to_mesh_clear()
    return from_blender(co.reshape(-1, 3)), tr.reshape(-1, 3)


def decimate(ob, target):
    n = len(ob.data.polygons)
    mod = ob.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.use_collapse_triangulate = True
    ratio = min(1.0, target / n)
    V = T = None
    for _ in range(6):  # decimate overshoots/undershoots; iterate the ratio toward the target
        mod.ratio = ratio
        V, T = read_mesh(ob)
        err = len(T) / target
        if 0.97 < err < 1.03:
            break
        ratio = min(1.0, ratio / err)
    ob.modifiers.remove(mod)
    return V, T


def clean(V, T):
    """Drop degenerate triangles and unreferenced vertices."""
    a, b, c = V[T[:, 0]], V[T[:, 1]], V[T[:, 2]]
    area = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    T = T[(area > 1e-7) & (T[:, 0] != T[:, 1]) & (T[:, 1] != T[:, 2]) & (T[:, 0] != T[:, 2])]
    used = np.unique(T)
    remap = np.full(len(V), -1, np.int32)
    remap[used] = np.arange(len(used), dtype=np.int32)
    return V[used], remap[T]


# ---------------------------------------------------------------- attributes
def attributes(spec, V, ao_dirs=32):
    N = rl.sdf_normals(spec.full, V, eps=0.5 if spec.kind != 'boulder' else 0.05 * spec.r)
    a = spec.ao
    scale = 1.0 if spec.kind != 'boulder' else spec.r / 6.0
    hemi = rl.hemisphere_ao(spec.full, V, N, ndir=ao_dirs, tmax=a['tmax'], steps=a['steps'], soft=3.0)
    deltas = tuple(d * scale for d in (0.6, 1.2, 2.5, 5.0))
    cav = rl.cavity(spec.full, V, N, deltas=deltas)
    R = np.clip(hemi ** 0.85 * (0.3 + 0.7 * cav), 0.0, 1.0)
    C = spec.colors(V, N, R)
    return np.clip(C, 0, 1).astype(np.float32), N


# ---------------------------------------------------------------- meta
def pillar_ledges(spec, V, N):
    """Pine placement: upward, sky-open flats on the high-res surface, clustered to ~8 m."""
    up = N[:, 1] > 0.86
    P = V[up]
    if not len(P):
        return []
    sky = np.ones(len(P), bool)
    for dy in (2.5, 6.0, 14.0, 30.0):
        sky &= spec.full((P + np.array([0, dy, 0], np.float32)).astype(np.float32)) > 0.3
    P = P[sky & (P[:, 1] > 40)]
    cell = 8.0
    key = np.floor(P / np.array([cell, 3.0, cell])).astype(np.int64)
    uniq, inv, cnt = np.unique(key, axis=0, return_inverse=True, return_counts=True)
    inv = inv.ravel()
    cen = np.stack([np.bincount(inv, weights=P[:, k]) / cnt for k in range(3)], 1)
    area = cnt * spec.h ** 2
    keep = area >= 12.0
    cen, area = cen[keep], area[keep]
    order = np.argsort(-area)
    chosen = []
    for i in order:
        if all(np.linalg.norm(cen[i] - cen[j]) > 12.0 for j in chosen):
            chosen.append(i)
    summit = max(c.H for c in spec.cols)
    out = [{'x': round(float(cen[i, 0]), 1), 'y': round(float(cen[i, 1]), 1), 'z': round(float(cen[i, 2]), 1),
            'area_m2': round(float(area[i])), 'kind': 'summit' if cen[i, 1] > summit - 30 else 'ledge'} for i in chosen]
    out.sort(key=lambda d: -d['y'])
    return out


def island_top(spec, V, N):
    th = np.linspace(0, math.tau, 96, endpoint=False).astype(np.float32)
    saved = spec.boulders
    spec.boulders = []
    rs = np.arange(0.0, spec.R * 1.8, 0.25, dtype=np.float32)
    rim = []
    for t in th:
        x = rs * math.cos(t); z = rs * math.sin(t)
        y = spec._top(x, z) - 1.0
        d = spec.full(np.stack([x, y, z], 1).astype(np.float32))
        outside = np.nonzero(d > 0)[0]
        rim.append(float(rs[outside[0]]) if len(outside) else float(rs[-1]))
    spec.boulders = saved
    rim = np.array(rim)
    # height deviation of the walkable surface inside 90% of the rim (boulders excluded)
    g = np.linspace(-1.0, 1.0, 241, dtype=np.float32) * rim.max()
    X, Z = np.meshgrid(g, g)
    ang = np.mod(np.arctan2(Z, X), math.tau)
    rr = np.interp(ang.ravel(), np.append(th, math.tau), np.append(rim, rim[0])).reshape(X.shape)
    inside = np.hypot(X, Z) < 0.9 * rr
    Y = spec._top(X[inside].ravel(), Z[inside].ravel())
    return {'rim_radius_min': round(float(rim.min()), 1), 'rim_radius_mean': round(float(rim.mean()), 1),
            'rim_radius_max': round(float(rim.max()), 1), 'top_y_min': round(float(Y.min()), 2),
            'top_y_max': round(float(Y.max()), 2), 'top_max_abs_dev': round(float(np.abs(Y).max()), 2),
            'boulders': len(spec.boulders), 'spikes': len(spec.spikes)}


# ---------------------------------------------------------------- driver
def build(spec, offset, parent, h_scale):
    t = time.time()
    log(f'=== {spec.name} ({spec.kind}) ===')
    V, T, h = high_mesh(spec, h_scale)
    meta = {'name': spec.name, 'kind': spec.kind, 'parent': parent, 'offset': [round(float(o), 3) for o in offset],
            'grid_h': round(h, 3), 'high_tris': int(len(T))}
    if spec.kind == 'pillar':
        Nh = rl.sdf_normals(spec.full, V, eps=0.5)
        meta['ledges'] = pillar_ledges(spec, V, Nh)
    if spec.kind == 'island' and parent is None:
        meta['top'] = island_top(spec, V, None)
    V, T = clean(V, drop_small(V, T))
    ob = make_object(spec.name, V, T)
    # voxel remesh = guaranteed manifold input for the decimator (surface nets can pinch at saddles)
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'; rm.voxel_size = h * 0.9; rm.adaptivity = 0.0
    V, T = read_mesh(ob)
    V = rl.project(spec.full, V, iters=2, eps=0.3 * h, max_step=0.6 * h)
    # boulders / debris chunks must be one piece; big rocks keep secondary pieces above 3% (fused spurs)
    V, T = clean(V, drop_small(V, T, 0.2 if spec.kind == 'boulder' else 0.03))
    bpy.data.objects.remove(ob)
    ob = make_object(spec.name, V, T)
    out = {'offset': np.array(offset, np.float32)}
    for lod, target in (('lod0', spec.tris[0]), ('lod1', spec.tris[1])):
        Vl, Tl = clean(*decimate(ob, target))
        if spec.kind == 'pillar':
            Vl[:, 1] = np.maximum(Vl[:, 1], 0.0)  # flat base exactly at y=0
        if lod == 'lod0':  # LOD1 is decimated from LOD0, not from the dense surface
            bpy.data.objects.remove(ob)
            ob = make_object(spec.name, Vl, Tl)
        C, N = attributes(spec, Vl)
        assert np.isfinite(C).all(), f'{spec.name} {lod}: non-finite vertex colours'
        out[f'{lod}_v'], out[f'{lod}_t'], out[f'{lod}_c'] = Vl.astype(np.float32), Tl.astype(np.int32), C
        meta[lod] = {'tris': int(len(Tl)), 'verts': int(len(Vl)),
                     'min': [round(float(v), 2) for v in Vl.min(0)], 'max': [round(float(v), 2) for v in Vl.max(0)],
                     'R_mean': round(float(C[:, 0].mean()), 3), 'G_mean': round(float(C[:, 1].mean()), 3),
                     'B_mean': round(float(C[:, 2].mean()), 3)}
        log(f'{lod}: {len(Tl)} tris, bounds {meta[lod]["min"]} .. {meta[lod]["max"]}')
    bpy.data.objects.remove(ob)
    os.makedirs(CACHE, exist_ok=True)
    np.savez_compressed(os.path.join(CACHE, f'{spec.name}.npz'), **out)
    meta['seconds'] = round(time.time() - t, 1)
    with open(os.path.join(CACHE, f'{spec.name}.json'), 'w', encoding='utf8') as f:
        json.dump(meta, f, indent=1)
    log(f'{spec.name} done in {meta["seconds"]} s')


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    h_scale = 1.0
    if '--h-scale' in argv:
        i = argv.index('--h-scale'); h_scale = float(argv[i + 1]); del argv[i:i + 2]
    reg = shapes.registry()
    for name in argv:
        todo = [name] + [k for k, v in reg.items() if v[2] == name]
        for n in todo:
            spec, group, parent, offset = reg[n]
            build(spec, offset, parent, h_scale)


main()
