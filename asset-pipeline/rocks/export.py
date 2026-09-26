"""Export cached rock meshes to raw (uncompressed) GLBs; optimize.mjs then writes the final meshopt files.

  blender -b --factory-startup -P export.py -- <pillars|islands|boulders> <lod0|lod1>

Output: asset-pipeline/rocks/out/<group>[.lod1].raw.glb
- one node per rock, node name == mesh name, no textures, one shared placeholder material 'rock'
- COLOR_0 = the linear float attribute 'Col' (R cavity/AO, G vegetation, B strata band)
- normals smooth, split at 40 degrees
- island debris are root-level sibling nodes, translated by their offset from the island origin
  (the island itself sits at the origin); extras carry parent/offset so the runtime need not infer them
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from blendio import CACHE, finish_object, load, make_object, reset_scene, to_blender  # noqa: E402

GROUPS = {
    'pillars': [f'pillar_{i}' for i in range(6)],
    'islands': [f'isle_{i}' for i in range(4)],
    'boulders': [f'boulder_{i}' for i in range(6)],
}


def placeholder_material():
    m = bpy.data.materials.new('rock')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (0.5, 0.48, 0.45, 1.0)
    bsdf.inputs['Roughness'].default_value = 0.92
    bsdf.inputs['Metallic'].default_value = 0.0
    return m


def base_shift(name):
    """Pillars: xz shift that puts the centre of the base footprint (y < 3 m, LOD0) on the origin."""
    V = load(name, 'lod0')[0]
    B = V[V[:, 1] < 3.0]
    return np.array([-(B[:, 0].min() + B[:, 0].max()) / 2, 0.0, -(B[:, 2].min() + B[:, 2].max()) / 2], np.float32)


def add(name, lod, mat, location=(0.0, 0.0, 0.0), shift=None):
    V, T, C, off, meta = load(name, lod)
    if shift is not None:
        V = V + shift
    ob = make_object(name, V, T)
    ob.data.name = name
    finish_object(ob, C)
    ob.data.materials.append(mat)
    ob.location = tuple(float(v) for v in to_blender(location)[0])
    return ob, meta


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    group, lod = argv[0], argv[1]
    reset_scene()
    mat = placeholder_material()
    for name in GROUPS[group]:
        shift = base_shift(name) if group == 'pillars' else None
        ob, meta = add(name, lod, mat, shift=shift)
        ob['rock_kind'] = meta['kind']
        if meta['kind'] == 'pillar':
            ledges = meta.get('ledges', [])[:16]
            ob['pine_points'] = [round(float(v), 2) for p in ledges
                                 for v in (p['x'] + shift[0], p['y'], p['z'] + shift[2])]
            ob['pine_areas_m2'] = [float(p['area_m2']) for p in ledges]
        if meta['kind'] == 'island':
            top = meta['top']
            for k in ('rim_radius_min', 'rim_radius_mean', 'rim_radius_max', 'top_y_min', 'top_y_max'):
                ob[k] = top[k]
            kids = sorted(f[:-5] for f in os.listdir(CACHE) if f.startswith(name + '_debris_') and f.endswith('.json'))
            ob['debris'] = kids
            for kname in kids:
                with open(os.path.join(CACHE, kname + '.json'), encoding='utf8') as f:
                    off = json.load(f)['offset']
                kob, _ = add(kname, lod, mat, off)
                kob['rock_kind'] = 'debris'
                kob['parent_island'] = name
                kob['offset'] = [float(v) for v in off]
    out_dir = os.path.join(HERE, 'out')
    os.makedirs(out_dir, exist_ok=True)
    suffix = '' if lod == 'lod0' else '.' + lod
    path = os.path.join(out_dir, f'{group}{suffix}.raw.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=False, export_yup=True,
                              export_apply=False, export_normals=True, export_tangents=False, export_texcoords=False,
                              export_materials='EXPORT', export_image_format='NONE', export_vertex_color='ACTIVE',
                              export_all_vertex_colors=False, export_attributes=False, export_extras=True,
                              export_animations=False, export_skins=False, export_morph=False, export_lights=False,
                              export_cameras=False)
    print('EXPORTED', path, os.path.getsize(path))


main()
