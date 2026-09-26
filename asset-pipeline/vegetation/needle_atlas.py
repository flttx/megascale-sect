"""Procedural needle-cluster atlas for the Huangshan pine foliage cards.

Run with Blender's bundled Python (numpy only):
  blender -b --factory-startup -P needle_atlas.py

Writes textures/needles_basecolor.png (RGBA, sRGB, alpha cut-out) and textures/needles_normal.png
(tangent space, OpenGL / glTF convention: +X = image right, +Y = image up).

Atlas: 2x2 cells of 512 px, row-major from the image TOP (0 = top-left ... 3 = bottom-right):
  0, 1  radial sprays: 5-7 bottle-brush shoots radiating from the centre (shoot cluster seen from above)
  2     fan spray: shoots rising from the bottom edge (side view; rim cards put its base toward the pad)
  3     dense clump: overlapping shoots with an opaque core (pad interiors and the LOD1 cards)
"""
import math
import os
import struct
import zlib

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'textures')
SS = 2                    # supersampling factor
SIZE = 1024
CELL = SIZE // 2
S = CELL * SS             # cell size while drawing

rng = np.random.default_rng(20260926)

# sRGB tones: dark blue-green needle bases, three tip palettes (blue-green, green, pale yellow-green).
BASE = np.array([[0.045, 0.085, 0.065], [0.055, 0.095, 0.060], [0.040, 0.078, 0.066]])
TIPS = np.array([[0.165, 0.290, 0.250], [0.200, 0.320, 0.200], [0.270, 0.360, 0.200]])
TWIG = np.array([0.20, 0.155, 0.115])


def write_png(path, arr):
    """arr: HxWxC uint8, row 0 = top."""
    h, w, c = arr.shape
    ctype = {3: 2, 4: 6}[c]
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, ctype, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


class Cell:
    def __init__(self):
        self.rgb = np.zeros((S, S, 3), np.float32)
        self.a = np.zeros((S, S), np.float32)
        self.n = np.zeros((S, S, 3), np.float32)
        self.n[..., 2] = 1.0

    def _over(self, ys, xs, cov, col, nrm):
        c = cov[..., None]
        self.rgb[ys, xs] = col * c + self.rgb[ys, xs] * (1 - c)
        self.a[ys, xs] = cov + self.a[ys, xs] * (1 - cov)
        self.n[ys, xs] = nrm * c + self.n[ys, xs] * (1 - c)

    def segment(self, p0, p1, w0, w1, c0, c1, lean=None, tilt=0.0):
        """Tapered anti-aliased stroke p0->p1 (pixel coords x right, y down); half-widths w0->w1.
        The normal is cylindrical across the stroke, leaned along `lean` by `tilt`."""
        pad = max(w0, w1) + 2
        x0 = int(max(0, math.floor(min(p0[0], p1[0]) - pad)))
        x1 = int(min(S, math.ceil(max(p0[0], p1[0]) + pad)))
        y0 = int(max(0, math.floor(min(p0[1], p1[1]) - pad)))
        y1 = int(min(S, math.ceil(max(p0[1], p1[1]) + pad)))
        if x1 <= x0 or y1 <= y0:
            return
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        d = np.array(p1, np.float32) - np.array(p0, np.float32)
        L2 = float(d @ d) + 1e-6
        px, py = xx + 0.5 - p0[0], yy + 0.5 - p0[1]
        t = np.clip((px * d[0] + py * d[1]) / L2, 0, 1)
        cx, cy = px - t * d[0], py - t * d[1]
        dist = np.sqrt(cx * cx + cy * cy)
        w = w0 + (w1 - w0) * t
        cov = np.clip(w - dist + 0.5, 0, 1)
        if not cov.any():
            return
        col = c0 + (c1 - c0) * np.power(t[..., None], 0.8)
        L = math.sqrt(L2)
        ux, uy = d[0] / L, d[1] / L
        perp_x, perp_y = -uy, ux
        s = np.clip((cx * perp_x + cy * perp_y) / np.maximum(w, 0.6), -1, 1)
        nx, ny = perp_x * s * 0.75, perp_y * s * 0.75
        if lean is not None:
            nx, ny = nx + lean[0] * tilt, ny + lean[1] * tilt
        nrm = np.stack([nx, -ny, np.ones_like(nx)], -1)   # image y is down, normal-map +Y is up
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        self._over(slice(y0, y1), slice(x0, x1), cov, col, nrm)

    def blob(self, c, r, col, dome=0.5, hard=3.0):
        """Soft dark underlay disc: keeps mip-mapped alpha above the cut-off in cluster cores."""
        x0, x1 = int(max(0, c[0] - r - 2)), int(min(S, c[0] + r + 2))
        y0, y1 = int(max(0, c[1] - r - 2)), int(min(S, c[1] + r + 2))
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        dx, dy = (xx + 0.5 - c[0]) / r, (yy + 0.5 - c[1]) / r
        rr = np.sqrt(dx * dx + dy * dy)
        cov = np.clip((1.0 - rr) * hard, 0, 1)
        nrm = np.stack([dx * dome, -dy * dome, np.ones_like(dx)], -1)
        nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
        self._over(slice(y0, y1), slice(x0, x1), cov, np.broadcast_to(col, cov.shape + (3,)), nrm)


