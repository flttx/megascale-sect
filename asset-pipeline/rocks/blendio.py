"""Blender mesh I/O helpers shared by build.py, export.py and render.py (glTF Y-up <-> Blender Z-up)."""
import json
import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')


def to_blender(V):
    V = np.asarray(V, np.float32).reshape(-1, 3)
    return np.stack([V[:, 0], -V[:, 2], V[:, 1]], 1)


def from_blender(B):
    return np.stack([B[:, 0], B[:, 2], -B[:, 1]], 1)


def make_object(name, V, T, collection=None):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set('co', to_blender(V).astype(np.float32).ravel())
    me.loops.add(T.size)
    me.loops.foreach_set('vertex_index', T.astype(np.int32).ravel())
    me.polygons.add(len(T))
    me.polygons.foreach_set('loop_start', np.arange(0, T.size, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def finish_object(ob, C, sharp_deg=40.0):
    """Point-domain linear float colour (exported as COLOR_0) and smooth shading split at sharp_deg."""
    me = ob.data
    attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    rgba = np.concatenate([C, np.ones((len(C), 1), np.float32)], 1).astype(np.float32)
    attr.data.foreach_set('color', rgba.ravel())
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    return ob


def load(name, lod):
    d = np.load(os.path.join(CACHE, f'{name}.npz'))
    with open(os.path.join(CACHE, f'{name}.json'), encoding='utf8') as f:
        meta = json.load(f)
    return d[f'{lod}_v'], d[f'{lod}_t'], d[f'{lod}_c'], d['offset'], meta


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
