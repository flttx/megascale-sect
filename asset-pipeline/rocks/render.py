"""EEVEE preview renders from the build cache.

  blender -b --factory-startup -P render.py -- <view> [--lod lod0] [--mode clay|attr] [--out file.png] [--res 1920x1080]
views: pillars | islands | boulders | close_<name> | top_<name>
clay = grey clay shaded by COLOR_0.R (AO); attr = R shading, G tinted green, B tinted warm/cool.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from blendio import finish_object, load, make_object, reset_scene, to_blender  # noqa: E402

OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'artifacts', 'assets', 'rocks'))
PILLARS = [f'pillar_{i}' for i in range(6)]
ISLES = [f'isle_{i}' for i in range(4)]
BOULDERS = [f'boulder_{i}' for i in range(6)]


def material(mode):
    m = bpy.data.materials.new(f'clay_{mode}')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.92
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Col'
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(ca.outputs['Color'], sep.inputs['Color'])
    # AO shading: grey * (0.18 + 0.82 * R^1.3)
    pw = nt.nodes.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 1.3
    nt.links.new(sep.outputs['Red'], pw.inputs[0])
    ml = nt.nodes.new('ShaderNodeMapRange'); ml.inputs['To Min'].default_value = 0.1; ml.inputs['To Max'].default_value = 1.0
    nt.links.new(pw.outputs[0], ml.inputs['Value'])
    grey = nt.nodes.new('ShaderNodeMix'); grey.data_type = 'RGBA'; grey.blend_type = 'MULTIPLY'
    grey.inputs['Factor'].default_value = 1.0
    base = (0.42, 0.4, 0.38, 1)
    if mode == 'attr':
        band = nt.nodes.new('ShaderNodeMix'); band.data_type = 'RGBA'
        band.inputs['A'].default_value = (0.36, 0.38, 0.44, 1); band.inputs['B'].default_value = (0.64, 0.55, 0.42, 1)
        nt.links.new(sep.outputs['Blue'], band.inputs['Factor'])
        veg = nt.nodes.new('ShaderNodeMix'); veg.data_type = 'RGBA'
        veg.inputs['B'].default_value = (0.14, 0.42, 0.1, 1)
        nt.links.new(band.outputs['Result'], veg.inputs['A'])
        nt.links.new(sep.outputs['Green'], veg.inputs['Factor'])
        nt.links.new(veg.outputs['Result'], grey.inputs['A'])
    else:
        grey.inputs['A'].default_value = base
    ml_rgb = nt.nodes.new('ShaderNodeCombineColor')
    for ch in ('Red', 'Green', 'Blue'):
        nt.links.new(ml.outputs['Result'], ml_rgb.inputs[ch])
    nt.links.new(ml_rgb.outputs['Color'], grey.inputs['B'])
    nt.links.new(grey.outputs['Result'], bsdf.inputs['Base Color'])
    return m


def setup(res):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    try:
        sc.eevee.use_shadows = True
        sc.eevee.taa_render_samples = 32
    except AttributeError:
        pass
    w = bpy.data.worlds.new('w'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.55, 0.62, 0.72, 1)
    bg.inputs['Strength'].default_value = 0.32
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.5)
    so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(58), math.radians(0), math.radians(-62))
    return sc


def camera(sc, eye_gl, look_gl, lens=85.0, ortho=None):
    cd = bpy.data.cameras.new('cam'); cd.lens = lens; cd.clip_start = 1.0; cd.clip_end = 20000
    if ortho:
        cd.type = 'ORTHO'; cd.ortho_scale = ortho
    co = bpy.data.objects.new('cam', cd); sc.collection.objects.link(co)
    eye = Vector(to_blender(eye_gl)[0]); look = Vector(to_blender(look_gl)[0])
    co.location = eye
    co.rotation_euler = (look - eye).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = co


def place(name, lod, mat, offset_gl, with_children=True):
    V, T, C, off, meta = load(name, lod)
    ob = make_object(name, V + np.asarray(offset_gl, np.float32), T)
    finish_object(ob, C)
    ob.data.materials.append(mat)
    objs = [(ob, meta)]
    if with_children:
        for f in sorted(os.listdir(os.path.join(HERE, 'cache'))):
            if f.startswith(name + '_debris_') and f.endswith('.npz'):
                Vd, Td, Cd, offd, metad = load(f[:-4], lod)
                od = make_object(f[:-4], Vd + offd + np.asarray(offset_gl, np.float32), Td)
                finish_object(od, Cd)
                od.data.materials.append(mat)
                objs.append((od, metad))
    return objs


def lineup(names, lod, mat, gap):
    x = 0.0
    placed = []
    for n in names:
        if not os.path.exists(os.path.join(HERE, 'cache', f'{n}.npz')):
            continue
        V, T, C, off, meta = load(n, lod)
        lo = V[:, 0].min(); hi = V[:, 0].max()
        x += -lo
        placed.append((n, x, meta))
        place(n, lod, mat, (x, 0, 0))
        x += hi + gap
    return placed, x - gap


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    view = argv[0]
    opt = {argv[i]: argv[i + 1] for i in range(1, len(argv) - 1, 2)}
    lod = opt.get('--lod', 'lod0'); mode = opt.get('--mode', 'clay')
    res = tuple(int(v) for v in opt.get('--res', '1920x1080').split('x'))
    reset_scene()
    sc = setup(res)
    mat = material(mode)
    if view == 'pillars':
        placed, width = lineup(PILLARS, lod, mat, 45.0)
        cx = width / 2
        camera(sc, (cx, 230, 2300), (cx, 205, 0), lens=85)
    elif view == 'islands':
        placed, width = lineup(ISLES, lod, mat, 40.0)
        cx = width / 2
        camera(sc, (cx, -150, 1000), (cx, -62, 0), lens=60)
    elif view == 'boulders':
        placed, width = lineup(BOULDERS, lod, mat, 3.0)
        cx = width / 2
        dist = max(75.0, width * 1.9)  # fit the whole lineup in a 60 mm frame
        camera(sc, (cx, 0.19 * dist, dist), (cx, 3, 0), lens=60)
    elif view.startswith('close_') or view.startswith('top_'):
        name = view.split('_', 1)[1]
        objs = place(name, lod, mat, (0, 0, 0))
        V = load(name, lod)[0]
        lo, hi = V.min(0), V.max(0)
        c = (lo + hi) / 2
        if name.startswith('pillar'):
            if view.startswith('top_'):
                camera(sc, (c[0] - 120, hi[1] + 130, c[2] + 150), (c[0], hi[1] - 55, c[2]), lens=35)
            else:
                camera(sc, (c[0] - 150, hi[1] * 0.6, c[2] + 260), (c[0], hi[1] * 0.66, c[2]), lens=50)
        elif name.startswith('isle'):
            r = hi[0] - lo[0]
            if view.startswith('top_'):
                camera(sc, (c[0] + r * 0.9, r * 0.55, c[2] + r * 1.0), (c[0], -r * 0.1, c[2]), lens=45)
            else:
                camera(sc, (c[0] + r * 0.9, lo[1] * 0.45, c[2] + r * 1.3), (c[0], lo[1] * 0.45, c[2]), lens=40)
        else:
            s = hi - lo
            camera(sc, (c[0] + s[0] * 1.4, hi[1] * 1.6, c[2] + s[2] * 2.2), (c[0], hi[1] * 0.4, c[2]), lens=50)
    out = opt.get('--out', os.path.join(OUT, f'{view}_{lod}_{mode}.png'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sc.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('RENDERED', out)


main()