def needle(cell, p, ang, L, base, tip, lean):
    dx, dy = math.cos(ang), math.sin(ang)
    bend = rng.normal(0, 0.08)
    p1 = (p[0] + (dx - dy * bend) * L, p[1] + (dy + dx * bend) * L)
    w0 = SS * (1.0 + 0.4 * rng.random())
    cell.segment(p, p1, w0, SS * 0.35, base, np.minimum(tip, 1.0), lean=lean, tilt=0.3)


def shoot(cell, p0, ang, length, nl, bright, density=1.0):
    """Bottle-brush pine shoot: a twig clothed in forward-pointing needle pairs, denser toward a
    terminal brush. Back needles are drawn dim before the twig, front needles bright after it."""
    k = rng.integers(0, 3)
    base = BASE[k] * (0.85 + 0.3 * rng.random())
    curve = rng.normal(0, 0.25)
    pts = []
    for i in range(9):
        t = i / 8
        a = ang + curve * t
        if not pts:
            pts.append(np.array(p0, np.float32))
        else:
            pts.append(pts[-1] + length / 8 * np.array([math.cos(a), math.sin(a)], np.float32))
    pts = np.array(pts)
    total = int(density * length / (SS * 1.6)) + 18
    jobs = []
    for _ in range(total):
        t = rng.random() ** 0.55                       # more needles toward the tip
        seg = min(7, int(t * 8))
        f = t * 8 - seg
        p = pts[seg] * (1 - f) + pts[seg + 1] * f
        a_tw = ang + curve * t
        side = 1 if rng.random() < 0.5 else -1
        spread = math.radians(18 + 50 * rng.random()) * (1.0 - 0.45 * t)   # tip needles hug the axis
        a = a_tw + side * spread
        L = nl * (0.65 + 0.4 * rng.random()) * (0.75 + 0.35 * t)
        front = rng.random() < 0.55
        jobs.append((front, p, a, L))
    # terminal brush
    tipp = pts[-1]
    for _ in range(int(22 * density)):
        a = ang + curve + rng.normal(0, 0.55)
        jobs.append((rng.random() < 0.6, tipp - 0.05 * length * np.array([math.cos(ang), math.sin(ang)]), a,
                     nl * (0.7 + 0.4 * rng.random())))
    lean_dir = (math.cos(ang), math.sin(ang))
    for front, p, a, L in jobs:
        if not front:
            tip = TIPS[rng.integers(0, 3)] * bright * 0.72 * (0.85 + 0.3 * rng.random())
            needle(cell, p, a, L, base * 0.85, tip, lean_dir)
    for i in range(8):
        w = SS * (1.9 - 1.1 * i / 8)
        cell.segment(tuple(pts[i]), tuple(pts[i + 1]), w, w * 0.85, TWIG * 0.75, TWIG)
    for front, p, a, L in jobs:
        if front:
            tip = TIPS[rng.integers(0, 3)] * bright * (0.85 + 0.3 * rng.random())
            needle(cell, p, a, L, base, tip, lean_dir)


def radial_spray(cell, n, rlen, nl, bright=1.0, density=1.0, jitter=0.12):
    ctr = np.array([S / 2, S / 2]) + rng.normal(0, 0.02 * S, 2)
    a0 = rng.random() * 2 * math.pi
    order = rng.permutation(n)
    for i in order:
        a = a0 + 2 * math.pi * i / n + rng.normal(0, jitter)
        L = S * rlen * (0.75 + 0.3 * rng.random())
        shoot(cell, ctr + 0.03 * S * np.array([math.cos(a), math.sin(a)]), a, L, S * nl, bright * (0.9 + 0.2 * rng.random()), density)


