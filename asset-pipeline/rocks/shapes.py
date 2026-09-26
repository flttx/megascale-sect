"""Geological SDF models: karst pillars, floating islands (+ debris) and scatter boulders.

All pillars share one regional bedding sequence (same beds at the same height, dipping
~1.7 deg) and one regional joint-set orientation, so towers placed side by side read as
parts of a single eroded plateau rather than unrelated noise blobs.
"""
import math
import numpy as np
from rocklib import F32, Perlin, smoothstep, smin, smax, roundrect, fib_sphere

JOINT_PHI = 0.35                     # regional joint set A (rad); set B is orthogonal
DIP = (0.024, -0.011)                # bedding dip, metres of rise per metre along x / z


# ---------------------------------------------------------------- strata
class Strata:
    """Bedding sequence: boundaries yb (K+1), per-bed recess e (m), undercut asymmetry, band value."""

    def __init__(self, seed, y_min=-20.0, y_max=480.0, scale=1.0):
        rng = np.random.default_rng(seed)
        yb, e, val, gam, kinds = [y_min], [], [], [], []
        y = y_min

        def bed(kind, th, rec, v):
            nonlocal y
            y += th * scale
            yb.append(y); e.append(rec); val.append(v); gam.append(rng.uniform(1.0, 2.2)); kinds.append(kind)

        massive = bool(rng.random() < 0.5)
        while y < y_max:
            if massive:
                # thick cliff-forming package: a few hard beds with thin recessive partings
                for i in range(int(rng.integers(2, 5))):
                    bed('hard', rng.uniform(7, 19), rng.uniform(0.0, 0.25), rng.uniform(0.68, 1.0))
                    bed('parting', rng.uniform(1.6, 3.0), rng.uniform(1.4, 2.6), rng.uniform(0.4, 0.6))
            else:
                # thin-bedded ledgy package: soft notches between thin hard ledges
                for i in range(int(rng.integers(2, 6))):
                    bed('soft', rng.uniform(2.4, 5.5), rng.uniform(2.6, 5.5), rng.uniform(0.0, 0.28))
                    bed('ledge', rng.uniform(3.0, 9.0), rng.uniform(0.0, 0.8), rng.uniform(0.45, 0.8))
            massive = not massive
        self.yb = np.array(yb, F32)
        self.e = np.array(e, F32)
        self.val = np.array(val, F32)
        self.gam = np.array(gam, F32)
        self.kinds = kinds
        ep = np.concatenate([[self.e[0]], self.e, [self.e[-1]]])
        self.blo = np.minimum(ep[:-2], ep[1:-1])
        self.bhi = np.minimum(ep[1:-1], ep[2:])

    def locate(self, yl):
        k = np.clip(np.searchsorted(self.yb, yl, 'right') - 1, 0, len(self.e) - 1)
        lo = self.yb[k]; hi = self.yb[k + 1]
        u = np.clip((yl - lo) / (hi - lo), 0.0, 1.0)
        return k, u, lo, hi

    def recess(self, yl, x=None, z=None, noise=None, scale=22.0):
        """Horizontal set-back of the face: soft beds notch (deepest near their top = undercut
        beneath the hard bed above), hard beds stay proud with sharp ledge edges. With a noise,
        every bed gets its own lateral continuity so notches pinch out around the tower."""
        k, u, lo, hi = self.locate(yl)
        base = self.blo[k] + (self.bhi[k] - self.blo[k]) * u
        prof = np.maximum(np.sin(np.pi * u ** self.gam[k]), 0.0) ** 0.6  # sin(pi) < 0 in float32
        r = base + (self.e[k] - base) * prof
        if noise is not None:
            m = np.clip(0.75 + 1.3 * noise.raw(x / scale, k.astype(F32) * 3.71, z / scale), 0.0, 1.8)
            r = r * m
        return r

    def stair(self, v, flat):
        """Soft staircase snapping heights to bed boundaries (terraced tops)."""
        k, u, lo, hi = self.locate(v)
        return lo + (hi - lo) * smoothstep(flat, 1.0, u)

    def value(self, yl):
        k, u, lo, hi = self.locate(yl)
        return self.val[k]


REGIONAL = Strata(20260926)


def layer_y(x, y, z):
    return y + DIP[0] * x + DIP[1] * z + 0.45 * np.sin(x * 0.027 + z * 0.019)


def tilt_rot(P, tilt):
    """Small rotation about x then z (radians); identity when tilt is zero."""
    ax, az = tilt
    if ax == 0 and az == 0:
        return P
    x, y, z = P[:, 0], P[:, 1], P[:, 2]
    ca, sa = math.cos(ax), math.sin(ax)
    y, z = y * ca - z * sa, y * sa + z * ca
    cb, sb = math.cos(az), math.sin(az)
    x, y = x * cb - y * sb, x * sb + y * cb
    return np.stack([x, y, z], 1).astype(F32)


# ---------------------------------------------------------------- karst pillars
class Column:
    def __init__(self, x=0.0, z=0.0, y0=0.0, H=300.0, a=30.0, b=25.0, rc=10.0, phi=JOINT_PHI, lx=0.0, lz=0.0,
                 taper=0.2, tpow=1.4, bulge=0.0, dome_h=4.0, dome_p=2.5, top_amp=1.6, top_scale=16.0, flat=0.62,
                 edge_k=2.5, setbacks=(), necks=(), wob=2.5, wid=0.05, drops=True):
        self.__dict__.update(locals()); del self.__dict__['self']

    def top_center(self):
        return self.x + self.lx, self.z + self.lz


class Crack:
    """Joint fissure: vertical plane (normal angle ang) at signed offset off from a column axis.
    depth = how far it bites in from the surface; wmin = width fraction kept at full depth."""

    def __init__(self, col, ang, off, w, depth, y0, y1, fade=20.0, meander=1.8, wl=34.0, wmin=0.12):
        self.__dict__.update(locals()); del self.__dict__['self']


class Cut:
    """Rotated box removed from the rock (broken top corners, fallen blocks)."""

    def __init__(self, x, y, z, hx, hy, hz, ang=JOINT_PHI, k=1.2):
        self.__dict__.update(locals()); del self.__dict__['self']


