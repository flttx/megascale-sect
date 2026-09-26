"""EEVEE preview renders for a colossi GLB (Blender 5.x, headless).

blender -b --factory-startup -P render.py -- --in model.glb --out-prefix artifacts/.../name --kind statue|sword
Writes <prefix>_front.png, <prefix>_34.png, <prefix>_low.png (low angle with a 1.75 m red cylinder for scale).
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ap = argparse.ArgumentParser()
ap.add_argument("--in", dest="inp", required=True)
ap.add_argument("--out-prefix", required=True)
ap.add_argument("--kind", choices=["statue", "sword"], required=True)
ap.add_argument("--res", type=int, default=1400, help="long side in px")
ap.add_argument("--views", default="front,34,back,low,far")
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a.inp)
objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
size = hi - lo
H = size.z
center = (lo + hi) / 2
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
try:
    scene.eevee.use_shadows = True
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_raytracing = False
except AttributeError:
    pass

# sky gradient world
world = bpy.data.worlds.new("sky")
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes["Background"]
# vertical gradient: pale haze at the horizon -> soft blue overhead
coord = nt.nodes.new("ShaderNodeTexCoord")
sep = nt.nodes.new("ShaderNodeSeparateXYZ")
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].position = 0.0
ramp.color_ramp.elements[0].color = (0.78, 0.80, 0.82, 1)
ramp.color_ramp.elements[1].position = 0.6
ramp.color_ramp.elements[1].color = (0.36, 0.52, 0.74, 1)
nt.links.new(coord.outputs["Generated"], sep.inputs[0])
nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], bg.inputs[0])
bg.inputs[1].default_value = 0.9

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 4.0
sun_data.angle = math.radians(2)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
# light from front-left-above (front = -Y in Blender = glTF +Z)
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))

fill_data = bpy.data.lights.new("fill", "SUN")
fill_data.energy = 0.8
fill = bpy.data.objects.new("fill", fill_data)
scene.collection.objects.link(fill)
fill.rotation_euler = (math.radians(70), 0, math.radians(150))

# ground (only visible in the low shot) + 1.75 m scale figure
gmat = bpy.data.materials.new("ground")
gmat.use_nodes = True
gmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.33, 0.30, 1)
gmat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y, H) * 12, location=(0, 0, lo.z - 0.02))
ground = bpy.context.active_object
ground.data.materials.append(gmat)

hmat = bpy.data.materials.new("human")
hmat.use_nodes = True
hmat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.9, 0.05, 0.03, 1)
hmat.node_tree.nodes["Principled BSDF"].inputs["Emission Color"].default_value = (0.9, 0.05, 0.03, 1)
hmat.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.6
front_y = lo.y  # most -Y point = front face of the plinth
if a.kind == "statue":
    human_loc = Vector((size.x * 0.12, front_y - 3.0, lo.z + 0.875))
else:
    human_loc = Vector((6.0, -4.0, lo.z + 0.875))
bpy.ops.mesh.primitive_cylinder_add(radius=0.25, depth=1.75, location=human_loc, vertices=24)
human = bpy.context.active_object
human.data.materials.append(hmat)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def frame(direction, elev_deg, lens=85.0, margin=1.08):
    """Orbit camera; distance chosen so the full height (portrait long side) fits."""
    cam_data.lens = lens
    cam_data.sensor_fit = "AUTO"
    cam_data.sensor_width = 36
    vfov = 2 * math.atan(18 / lens)
    depth = max(size.x, size.y)
    dist = 0.5 * H * margin / math.tan(vfov / 2) + 0.5 * depth
    az = math.radians(direction)
    el = math.radians(elev_deg)
    offs = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * dist
    cam.location = center + offs
    cam_data.clip_start = 0.5
    cam_data.clip_end = dist * 10
    look_at(cam, center)


def eye_shot(lens, dist):
    """Camera at 1.7 m eye height, `dist` in front of the scale figure, pitched up so the figure stays at the bottom edge."""
    cam_data.lens = lens
    cam_data.sensor_fit = "AUTO"
    cam_data.sensor_width = 36
    vfov = 2 * math.atan(18 / lens)
    cam.location = Vector((human_loc.x + dist * 0.3, human_loc.y - dist, lo.z + 1.7))
    to_model = Vector((center.x - cam.location.x, center.y - cam.location.y, 0)).normalized()
    pitch = vfov / 2 - math.atan2(1.7, dist) - math.radians(2.5)
    target = cam.location + to_model * 100 + Vector((0, 0, 100 * math.tan(pitch)))
    cam_data.clip_start = 0.1
    cam_data.clip_end = H * 30
    look_at(cam, target)


long_side = a.res
if a.kind == "statue":
    scene.render.resolution_x, scene.render.resolution_y = int(long_side * 0.75), long_side
else:
    scene.render.resolution_x, scene.render.resolution_y = int(long_side * 0.5), long_side
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"

views = a.views.split(",")
for v in views:
    ground.hide_render = v != "low"
    human.hide_render = v != "low"
    if v == "front":
        frame(0, 3)
    elif v == "34":
        frame(40, 10)
    elif v == "back":
        frame(180, 6)
    elif v == "far":
        ground.hide_render = False
        human.hide_render = False
        eye_shot(35, H * (1.0 if a.kind == "statue" else 0.95))
    elif v == "low":
        ground.hide_render = False
        human.hide_render = False
        eye_shot(16, H * (0.28 if a.kind == "statue" else 0.07))
    scene.render.filepath = f"{a.out_prefix}_{v}.png"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", scene.render.filepath)
