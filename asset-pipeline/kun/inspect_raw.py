# Inspect a raw Tripo GLB: stats + quick orthographic renders (top/side/front) to decide orientation.
# blender -b --factory-startup -P inspect_raw.py -- <raw.glb> <out_prefix>
import bpy, bmesh, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
print('OBJECTS', [(o.name, o.type, tuple(round(v, 3) for v in o.location), tuple(round(v, 3) for v in o.rotation_euler), tuple(round(v, 3) for v in o.scale), o.parent.name if o.parent else None) for o in bpy.data.objects])
for o in meshes:
    me = o.data
    print('MESH', o.name, 'verts', len(me.vertices), 'faces', len(me.polygons), 'tris', sum(len(p.vertices) - 2 for p in me.polygons), 'uv', [u.name for u in me.uv_layers], 'mats', [m.name for m in me.materials])
for img in bpy.data.images:
    print('IMAGE', img.name, img.size[:], img.colorspace_settings.name)
for m in bpy.data.materials:
    if m.node_tree:
        print('MAT', m.name, [(n.type, n.name) for n in m.node_tree.nodes])

# world-space bbox
pts = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
print('BBOX min', tuple(round(v, 4) for v in mn), 'max', tuple(round(v, 4) for v in mx), 'size', tuple(round(v, 4) for v in (mx - mn)))

# loose parts
for o in meshes:
    bm = bmesh.new(); bm.from_mesh(o.data); bm.verts.ensure_lookup_table()
    seen = set(); parts = []
    for v in bm.verts:
        if v.index in seen: continue
        stack = [v]; seen.add(v.index); comp = []
        while stack:
            a = stack.pop(); comp.append(a.index)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen: seen.add(b.index); stack.append(b)
        parts.append(comp)
    parts.sort(key=len, reverse=True)
    print('PARTS', o.name, len(parts), 'sizes', [len(p) for p in parts[:12]])
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    print('NONMANIFOLD_EDGES', nm, 'boundary', sum(1 for e in bm.edges if e.is_boundary))
    bm.free()

# quick renders
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = scene.render.resolution_y = 768
scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.78, 0.82, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 3; sun.rotation_euler = (math.radians(40), math.radians(20), math.radians(30))
c = (mn + mx) / 2; size = max(mx - mn)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size * 1.15; cam.data.clip_end = size * 100
views = {'top': ((0, 0, 1), (0, 0, 0)), 'front_negY': ((0, -1, 0), (math.pi / 2, 0, 0)), 'side_posX': ((1, 0, 0), (math.pi / 2, 0, math.pi / 2))}
for name, (d, rot) in views.items():
    cam.location = c + Vector(d) * size * 3
    cam.rotation_euler = rot
    scene.render.filepath = f'{out}_{name}.png'
    bpy.ops.render.render(write_still=True)
print('DONE')