def fan_spray(cell, n, rlen, nl, bright=1.0, density=1.0):
    base = np.array([S / 2, S * 0.93])
    angs = np.linspace(-0.85, 0.85, n) + rng.normal(0, 0.07, n)
    for i in rng.permutation(n):
        a = -math.pi / 2 + angs[i]
        L = S * rlen * (0.8 + 0.25 * rng.random()) * (1.0 - 0.25 * abs(angs[i]))
        shoot(cell, base + rng.normal(0, 0.01 * S, 2), a, L, S * nl, bright * (0.9 + 0.2 * rng.random()), density)


def finish(cell):
    """Downsample, fade the rim, bleed colour into transparent texels."""
    def down(x):
        return x.reshape(CELL, SS, CELL, SS, *x.shape[2:]).mean(axis=(1, 3))

    rgb, a, n = down(cell.rgb), down(cell.a), down(cell.n)
    yy, xx = np.mgrid[0:CELL, 0:CELL].astype(np.float32)
    edge = np.minimum.reduce([xx, yy, CELL - 1 - xx, CELL - 1 - yy])
    a *= np.clip((edge - 3) / 8, 0, 1)        # nothing touches the cell border (no mip bleeding)

    def blur(x, r):
        k = 2 * r + 1
        p = np.pad(x, [(r, r), (r, r)] + [(0, 0)] * (x.ndim - 2), mode='edge')
        c = np.cumsum(np.cumsum(p, 0), 1)
        c = np.pad(c, [(1, 0), (1, 0)] + [(0, 0)] * (x.ndim - 2))
        return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)

    pre = blur(rgb * a[..., None], 12)
    aw = blur(a, 12)[..., None]
    mean = (rgb * a[..., None]).sum((0, 1)) / max(a.sum(), 1)
    fill = np.where(aw > 1e-3, pre / np.maximum(aw, 1e-3), mean)
    m = np.clip(a * 4, 0, 1)[..., None]
    rgb = rgb * m + fill * (1 - m)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    n = n * m + np.array([0, 0, 1.0]) * (1 - m)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return rgb, a, n


def main():
    color = np.zeros((SIZE, SIZE, 4), np.float32)
    normal = np.zeros((SIZE, SIZE, 3), np.float32)
    for idx in range(4):
        cell = Cell()
        if idx == 0:
            radial_spray(cell, 8, 0.32, 0.12, density=1.5)
            radial_spray(cell, 4, 0.22, 0.11, bright=1.1, density=1.2, jitter=0.4)
        elif idx == 1:
            radial_spray(cell, 7, 0.34, 0.125, bright=1.05, density=1.5)
            radial_spray(cell, 4, 0.24, 0.11, bright=1.15, density=1.2, jitter=0.4)
        elif idx == 2:
            fan_spray(cell, 8, 0.68, 0.12, bright=1.05, density=1.5)
            fan_spray(cell, 5, 0.45, 0.11, bright=1.15, density=1.2)
        else:
            cell.blob((S / 2, S / 2), S * 0.2, BASE[0] * 0.9, dome=0.6, hard=2.0)
            radial_spray(cell, 9, 0.34, 0.125, bright=0.8, density=1.6, jitter=0.2)
            radial_spray(cell, 6, 0.28, 0.12, bright=1.1, density=1.4, jitter=0.3)
        rgb, a, n = finish(cell)
        r, c = divmod(idx, 2)
        ys, xs = slice(r * CELL, (r + 1) * CELL), slice(c * CELL, (c + 1) * CELL)
        color[ys, xs, :3] = rgb
        color[ys, xs, 3] = a
        normal[ys, xs] = n
        print(f'cell {idx}: alpha>0.5 coverage {(a > 0.5).mean():.2f}')
    os.makedirs(OUT, exist_ok=True)
    write_png(os.path.join(OUT, 'needles_basecolor.png'), (np.clip(color, 0, 1) * 255 + 0.5).astype(np.uint8))
    write_png(os.path.join(OUT, 'needles_normal.png'), ((normal * 0.5 + 0.5).clip(0, 1) * 255 + 0.5).astype(np.uint8))
    print('needle atlas written to', OUT)


main()
