"""Blender-authored reusable fractured rock modules; no external generation."""
import bpy, math, random, pathlib, json
ROOT = pathlib.Path(__file__).resolve().parents[1]
out = ROOT / 'public/assets/environment/t02r'
out.mkdir(parents=True, exist_ok=True)
# This script runs only in a fresh background Blender process.
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
collection = bpy.data.collections.new('T02R_RockModules')
bpy.context.scene.collection.children.link(collection)
stats = []
for variant in range(4):
    rng = random.Random(140 + variant)
    n = 9 + variant
    angles = [2 * math.pi * i / n + rng.uniform(-.11, .11) for i in range(n)]
    radii = [rng.uniform(.37, .57) for i in range(n)]
    vertices, faces = [], []
    profiles = [(0, .71), (.13, 1), (.42, .91), (.69, .85), (.88, .51)]
    for layer, (height, factor) in enumerate(profiles):
        shift_x = (.14 + variant * .025) * height
        shift_y = -.08 * height + .035 * math.sin(layer * 2 + variant)
        for i, angle in enumerate(angles):
            # Persistent fracture planes and biased layers form wedges/slabs.
            r = radii[i] * factor * (1 + rng.uniform(-.075, .075))
            vertices.append((math.cos(angle) * r + shift_x, math.sin(angle) * r * (1 - variant * .08) + shift_y, height + rng.uniform(-.045, .045)))
    faces.append(tuple(reversed(range(n))))
    for layer in range(len(profiles) - 1):
        for i in range(n):
            a = layer * n + i; b = layer * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.append(tuple((len(profiles) - 1) * n + i for i in range(n)))
    mesh = bpy.data.meshes.new(f'Fractured_Layered_{variant}')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    obj = bpy.data.objects.new(f'HeroRock_{variant}', mesh); collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj; obj.select_set(True)
    bevel = obj.modifiers.new('Weathered_Edges', 'BEVEL'); bevel.width = .016; bevel.segments = 2
    bevel.affect = 'EDGES'
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    for poly in obj.data.polygons: poly.use_smooth = False
    obj.select_set(False)
    obj['construction'] = 'Five irregular layered fracture rings, biased wedge, bevelled broken edges'
    obj.data.calc_loop_triangles()
    stats.append({'name': obj.name, 'triangles': len(obj.data.loop_triangles)})
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'environment-pipeline/rock-modules.blend'))
bpy.ops.export_scene.gltf(filepath=str(out / 'hero-rocks.glb'), export_format='GLB', export_materials='NONE')
(ROOT / 'environment-pipeline/rock-report.json').write_text(json.dumps(stats, indent=2))
print('T02R_ROCKS', stats)