class Pillar:
    kind = 'pillar'

    def __init__(self, name, seed, cols, cracks=(), cuts=(), rec_scale=1.0, lump=(3.0, 1.0), flute=1.1,
                 flute_scale=9.0, fuse_k=4.0, h=1.5, tris=(20000, 2500), strata=REGIONAL, lattice=(7.0, 17.0),
                 drop_p=0.3, drop_max=13.0, joint_cracks=True):
        self.name, self.seed, self.cols, self.cracks, self.cuts = name, seed, list(cols), list(cracks), list(cuts)
        self.rec_scale, self.lump, self.flute, self.fs, self.fuse_k = rec_scale, lump, flute, flute_scale, fuse_k
        self.h, self.tris, self.strata = h, tris, strata
        self.n = [Perlin(seed * 131 + i) for i in range(7)]
        self.H = max(c.H for c in self.cols)
        ys = np.arange(-20, 500, 1.0, dtype=F32)
        self.table_y = ys
        self.col_tables = {}
        for i, c in enumerate(self.cols):
            nw = Perlin(seed * 613 + i)
            z0 = np.zeros_like(ys)
            self.col_tables[id(c)] = (c.wob * nw.fbm(ys / 90, z0 + 0.3, z0, 2), c.wob * nw.fbm(ys / 90, z0 + 5.3, z0, 2),
                                      c.wid * nw.fbm(ys / 55, z0 + 9.1, z0, 2))
        rng = np.random.default_rng(seed * 31 + 7)
        self.lattice = None
        if lattice is not None:
            ext = max(max(abs(c.x) + abs(c.lx), abs(c.z) + abs(c.lz)) + math.hypot(c.a, c.b) for c in self.cols) + 10
            def lines():
                out, p = [], -ext + rng.uniform(0, lattice[1])
                while p < ext:
                    out.append(p); p += rng.uniform(*lattice)
                return np.array(out, F32)
            self.ul, self.vl = lines(), lines()
            drop = np.where(rng.random((len(self.ul) + 1, len(self.vl) + 1)) < drop_p,
                            rng.uniform(0.15, 1.0, (len(self.ul) + 1, len(self.vl) + 1)) ** 1.3 * drop_max, 0.0)
            self.drop_tab = drop.astype(F32)
            self.lattice = lattice
            if joint_cracks:
                top_h = max(c.H for c in self.cols)
                for axis, arr in ((0, self.ul), (1, self.vl)):
                    ang = JOINT_PHI + (0 if axis == 0 else math.pi / 2)
                    for pos in arr:
                        r = rng.random()
                        if r < 0.5:
                            depth, w = rng.uniform(2.0, 5.0), rng.uniform(0.9, 1.6)
                        elif r < 0.9:
                            depth, w = rng.uniform(5, 10), rng.uniform(1.1, 2.0)
                        else:
                            depth, w = rng.uniform(11, 18), rng.uniform(1.3, 2.2)
                        y0 = rng.uniform(0, 0.7) * top_h
                        y1 = top_h + 30 if rng.random() < 0.35 else y0 + rng.uniform(0.25, 0.8) * (top_h - y0)
                        self.cracks.append(Crack(None, ang, float(pos), w, depth, y0, y1, fade=25,
                                                 meander=rng.uniform(0.6, 1.6), wl=rng.uniform(25, 50), wmin=0.2))
        self.meander_y = ys
        self.meander = [c.meander * Perlin(seed * 977 + i).raw(ys / c.wl, np.full_like(ys, 0.37 * i), np.zeros_like(ys))
                        for i, c in enumerate(self.cracks)]
        rmax = max(self.lump) + 4.0
        wobmax = max(c.wob for c in self.cols) * 0.8
        self.band = (-(sum(self.lump) + 5.5 * self.rec_scale * 1.8 + self.flute + wobmax + 7.0), sum(self.lump) + wobmax + 6.0)
        los, his = [], []
        for c in self.cols:
            ext = math.hypot(c.a, c.b) * (1 + max(0.0, c.bulge) + c.wid) + rmax + c.wob + 4
            for (px, pz) in ((c.x, c.z), (c.x + c.lx, c.z + c.lz)):
                los.append((px - ext, pz - ext)); his.append((px + ext, pz + ext))
        lo = np.min(np.array(los), 0); hi = np.max(np.array(his), 0)
        self.lo = (float(lo[0]), -3.0, float(lo[1]))
        self.hi = (float(hi[0]), self.H + 6.0, float(hi[1]))
        self.ao = dict(tmax=45.0, steps=22)

    # --- geometry pieces
    def _col(self, c, x, y, z, yl, topn):
        span = max(c.H - c.y0, 1.0)
        t = np.clip((y - c.y0) / span, 0.0, 1.0)
        lean = t ** 1.5
        wx, wz, ww = (np.interp(y, self.table_y, tb) for tb in self.col_tables[id(c)])
        dx = x - (c.x + c.lx * lean + wx); dz = z - (c.z + c.lz * lean + wz)
        cs, sn = math.cos(c.phi), math.sin(c.phi)
        qx = dx * cs + dz * sn; qz = -dx * sn + dz * cs
        s = 1.0 - c.taper * t ** c.tpow + c.bulge * np.sin(np.pi * t) + ww
        for yb, fr in c.setbacks:
            s = s - fr * smoothstep(yb - 0.7, yb + 0.7, yl)
        for yc, hw, fr in c.necks:
            s = s - fr * np.exp(-((yl - yc) / hw) ** 2)
        s = np.maximum(s, 0.06)
        hx = c.a * s; hz = c.b * s
        r = np.minimum(c.rc * s, np.minimum(hx, hz) * 0.995)
        d2 = roundrect(qx, qz, hx, hz, r)
        rho = np.sqrt((qx / hx) ** 2 + (qz / hz) ** 2)
        top = c.H - c.dome_h * np.minimum(rho, 1.6) ** c.dome_p
        if topn is not None:
            top = top + c.top_amp * topn
            if c.drops and c.a > 10 and self.lattice is not None:
                top = top - self._drop(x, z) * (0.3 + 0.7 * np.minimum(rho, 1.0) ** 2)
        if c.flat is not None:
            off = yl - y
            top = self.strata.stair(top + off, c.flat) - off
        fs = np.clip(np.minimum(hx, hz) / 16.0, 0.35, 1.0)   # thin pinnacles get proportionally less erosion
        return d2, top, fs

    def _union(self, x, y, z, yl, side, topn):
        d = None
        for c in self.cols:
            d2, top, fs = self._col(c, x, y, z, yl, topn)
            if side is not None:
                d2 = d2 + side * fs
            dc = smax(d2, y - top, c.edge_k)
            if c.y0 > 0:
                dc = np.maximum(dc, (c.y0 - 45.0) - y)
            d = dc if d is None else smin(d, dc, self.fuse_k)
        return d

    def _drop(self, x, z):
        cs, sn = math.cos(JOINT_PHI), math.sin(JOINT_PHI)
        u = x * cs + z * sn; v = -x * sn + z * cs
        return self.drop_tab[np.searchsorted(self.ul, u), np.searchsorted(self.vl, v)]

    def _carve(self, x, y, z, d, noisy):
        """Joint fissures (V-shaped, narrowing inward) and broken-off blocks."""
        for i, cr in enumerate(self.cracks):
            if cr.col is None:
                cx = cz = 0.0
            else:
                c = self.cols[cr.col]
                t = np.clip((y - c.y0) / max(c.H - c.y0, 1.0), 0.0, 1.0) ** 1.5
                cx = c.x + c.lx * t; cz = c.z + c.lz * t
            s = (x - cx) * math.cos(cr.ang) + (z - cz) * math.sin(cr.ang) - cr.off - np.interp(y, self.meander_y, self.meander[i])
            ramp = smoothstep(cr.y0, cr.y0 + cr.fade, y) * (1 - smoothstep(cr.y1 - cr.fade, cr.y1, y))
            D = cr.depth * ramp + 1e-3
            w = cr.w * np.clip(1 + d / D, cr.wmin, 1.0) * (0.75 + 0.5 * ramp)
            rc = np.maximum(np.abs(s) - w, -(d + D))
            d = smax(d, -rc, 0.8)
        for ct in self.cuts:
            cs, sn = math.cos(ct.ang), math.sin(ct.ang)
            qx = (x - ct.x) * cs + (z - ct.z) * sn; qz = -(x - ct.x) * sn + (z - ct.z) * cs
            qy = y - ct.y
            bx = np.abs(qx) - ct.hx; by = np.abs(qy) - ct.hy; bz = np.abs(qz) - ct.hz
            box = np.sqrt(np.maximum(bx, 0) ** 2 + np.maximum(by, 0) ** 2 + np.maximum(bz, 0) ** 2)                 + np.minimum(np.maximum(bx, np.maximum(by, bz)), 0)
            if noisy:
                box = box + 0.8 * self.n[5].raw(x / 6, y / 6, z / 6)
            d = smax(d, -box, ct.k)
        return d

    def base(self, P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = self._union(x, y, z, layer_y(x, y, z), None, np.zeros_like(x))
        d = self._carve(x, y, z, d, False)
        return np.maximum(d, -y).astype(F32)

    def full(self, P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        yl = layer_y(x, y, z)
        nl, nm, nr, nf, nt, nx, nc = self.n
        side = self.lump[0] * nl.fbm(x / 44, y / 80, z / 44, 2) + self.lump[1] * nm.fbm(x / 13, y / 22, z / 13, 2)
        side = side + self.strata.recess(yl, x, z, nr) * self.rec_scale
        fl = nf.fbm(x / self.fs, y / (self.fs * 7.5), z / self.fs, 2)
        side = side + self.flute * (1 - smoothstep(0.0, 0.2, np.abs(fl)))
        topn = nt.fbm(x / 16, np.full_like(x, 3.1), z / 16, 2)
        d = self._union(x, y, z, yl, side, topn)
        d = self._carve(x, y, z, d, True)
        return np.maximum(d, -y).astype(F32)

    # --- vertex attributes
    def colors(self, V, N, ao):
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        yl = layer_y(x, y, z)
        band = self.strata.value(yl) + 0.1 * self.n[5].raw(x / 3, y / 1.2, z / 3)
        up = smoothstep(0.5, 0.88, N[:, 1])
        hw = 0.45 + 0.55 * smoothstep(0.15, 0.85, y / self.H)
        expo = smoothstep(0.15, 0.55, ao)  # ledge floors sit in the shade of the step above; still vegetated
        patch = np.clip(0.72 + 0.45 * self.n[6].fbm(x / 7, y / 7, z / 7, 2), 0.35, 1.0)
        veg = np.clip(up * hw * expo * patch, 0, 1)
        return np.stack([ao, veg, np.clip(band, 0, 1)], 1)


# ---------------------------------------------------------------- floating islands
class Mass:
    """Hanging inverted-mountain lobe: top radius R (with harmonic outline), depth D below y=0."""

    def __init__(self, x, z, R, D, p=1.0, uc=0.12, harm=(), twist=0.6):
        self.__dict__.update(locals()); del self.__dict__['self']


class Island:
    kind = 'island'

    def __init__(self, name, seed, R, D, lobes=(), n_spikes=8, n_boulders=16, boulder_size=(1.2, 3.6),
                 lump=(2.4, 0.9), gully=1.4, rec_scale=0.8, top_amp=1.8, rim_k=2.6, samples=2.5e7, tris=(15000, 2000),
                 tilt=(0.0, 0.0), strata_scale=0.7, main=(0.72, 1.7, 2.1), brow=None):
        rng = np.random.default_rng(seed)
        self.name, self.seed, self.R, self.D = name, seed, R, D
        self.lump, self.gully, self.rec_scale, self.top_amp, self.rim_k, self.tris = lump, gully, rec_scale, top_amp, rim_k, tris
        self.n = [Perlin(seed * 173 + i) for i in range(8)]
        self.brow = 0.0
        self.strata = Strata(seed * 7 + 3, y_min=-D - 60, y_max=40, scale=strata_scale)
        harm = [(k, rng.uniform(0.05, 0.13) / k ** 0.55, rng.uniform(0, math.tau)) for k in range(2, 13)]
        # main plate: broad shoulder that falls away quickly (concave, like an upturned mountain)
        self.masses = [Mass(rng.uniform(-0.06, 0.06) * R, rng.uniform(-0.06, 0.06) * R, R, main[0] * D,
                            p=rng.uniform(main[1], main[2]), uc=rng.uniform(0.03, 0.07), harm=harm, twist=rng.uniform(-0.8, 0.8))]
        # hanging sub-peaks: the deepest one carries the full depth D
        for (ox, oz, rf, df) in lobes:
            h2 = [(k, rng.uniform(0.06, 0.16) / k ** 0.5, rng.uniform(0, math.tau)) for k in range(2, 7)]
            self.masses.append(Mass(ox * R, oz * R, rf * R, df * D, p=rng.uniform(1.05, 1.45),
                                    uc=0.0, harm=h2, twist=rng.uniform(-1, 1)))
        # tilt (small rotation, used for debris chunks): radians about x and z
        self.tilt = tilt
        self.band = (-(sum(lump) + gully + 4 * rec_scale + 6.0), sum(lump) + 5.0)
        self.spikes, self.boulders = [], []
        self.brow = min(4.5, 0.07 * R) if brow is None else brow
        self._place_spikes(rng, n_spikes)
        self._place_boulders(rng, n_boulders, boulder_size)
        ext = R * 1.45 + sum(lump) + 4
        tmargin = R * 1.5 * max(abs(tilt[0]), abs(tilt[1]))
        self.lo = (-ext, -D * 1.25 - 4.0 - tmargin, -ext)
        self.hi = (ext, 2.0 + 2.2 * top_amp + tmargin + (boulder_size[1] * 2.2 if n_boulders else 0), ext)
        self._fit_bounds()
        vol = np.prod(np.array(self.hi) - np.array(self.lo))
        self.h = float(np.clip((vol / samples) ** (1 / 3), 0.04, 1.2))
        self.ao = dict(tmax=min(40.0, 0.9 * R + 8), steps=22)

    # --- helpers
    def _rot(self, P):
        ax, az = self.tilt
        if ax == 0 and az == 0:
            return P
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        ca, sa = math.cos(ax), math.sin(ax)
        y, z = y * ca - z * sa, y * sa + z * ca
        cb, sb = math.cos(az), math.sin(az)
        x, y = x * cb - y * sb, x * sb + y * cb
        return np.stack([x, y, z], 1).astype(F32)

    def _mass(self, m, x, y, z, side):
        dx = x - m.x; dz = z - m.z
        dist = np.sqrt(dx * dx + dz * dz) + 1e-6
        th = np.arctan2(dz, dx)
        u = np.clip(-y / m.D, 0.0, 1.2)
        g = 1.0 + 1.6 * u
        rth = 1.0
        for k, a, ph in m.harm:
            rth = rth + a * g * np.cos(k * (th + m.twist * u) + ph)
        Rm = m.R * rth
        base = np.clip((1.0 - u) / (1.0 - m.uc), 0.0, 1.0)
        prof = np.where(u < m.uc, 1.0, base ** m.p)
        dh = dist - prof * Rm
        slope = np.clip(m.R / ((1 - m.uc) * m.D) * m.p * np.maximum(base, 0.05) ** (m.p - 1), 0, 4)
        if side is not None:  # thin hanging tips get proportionally less erosion, so the depth survives
            dh = dh + side * np.clip(prof * Rm / 10.0, 0.3, 1.0)
        dh = dh / np.sqrt(1 + np.where(u < m.uc, 0.0, slope) ** 2)
        return np.maximum(dh, -(y + m.D) * 0.7)

    def _body(self, x, y, z, side):
        d = None
        for i, m in enumerate(self.masses):
            dm = self._mass(m, x, y, z, side)
            d = dm if d is None else smin(d, dm, 5.0 if i else 0)
        return d

    def _top(self, x, z):
        y = self.top_amp * self.n[4].fbm(x / 26, np.full_like(x, 0.7), z / 26, 2)
        if self.brow:  # rounded brow: the walkable top rolls over into the cliff over the outer ~10% of the outline
            f = None       # radial fraction of the union outline at y=0 (main plate and hanging lobes)
            for m in self.masses:
                th = np.arctan2(z - m.z, x - m.x)
                rr = 1.0
                for k, a, ph in m.harm:
                    rr = rr + a * np.cos(k * th + ph)
                fm = np.hypot(x - m.x, z - m.z) / (m.R * rr)
                f = fm if f is None else np.minimum(f, fm)
            y = y - self.brow * smoothstep(0.9, 1.1, f) ** 1.5
        return y

    def _place_spikes(self, rng, count):
        tries = 0
        while len(self.spikes) < count and tries < count * 20:
            tries += 1
            th = rng.uniform(0, math.tau); rho = math.sqrt(rng.uniform(0.04, 0.72)) * self.R
            x, z = rho * math.cos(th), rho * math.sin(th)
            ys = np.arange(0.0, -self.D * 1.3, -0.5, dtype=F32)
            P = np.stack([np.full_like(ys, x), ys, np.full_like(ys, z)], 1)
            d = self._body(P[:, 0], P[:, 1], P[:, 2], None)
            inside = np.nonzero(d < 0)[0]
            if len(inside) == 0:
                continue
            yb = float(ys[inside[-1]])
            if yb > -0.25 * self.D:
                continue
            L = rng.uniform(0.06, 0.2) * self.D * (1.3 - rho / self.R)
            if any(math.hypot(x - s[0], z - s[2]) < 0.1 * self.R for s in self.spikes):
                continue
            self.spikes.append((x, yb + 2.5, z, L + 2.5, rng.uniform(0.14, 0.24) * L + min(1.0, 0.06 * self.R)))

    def _place_boulders(self, rng, count, size):
        self.boulders = []
        centers = rng.uniform(0, math.tau, max(1, count // 4))
        for i in range(count):
            th = centers[i % len(centers)] + rng.normal(0, 0.28)
            s = rng.uniform(*size)
            x0, z0 = math.cos(th), math.sin(th)
            # radial position: walk out until we exit the top outline, then pull back
            rr = self._outline_r(th) * rng.uniform(0.87, 0.97) - s * 0.3
            x, z = x0 * rr, z0 * rr
            y = float(self._top(np.array([x], F32), np.array([z], F32))[0]) + s * rng.uniform(0.15, 0.4)
            self.boulders.append((x, y, z, s * rng.uniform(0.9, 1.35), s * rng.uniform(0.55, 0.9), s * rng.uniform(0.8, 1.15),
                                  rng.uniform(0, math.tau), rng.normal(0, 0.25)))

    def _outline_r(self, th):
        m = self.masses[0]
        r = 1.0 + sum(a * math.cos(k * th + ph) for k, a, ph in m.harm)
        return m.R * r

    def _fit_bounds(self):
        lo = list(self.lo); hi = list(self.hi)
        for m in self.masses:
            e = m.R * 1.45 + sum(self.lump) + 4
            lo[0] = min(lo[0], m.x - e); hi[0] = max(hi[0], m.x + e)
            lo[2] = min(lo[2], m.z - e); hi[2] = max(hi[2], m.z + e)
        for s in self.spikes:
            lo[1] = min(lo[1], s[1] - s[3] - 3)
        self.lo, self.hi = tuple(lo), tuple(hi)

    def _spikes(self, x, y, z, d, side):
        for (sx, sy, sz, L, r0) in self.spikes:
            dy = y - sy
            t = np.clip(-dy / L, 0.0, 1.0)
            bx = sx + 0.12 * L * t * t; bz = sz - 0.08 * L * t * t
            r = r0 * (1 - t) ** 1.25
            dd = np.sqrt((x - bx) ** 2 + (z - bz) ** 2) - r
            dd = np.where(-dy > L, np.sqrt((x - bx) ** 2 + (z - bz) ** 2 + (dy + L) ** 2), dd)
            dd = np.maximum(dd, y - min(sy + 6.0, -1.5))
            if side is not None:
                dd = dd + 0.4 * side
            d = smin(d, dd / 1.15, 2.2)
        return d

    def _boulders(self, x, y, z, d):
        if not self.boulders:
            return d
        m = (y > -8) & (y < 14)
        if not m.any():
            return d
        xm, ym, zm = x[m], y[m], z[m]
        db = np.full(xm.shape, 1e3, F32)
        for (bx, by, bz, a, b, c, ry, rx) in self.boulders:
            px = xm - bx; py = ym - by; pz = zm - bz
            cs, sn = math.cos(ry), math.sin(ry)
            qx = px * cs + pz * sn; qz = -px * sn + pz * cs
            cr, sr = math.cos(rx), math.sin(rx)
            qy = py * cr - qz * sr; qz = py * sr + qz * cr
            k = np.sqrt((qx / a) ** 2 + (qy / b) ** 2 + (qz / c) ** 2)
            e = (k - 1.0) * min(a, b, c)
            # facet the ellipsoid with two cleavage planes
            e = smax(e, qy - b * 0.72, 0.4 * b)
            e = smax(e, qx * 0.6 + qz * 0.8 - 0.8 * max(a, c), 0.5 * b)
            db = np.minimum(db, e)
        db = db + 0.22 * self.n[6].raw(xm / 1.6, ym / 1.6, zm / 1.6) * 1.8
        out = d.copy()
        out[m] = smin(d[m], db, 0.7)
        return out

    def base(self, P):
        P = self._rot(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        d = self._body(x, y, z, None)
        d = smax(d, y, self.rim_k)
        d = self._spikes(x, y, z, d, None)
        return d.astype(F32)

    def full(self, P):
        P = self._rot(P)
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        nl, nm, nr, ng, nt, nx, nb, nc = self.n
        below = smoothstep(-1.5, -14.0, y)
        side = self.lump[0] * nl.fbm(x / 26, y / 34, z / 26, 2) + self.lump[1] * nm.fbm(x / 9, y / 12, z / 9, 2)
        yl = layer_y(x, y, z)
        side = side + self.strata.recess(yl, x, z, nr, 18.0) * self.rec_scale * below
        gl = ng.fbm(x / 8, y / 30, z / 8, 2)
        side = side + self.gully * (1 - smoothstep(0.0, 0.22, np.abs(gl))) * below
        d = self._body(x, y, z, side)
        d = smax(d, y - self._top(x, z), self.rim_k)
        d = self._spikes(x, y, z, d, side)
        d = self._boulders(x, y, z, d)
        return d.astype(F32)

    def colors(self, V, N, ao):
        Vr = self._rot(V)
        Nr = self._rot(N)
        x, y, z = Vr[:, 0], Vr[:, 1], Vr[:, 2]
        band = self.strata.value(layer_y(x, y, z)) + 0.1 * self.n[5].raw(x / 3, y / 1.2, z / 3)
        up = smoothstep(0.5, 0.88, Nr[:, 1])
        topness = smoothstep(-6.0, -0.8, y)
        expo = smoothstep(0.25, 0.7, ao)
        patch = np.clip(0.8 + 0.35 * self.n[7].fbm(x / 6, y / 6, z / 6, 2), 0.4, 1.0)
        veg = up * expo * (0.3 + 0.7 * topness) * np.where(topness > 0.5, np.maximum(patch, 0.85), patch)
        return np.stack([ao, np.clip(veg, 0, 1), np.clip(band, 0, 1)], 1)


# ---------------------------------------------------------------- boulders
class Boulder:
    kind = 'boulder'

    def __init__(self, name, seed, size, aspect=(1.0, 0.75, 0.9), n_planes=11, round_k=0.11, lump=0.05,
                 layered=0.0, crack=False, tris=(1500, 400), hang=False, taper=0.0, tilt=(0.0, 0.0)):
        rng = np.random.default_rng(seed)
        self.hang, self.taper, self.tilt = hang, taper, tilt
        self.name, self.size, self.tris = name, size, tris
        self.n = [Perlin(seed * 211 + i) for i in range(4)]
        self.r = size / 2
        self.aspect = np.array(aspect, F32)
        dirs = fib_sphere(n_planes) + rng.normal(0, 0.25, (n_planes, 3))
        dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
        self.planes = [(dirs[i].astype(F32), self.r * rng.uniform(0.78, 1.0)) for i in range(n_planes)]
        self.round_k = round_k * self.r
        self.lump, self.layered, self.crack = lump, layered, crack
        self.ry = rng.uniform(0, math.tau)
        self.height = 2 * self.r * aspect[1]
        self.cy = self.r * aspect[1] * 0.52        # centre height: the flat bed face sits ~5% below y=0
        if hang:                                   # floating chunk: flat broken top at y=0, keel below
            self.cy = -self.r * aspect[1] * 0.5
        self.strata = Strata(seed * 5 + 1, y_min=-10, y_max=40, scale=0.12 * size / 6)
        self.crack_ang = rng.uniform(0, math.tau)
        self.band = (-1e9, 1e9)
        e = self.r * 1.25
        self.lo = (-e * aspect[0] - 1, -0.3 * self.r - 1, -e * aspect[2] - 1)
        self.hi = (e * aspect[0] + 1, 2 * e * aspect[1] + 1, e * aspect[2] + 1)
        if hang:
            m = 1 + 1.6 * max(abs(tilt[0]), abs(tilt[1]))
            ex = e * max(aspect[0], aspect[2]) * m + 1
            self.lo = (-ex, (self.cy - e * aspect[1]) * m - 1, -ex)
            self.hi = (ex, 0.6 * self.r * m + 1, ex)
        vol = np.prod(np.array(self.hi) - np.array(self.lo))
        self.h = float((vol / 2.5e6) ** (1 / 3))
        self.ao = dict(tmax=self.r * 2.5, steps=16)

    def full(self, P):
        P = tilt_rot(P, self.tilt)
        x, y, z = P[:, 0], P[:, 1] - self.cy, P[:, 2]
        cs, sn = math.cos(self.ry), math.sin(self.ry)
        qx = (x * cs + z * sn) / self.aspect[0]; qz = (-x * sn + z * cs) / self.aspect[2]; qy = y / self.aspect[1]
        if self.taper:
            k = np.maximum(0.3, 1 - self.taper * np.clip(-P[:, 1] / (2 * self.r * self.aspect[1]), 0, 1))
            qx = qx / k; qz = qz / k
        d = None
        for n, dist in self.planes:
            pd = qx * n[0] + qy * n[1] + qz * n[2] - dist
            d = pd if d is None else smax(d, pd, self.round_k)
        if not self.hang:  # resting rock: a flat bed face so it never balances on a vertex
            d = smax(d, -qy - 0.62 * self.r, self.round_k)
        # random cleavage planes need not enclose a bounded polytope: close it with a sphere
        d = smax(d, np.sqrt(qx * qx + qy * qy + qz * qz) - 1.3 * self.r, 0.1 * self.r)
        d = d * float(self.aspect.min())
        d = d + self.lump * self.r * self.n[0].fbm(P[:, 0] / (0.45 * self.r), P[:, 1] / (0.45 * self.r), P[:, 2] / (0.45 * self.r), 3)
        if self.layered:
            rec = self.layered * self.r * 0.03 * self.strata.recess(P[:, 1])
            if not self.hang:  # keep the footing solid: a recess through the base would cut off a loose slab
                rec = rec * smoothstep(0.02 * self.height, 0.22 * self.height, P[:, 1])
            d = d + rec
        if self.crack:
            s = P[:, 0] * math.cos(self.crack_ang) + P[:, 2] * math.sin(self.crack_ang) + 0.3 * self.r * self.n[1].raw(P[:, 1] / self.r, 0.2 + 0 * P[:, 1], 0 * P[:, 1])
            w = 0.035 * self.r * np.clip(1 + d / (0.5 * self.r), 0.1, 1)
            # partial fracture: opens from the top, stops ~0.35r deep and above the lower third
            rc = np.maximum(np.abs(s) - w, -(d + 0.35 * self.r))
            rc = np.maximum(rc, 0.3 * self.height - P[:, 1])
            d = smax(d, -rc, 0.05 * self.r)
        if self.hang:
            top = 0.04 * self.r * self.n[3].fbm(P[:, 0] / self.r, 0 * P[:, 0], P[:, 2] / self.r, 2)
            return smax(d, P[:, 1] - top, 0.12 * self.r).astype(F32)
        return np.maximum(d, -(P[:, 1] + 0.08 * self.height)).astype(F32)

    def base(self, P):
        return self.full(P)

    def colors(self, V, N, ao):
        if self.hang:
            V = tilt_rot(V, self.tilt)
        band = self.strata.value(V[:, 1]) + 0.1 * self.n[2].raw(V[:, 0] / 1.5, V[:, 1] / 0.6, V[:, 2] / 1.5)
        up = smoothstep(0.45, 0.9, N[:, 1])
        patch = np.clip(0.6 + 0.6 * self.n[3].fbm(V[:, 0] / 2, V[:, 1] / 2, V[:, 2] / 2, 2), 0, 1)
        veg = up * smoothstep(0.3, 0.75, ao) * patch * 0.85
        return np.stack([ao, np.clip(veg, 0, 1), np.clip(band, 0, 1)], 1)


# ---------------------------------------------------------------- asset specs
J, J2 = JOINT_PHI, JOINT_PHI + math.pi / 2


def pillar_specs():
    P = []
    # 0 — split twin (Zhangjiajie): two square columns fused low, divergent tops, wide split slot
    a = Column(x=-15, z=2, H=380, a=25, b=21, rc=8, lx=-11, lz=5, taper=0.2, tpow=1.4, dome_h=5, flat=0.6,
               setbacks=((118, 0.05), (247, 0.06), (322, 0.05)))
    b = Column(x=16, z=-3, H=318, a=22, b=19, rc=7, phi=J + 0.07, lx=10, lz=-5, taper=0.24, dome_h=4, flat=0.6,
               setbacks=((196, 0.07), (268, 0.05)))
    tx, tz = a.top_center()
    pin = Column(x=tx - 8, z=tz + 5, y0=358, H=396, a=7, b=5.5, rc=3, taper=0.45, dome_h=3, flat=0.5, edge_k=1.2)
    P.append(Pillar('pillar_0', 11, [a, b, pin],
                    cracks=[Crack(0, J, 5, 2.4, 70, 150, 420, fade=40, wmin=0.75, meander=1.2),
                            Crack(0, J2, 6, 1.6, 12, 40, 390, meander=2.0),
                            Crack(1, J2, -5, 1.5, 10, 60, 330),
                            Crack(0, J, -9, 1.2, 8, 200, 390, fade=30)],
                    cuts=[Cut(tx + 14, 381, tz - 12, 9, 7, 8)], tris=(22000, 2500)))
    # 1 — slender leaning spire with a fused lower buttress
    c = Column(x=0, z=0, H=300, a=22, b=18, rc=8, phi=J - 0.12, lx=17, lz=6, taper=0.36, tpow=1.6, dome_h=6,
               dome_p=2.0, flat=0.55, setbacks=((88, 0.05), (171, 0.06), (232, 0.07)), wob=3.5, wid=0.07)
    bt = Column(x=-17, z=10, H=150, a=15, b=12, rc=6, phi=J + 0.1, lx=-3, lz=2, taper=0.3, dome_h=5, flat=0.6)
    tx, tz = c.top_center()
    pin = Column(x=tx - 5, z=tz + 3, y0=270, H=312, a=6, b=5, rc=2.5, taper=0.35, dome_h=2.5, flat=0.5, edge_k=1.2)
    P.append(Pillar('pillar_1', 23, [c, bt, pin], cracks=[Crack(0, J2, 5, 1.4, 9, 20, 290, meander=2.2),
                                                       Crack(0, J, -6, 1.2, 8, 110, 300)],
                    lump=(2.4, 0.9), tris=(16000, 2500)))
    # 2 — massive terraced block, three fused towers, broad pine terraces
    a = Column(x=-12, z=-10, H=240, a=40, b=34, rc=16, taper=0.12, dome_h=6, flat=0.75,
               setbacks=((80, 0.05), (148, 0.06), (201, 0.06)))
    b = Column(x=24, z=17, H=206, a=30, b=26, rc=13, phi=J + 0.05, lx=4, lz=3, taper=0.14, dome_h=5, flat=0.72,
               setbacks=((121, 0.06),))
    c = Column(x=-27, z=27, H=172, a=22, b=20, rc=11, phi=J - 0.06, lx=-3, lz=4, taper=0.1, dome_h=4, flat=0.7)
    tx, tz = a.top_center()
    p1 = Column(x=tx + 12, z=tz - 9, y0=226, H=256, a=13, b=10, rc=5, taper=0.4, dome_h=3, flat=0.55, edge_k=1.5)
    p2 = Column(x=tx - 15, z=tz + 6, y0=228, H=247, a=11, b=9, rc=4, taper=0.35, dome_h=2, flat=0.55, edge_k=1.5)
    P.append(Pillar('pillar_2', 37, [a, b, c, p1, p2],
                    cracks=[Crack(0, J, 21, 2.0, 30, 80, 260, fade=30, wmin=0.5),
                            Crack(0, J2, 12, 1.8, 14, 20, 250),
                            Crack(1, J2, -4, 1.4, 10, 30, 215),
                            Crack(2, J, 3, 1.3, 9, 20, 180),
                            Crack(0, J2, -20, 1.5, 10, 60, 245)],
                    cuts=[Cut(tx - 30, 238, tz - 22, 12, 9, 10), Cut(-45, 172, 42, 9, 6, 8)],
                    rec_scale=1.15, lump=(3.4, 1.1), tris=(24000, 2500)))
    # 3 — tall triple tower
    a = Column(x=-10, z=-12, H=404, a=24, b=22, rc=9, lx=-8, lz=-10, taper=0.24, tpow=1.5, dome_h=5, flat=0.6,
               setbacks=((150, 0.05), (286, 0.06), (371, 0.05)))
    b = Column(x=19, z=4, H=362, a=21, b=18, rc=8, phi=J + 0.08, lx=11, lz=3, taper=0.25, dome_h=4, flat=0.6,
               setbacks=((233, 0.06),))
    c = Column(x=-8, z=23, H=298, a=19, b=17, rc=8, phi=J - 0.05, lx=-6, lz=10, taper=0.22, dome_h=4, flat=0.62,
               setbacks=((180, 0.05),))
    tx, tz = a.top_center()
    pin = Column(x=tx + 7, z=tz + 6, y0=388, H=418, a=7, b=6, rc=3, taper=0.3, dome_h=3, flat=0.5, edge_k=1.2)
    P.append(Pillar('pillar_3', 41, [a, b, c, pin],
                    cracks=[Crack(0, J, 5, 2.2, 60, 170, 440, fade=40, wmin=0.75),
                            Crack(0, J2, -4, 2.0, 60, 230, 440, fade=40, wmin=0.75),
                            Crack(0, J2, -7, 1.4, 10, 30, 410),
                            Crack(1, J2, 5, 1.3, 9, 40, 350),
                            Crack(2, J, -5, 1.2, 8, 30, 290)],
                    tris=(24000, 2500)))
    # 4 — leaning tower with a soft-bed waist and an overhanging cap block
    c = Column(x=0, z=0, H=200, a=32, b=27, rc=13, phi=J + 0.1, lx=21, lz=-8, taper=0.03, bulge=0.05,
               dome_h=6, flat=0.62, setbacks=((61, 0.05),), necks=((122, 9.0, 0.2), (40, 6.0, 0.06)))
    tx, tz = c.top_center()
    pin = Column(x=tx - 8, z=tz + 6, y0=188, H=215, a=15, b=11, rc=5, phi=J + 0.12, taper=0.42, dome_h=3, flat=0.5, edge_k=1.5)
    P.append(Pillar('pillar_4', 53, [c, pin], cracks=[Crack(0, J2, 8, 1.5, 11, 10, 190),
                                                   Crack(0, J, -10, 1.4, 9, 60, 205)],
                    cuts=[Cut(tx + 18, 200, tz + 12, 8, 6, 9)], tris=(18000, 2500)))
    # 5 — Guilin-style rounded limestone dome with a smaller attached dome
    a = Column(x=-6, z=-4, H=258, a=40, b=36, rc=33, phi=J + 0.3, lx=7, lz=5, taper=0.2, tpow=1.9, dome_h=34,
               dome_p=2.6, flat=None, top_amp=3.0, setbacks=((96, 0.04), (170, 0.05)), wob=4.0, wid=0.08)
    b = Column(x=28, z=24, H=152, a=22, b=20, rc=17, phi=J - 0.2, lx=5, lz=4, taper=0.24, tpow=1.8, dome_h=22,
               dome_p=2.4, flat=None, top_amp=2.5, wob=3.0, wid=0.08)
    P.append(Pillar('pillar_5', 67, [a, b], cracks=[Crack(0, J2, 14, 1.6, 12, 20, 240, meander=2.6),
                                                 Crack(0, J, -12, 1.5, 11, 40, 230, meander=2.6)],
                    flute=2.6, flute_scale=6.0, rec_scale=0.6, lump=(3.6, 2.0), lattice=(10.0, 22.0), drop_p=0.0,
                    tris=(20000, 2500)))
    return P


def island_specs():
    """Each island returns (Island, [(debris Island, (x, y, z))...])."""
    out = []
    defs = [
        # name, seed, R, D, lobes (ox, oz, rf, df), spikes, boulders, debris count
        ('isle_0', 101, 22, 76, [(0.12, 0.1, 0.72, 1.0), (-0.45, 0.3, 0.46, 0.64), (0.32, -0.45, 0.4, 0.5)], 7, 14, 3),
        ('isle_1', 202, 36, 100, [(-0.18, 0.15, 0.5, 1.0), (0.5, -0.1, 0.42, 0.7), (-0.2, -0.55, 0.36, 0.55),
                                  (0.3, 0.55, 0.3, 0.42)], 9, 18, 4),
        ('isle_2', 303, 50, 128, [(0.15, -0.2, 0.48, 1.0), (-0.52, 0.12, 0.42, 0.74), (0.45, 0.45, 0.36, 0.58),
                                  (-0.2, 0.58, 0.3, 0.45), (0.55, -0.45, 0.26, 0.36)], 11, 22, 4),
        ('isle_3', 404, 62, 155, [(-0.12, 0.2, 0.46, 1.0), (0.5, 0.15, 0.4, 0.78), (-0.5, -0.35, 0.4, 0.64),
                                  (0.15, -0.58, 0.32, 0.5), (-0.45, 0.5, 0.28, 0.4), (0.58, -0.4, 0.24, 0.33)], 13, 26, 5),
    ]
    for name, seed, R, D, lobes, sp, bo, nd in defs:
        isle = Island(name, seed, R, D, lobes=lobes, n_spikes=sp, n_boulders=bo, samples=2.5e7,
                      tris=(int(11000 + 110 * R), 2000))
        rng = np.random.default_rng(seed + 9)
        debris = []
        for j in range(nd):
            s = rng.uniform(0.08, 0.17) * R + 2.0
            pos = None
            for attempt in range(80):
                th = rng.uniform(0, math.tau)
                rr = R * rng.uniform(0.7, 1.2) * (1 + attempt / 40)
                cand = (rr * math.cos(th), -D * rng.uniform(0.3, 0.95), rr * math.sin(th))
                clear = float(isle.base(np.array([cand], F32))[0])
                if clear > s * 2.4 + 6 and all(math.dist(cand, q) > 3.0 * s + 3 for _, q in debris):
                    pos = cand
                    break
            assert pos is not None, f'no room for debris {j} of {name}'
            chunk = Boulder(f'{name}_debris_{j}', seed * 10 + j, s, aspect=(rng.uniform(0.9, 1.25), rng.uniform(1.2, 1.9), rng.uniform(0.8, 1.1)),
                            n_planes=int(rng.integers(9, 14)), round_k=0.12, lump=0.06, layered=1.0, hang=True,
                            taper=rng.uniform(0.35, 0.65), tilt=(rng.normal(0, 0.22), rng.normal(0, 0.22)),
                            tris=(int(600 + 40 * s), int(110 + 5 * s)))
            debris.append((chunk, pos))
        out.append((isle, debris))
    return out


def boulder_specs():
    return [
        Boulder('boulder_0', 501, 2.2, aspect=(1.1, 0.7, 0.9), tris=(1100, 300)),
        Boulder('boulder_1', 502, 3.6, aspect=(1.2, 0.6, 1.0), layered=1.0, tris=(1300, 300)),
        Boulder('boulder_2', 513, 5.2, aspect=(1.0, 0.95, 0.85), n_planes=11, round_k=0.09, crack=True, tris=(1500, 350)),
        Boulder('boulder_3', 504, 7.0, aspect=(1.3, 0.55, 1.0), layered=1.5, tris=(1700, 400)),
        Boulder('boulder_4', 505, 9.5, aspect=(1.0, 0.8, 0.85), n_planes=10, round_k=0.06, crack=True, tris=(1900, 400)),
        Boulder('boulder_5', 506, 9.2, aspect=(1.15, 0.65, 0.95), layered=0.8, tris=(2000, 450)),
    ]


def registry():
    """name -> (spec, group, parent name or None, offset relative to parent's SDF origin)."""
    reg = {}
    for p in pillar_specs():
        reg[p.name] = (p, 'pillars', None, (0.0, 0.0, 0.0))
    for isle, debris in island_specs():
        reg[isle.name] = (isle, 'islands', None, (0.0, 0.0, 0.0))
        for chunk, pos in debris:
            reg[chunk.name] = (chunk, 'islands', isle.name, pos)
    for b in boulder_specs():
        reg[b.name] = (b, 'boulders', None, (0.0, 0.0, 0.0))
    return reg
