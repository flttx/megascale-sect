# Blender 5.x headless preview renderer.
# blender -b --factory-startup -P render.py -- <preview.glb> <outdir> <prefix> <nframes> [clip,clip,...] [--view side|front] [--follow]
# Imports the character GLB with embedded clips, renders N evenly spaced frames per action from an
# orthographic side camera and stitches them into <outdir>/<prefix><clip>.png.
import bpy, sys, os, math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb, outdir, prefix, nframes = argv[0], argv[1], argv[2], int(argv[3])
rest = argv[4:]
view = 'side'
follow = '--follow' in rest
if '--view' in rest: view = rest[rest.index('--view') + 1]
rng = None
if '--range' in rest:
    a, b = rest[rest.index('--range') + 1].split(':'); rng = (float(a), float(b))
skip = set()
for k in ('--view', '--range'):
    if k in rest: skip.add(rest.index(k) + 1)
names = [a for i, a in enumerate(rest) if not a.startswith('--') and i not in skip]
only = set(names[0].split(',')) if names else None
os.makedirs(outdir, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
mesh = next(o for o in scene.objects if o.type == 'MESH')
ad = arm.animation_data
for tr in list(ad.nla_tracks):
    ad.nla_tracks.remove(tr)

# Render setup
engine = 'BLENDER_EEVEE'
try:
    scene.render.engine = engine
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
PW, PH = 420, 620
scene.render.resolution_x, scene.render.resolution_y = PW, PH
scene.render.film_transparent = False
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('W'); scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.62, 0.66, 0.72, 1); bg.inputs[1].default_value = 0.9
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN')); scene.collection.objects.link(sun)
sun.data.energy = 3.0; sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))

# Ground plane with checker grid (0.1 unit squares) to judge sliding / penetration
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.active_object
mat = bpy.data.materials.new('Ground'); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
chk = nt.nodes.new('ShaderNodeTexChecker'); chk.inputs['Scale'].default_value = 100
chk.inputs['Color1'].default_value = (0.35, 0.35, 0.33, 1); chk.inputs['Color2'].default_value = (0.5, 0.5, 0.47, 1)
nt.links.new(chk.outputs['Color'], bsdf.inputs['Base Color'])
ground.data.materials.append(mat)

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam')); scene.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 1.45
scene.camera = cam

def hips_world():
    pb = arm.pose.bones.get('mixamorig:Hips')
    return arm.matrix_world @ pb.head

def place_camera():
    h = hips_world() if follow else Vector((0.07, 0, 0.5))
    cx = h.x if follow else 0.07
    cy = h.y if follow else 0.0
    if view == 'side':
        cam.location = (cx + 0.15, cy - 6, 0.52 + 6 * math.tan(math.radians(10))); cam.rotation_euler = (math.radians(80), 0, 0)
    elif view == 'front':
        cam.location = (cx + 6, cy, 0.52 + 6 * math.tan(math.radians(10))); cam.rotation_euler = (math.radians(80), 0, math.radians(90))
    elif view == 'back':
        cam.location = (cx - 6, cy, 0.52); cam.rotation_euler = (math.radians(90), 0, math.radians(-90))

def slot_for(act):
    for s in getattr(act, 'slots', []):
        if s.target_id_type == 'OBJECT':
            return s
    return None

actions = sorted(bpy.data.actions, key=lambda a: a.name)
report = []
tmp = os.path.join(outdir, '_tmp.png')
for act in actions:
    clip = act.name.split('_Armature')[0]
    if only and clip not in only:
        continue
    ad.action = act
    s = slot_for(act)
    if s is not None:
        ad.action_slot = s
    f0, f1 = act.frame_range
    if rng: f0, f1 = rng
    frames = [f0 + (f1 - f0) * i / max(1, nframes - 1) for i in range(nframes)] if nframes > 1 else [f0]
    if nframes == 4:
        frames = [f0 + (f1 - f0) * i / 4 for i in range(4)] if act.use_cyclic or True else frames
    panels = []
    for f in frames:
        scene.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
        place_camera()
        scene.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(PH, PW, 4)
        bpy.data.images.remove(img)
        panels.append(px)
    strip = np.concatenate(panels, axis=1)
    out = bpy.data.images.new('strip', width=strip.shape[1], height=PH, alpha=True)
    out.pixels = strip.ravel()
    out.filepath_raw = os.path.join(outdir, f'{prefix}{clip}.png'); out.file_format = 'PNG'
    out.save()
    bpy.data.images.remove(out)
    report.append(f'{clip}: frames {f0:.1f}-{f1:.1f} rendered {[round(x, 1) for x in frames]}')
if os.path.exists(tmp):
    os.remove(tmp)
print('RENDER_REPORT'); print('\n'.join(report))
