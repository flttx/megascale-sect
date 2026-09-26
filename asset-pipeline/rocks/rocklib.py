"""Pure-numpy toolkit for the procedural rock pipeline (no bpy import).

Coordinates are glTF Y-up metres throughout. Signed distance functions (SDFs) take a
(N, 3) float32 array and return (N,) float32 values, negative inside rock.
"""
import math
import numpy as np

F32 = np.float32
TAU = math.tau


# ---------------------------------------------------------------- scalar helpers
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def smin(a, b, k):
    """Polynomial smooth minimum (union with a fillet of size ~k)."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def roundrect(qx, qz, hx, hz, r):
    """Exact 2D SDF of a rounded rectangle with half extents (hx, hz) and corner radius r."""
    ax = np.abs(qx) - (hx - r)
    az = np.abs(qz) - (hz - r)
    outside = np.sqrt(np.maximum(ax, 0.0) ** 2 + np.maximum(az, 0.0) ** 2)
    return outside + np.minimum(np.maximum(ax, az), 0.0) - r


def normalize(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-12)


# ---------------------------------------------------------------- noise
class Perlin:
    """Improved Perlin gradient noise, vectorised. Each instance has its own permutation,
    a random rotation (hides lattice alignment) and offset. Output roughly in [-1, 1]."""

    _G = np.array([[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
                   [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1]], F32)

    def __init__(self, seed):
        rng = np.random.default_rng(seed)
        p = rng.permutation(256).astype(np.int32)
        self.P = np.concatenate([p, p]).astype(np.int32)
        self.gx, self.gy, self.gz = (self._G[:, i].copy() for i in range(3))
        q, _ = np.linalg.qr(rng.normal(size=(3, 3)))
        self.R = q.astype(F32)
        self.off = rng.uniform(-200, 200, 3).astype(F32)

    def raw(self, x, y, z):
        R = self.R
        X = R[0, 0] * x + R[0, 1] * y + R[0, 2] * z + self.off[0]
        Y = R[1, 0] * x + R[1, 1] * y + R[1, 2] * z + self.off[1]
        Z = R[2, 0] * x + R[2, 1] * y + R[2, 2] * z + self.off[2]
        xi = np.floor(X); yi = np.floor(Y); zi = np.floor(Z)
        xf = (X - xi).astype(F32); yf = (Y - yi).astype(F32); zf = (Z - zi).astype(F32)
        xi = xi.astype(np.int32) & 255; yi = yi.astype(np.int32) & 255; zi = zi.astype(np.int32) & 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        w = zf * zf * zf * (zf * (zf * 6 - 15) + 10)
        P = self.P
        A = P[xi] + yi; B = P[xi + 1] + yi
        AA = P[A] + zi; AB = P[A + 1] + zi; BA = P[B] + zi; BB = P[B + 1] + zi
        gx, gy, gz = self.gx, self.gy, self.gz

        def g(h, dx, dy, dz):
            k = P[h] & 15
            return gx[k] * dx + gy[k] * dy + gz[k] * dz

        x1 = xf - 1; y1 = yf - 1; z1 = zf - 1
        l1 = g(AA, xf, yf, zf); l2 = g(BA, x1, yf, zf)
        a = l1 + u * (l2 - l1)
        l1 = g(AB, xf, y1, zf); l2 = g(BB, x1, y1, zf)
        b = l1 + u * (l2 - l1)
        c0 = a + v * (b - a)
        l1 = g(AA + 1, xf, yf, z1); l2 = g(BA + 1, x1, yf, z1)
        a = l1 + u * (l2 - l1)
        l1 = g(AB + 1, xf, y1, z1); l2 = g(BB + 1, x1, y1, z1)
        b = l1 + u * (l2 - l1)
        c1 = a + v * (b - a)
        return (c0 + w * (c1 - c0)).astype(F32)

    def fbm(self, x, y, z, octaves=3, gain=0.5, lac=2.03):
        total = np.zeros_like(x, dtype=F32)
        amp, f, norm = 1.0, 1.0, 0.0
        for i in range(octaves):
            total += F32(amp) * self.raw(x * f + i * 19.1, y * f - i * 7.3, z * f + i * 3.7)
            norm += amp
            amp *= gain
            f *= lac
        return total / F32(norm)


# ---------------------------------------------------------------- grids + meshing
def eval_grid(sdf_full, sdf_base, lo, hi, h, band, chunk=1_500_000, log=None):
    """Sample an SDF on a regular grid. `sdf_base` is a cheap bound; `sdf_full` is only evaluated
    where band[0] < base < band[1]. Returns (F, origin)."""
    lo = np.asarray(lo, F32); hi = np.asarray(hi, F32)
    n = np.ceil((hi - lo) / h).astype(int) + 1
    xs = lo[0] + h * np.arange(n[0], dtype=F32)
    ys = lo[1] + h * np.arange(n[1], dtype=F32)
    zs = lo[2] + h * np.arange(n[2], dtype=F32)
    F = np.empty(tuple(n), F32)
    slab = max(1, chunk // (n[1] * n[2]))
    evaluated = 0
    for i0 in range(0, n[0], slab):
        i1 = min(n[0], i0 + slab)
        X, Y, Z = np.meshgrid(xs[i0:i1], ys, zs, indexing='ij')
        P = np.stack([X.ravel(), Y.ravel(), Z.ravel()], 1)
        d = sdf_base(P)
        m = (d > band[0]) & (d < band[1])
        if m.any():
            d[m] = sdf_full(P[m])
            evaluated += int(m.sum())
        F[i0:i1] = d.reshape(i1 - i0, n[1], n[2])
    if log:
        log(f'grid {n.tolist()} = {F.size / 1e6:.1f}M samples, full SDF on {evaluated / 1e6:.2f}M')
    return F, lo


def surface_nets(F, origin, h):
    """Naive surface nets. Returns (verts (V,3) float64, quads (Q,4) int64), quads wound CCW
    seen from outside (F > 0). The grid border must be outside (F > 0) for a closed surface."""
    nx, ny, nz = F.shape
    neg = F < 0
    cnt = np.zeros((nx - 1, ny - 1, nz - 1), np.uint8)
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                cnt += neg[dx:nx - 1 + dx, dy:ny - 1 + dy, dz:nz - 1 + dz]
    active = (cnt > 0) & (cnt < 8)
    del cnt
    nact = int(active.sum())
    cell_id = np.full(active.shape, -1, np.int32)
    cell_id[active] = np.arange(nact, dtype=np.int32)
    acc = np.zeros((nact, 3), np.float64)
    num = np.zeros(nact, np.float64)
    quads = []
    shape_c = (nx - 1, ny - 1, nz - 1)
    for ax in range(3):
        s0 = [slice(None)] * 3; s1 = [slice(None)] * 3
        s0[ax] = slice(0, -1); s1[ax] = slice(1, None)
        a = F[tuple(s0)]; b = F[tuple(s1)]
        cross = (a < 0) != (b < 0)
        ii = np.nonzero(cross)
        fa = a[ii].astype(np.float64); fb = b[ii].astype(np.float64)
        t = fa / (fa - fb)
        E = np.stack(ii, 1).astype(np.int64)
        pt = E.astype(np.float64)
        pt[:, ax] += t
        u = (ax + 1) % 3; v = (ax + 2) % 3
        cells = []
        for du, dv in ((-1, -1), (0, -1), (0, 0), (-1, 0)):
            c = E.copy(); c[:, u] += du; c[:, v] += dv
            valid = (c[:, u] >= 0) & (c[:, u] < shape_c[u]) & (c[:, v] >= 0) & (c[:, v] < shape_c[v])
            cid = np.full(len(E), -1, np.int64)
            cv = c[valid]
            cid[valid] = cell_id[cv[:, 0], cv[:, 1], cv[:, 2]]
            m = cid >= 0
            for k in range(3):
                acc[:, k] += np.bincount(cid[m], weights=pt[m, k], minlength=nact)
            num += np.bincount(cid[m], minlength=nact)
            cells.append(cid)
        cells = np.stack(cells, 1)
        ok = (cells >= 0).all(1)
        q = cells[ok]
        flip = ~(fa[ok] < 0)
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    verts = np.asarray(origin, np.float64) + h * acc / np.maximum(num, 1)[:, None]
    return verts, np.concatenate(quads, 0)


def gradient(sdf, P, eps):
    """Central-difference gradient of an SDF at points P."""
    P = P.astype(F32)
    g = np.empty_like(P)
    for k in range(3):
        o = np.zeros(3, F32); o[k] = eps
        g[:, k] = (sdf(P + o) - sdf(P - o)) / (2 * eps)
    return g


def project(sdf, V, iters=2, eps=0.25, max_step=1.0):
    """Newton-project vertices onto the zero level set (step clamped to max_step)."""
    V = V.astype(F32)
    for _ in range(iters):
        d = sdf(V)
        g = gradient(sdf, V, eps)
        g2 = (g * g).sum(1) + 1e-6
        step = (d / g2)[:, None] * g
        ln = np.linalg.norm(step, axis=1, keepdims=True)
        step *= np.minimum(1.0, max_step / (ln + 1e-9))
        V = V - step
    return V


def sdf_normals(sdf, V, eps=0.6):
    return normalize(gradient(sdf, V, eps))


def hemisphere_ao(sdf, V, N, ndir=24, tmax=40.0, steps=22, soft=3.0, chunk=600_000):
    """Soft sphere-traced hemisphere visibility (cosine weighted). 1 = fully open sky."""
    k = np.arange(ndir) + 0.5
    r = np.sqrt(k / ndir); phi = k * 2.399963
    local = np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - r * r)], 1).astype(F32)
    a = np.where(np.abs(N[:, 1:2]) > 0.9, np.array([[1, 0, 0]], F32), np.array([[0, 1, 0]], F32))
    T = normalize(np.cross(N, a)); B = np.cross(N, T)
    out = np.empty(len(V), F32)
    per = max(1, chunk // ndir)
    for s in range(0, len(V), per):
        e = min(len(V), s + per)
        n = e - s
        D = (local[None, :, 0:1] * T[s:e, None, :] + local[None, :, 1:2] * B[s:e, None, :]
             + local[None, :, 2:3] * N[s:e, None, :]).astype(F32)
        P0 = (V[s:e] + N[s:e] * 0.4).astype(F32)
        t = np.full((n, ndir), 0.6, F32)
        vis = np.ones((n, ndir), F32)
        for _ in range(steps):
            live = t < tmax
            if not live.any():
                break
            P = P0[:, None, :] + D * t[..., None]
            d = sdf(P[live])
            dd = np.full((n, ndir), tmax, F32); dd[live] = d
            vis = np.where(live, np.minimum(vis, np.clip(soft * dd / t, 0, 1)), vis)
            t = t + np.where(live, np.clip(dd * 0.8, 0.35, 10.0), 0)
        out[s:e] = vis.mean(1)
    return out


def cavity(sdf, V, N, deltas=(0.6, 1.2, 2.5, 5.0), weights=(0.2, 0.3, 0.3, 0.2)):
    """Local concavity from the SDF along the normal: 1 = flat/convex, 0 = deep crevice."""
    occ = np.zeros(len(V), F32)
    for dl, w in zip(deltas, weights):
        d = sdf((V + N * dl).astype(F32))
        occ += w * np.clip((dl - d) / dl, 0, 1)
    return np.clip(1 - occ, 0, 1)


def fib_sphere(n):
    k = np.arange(n) + 0.5
    y = 1 - 2 * k / n
    r = np.sqrt(1 - y * y)
    phi = k * 2.399963
    return np.stack([r * np.cos(phi), y, r * np.sin(phi)], 1)
