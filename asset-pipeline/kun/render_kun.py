# EEVEE previews of an exported Kun GLB (skinned + clips), rendered through the glTF importer so they show the
# final textures/rig exactly as shipped (use the meshopt-free twin written by optimize_kun.mjs).
# blender -b --factory-startup -P render_kun.py -- <kun.glb> <preview_dir> <set: lod0|lod1>
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
SET = argv[2] if len(argv) > 2 else 'lod0'
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30  # importer converts glTF seconds → frames with the scene fps
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
body = next(o for o in scene.objects if o.type == 'MESH')
acts = {a.name: a for a in bpy.data.actions}
print('[render] actions', list(acts), 'bones', len(arm.data.bones), 'tris', sum(len(p.vertices) - 2 for p in body.data.polygons))
if arm.animation_data:
    for tr in arm.animation_data.nla_tracks:
        tr.mute = True
else:
    arm.animation_data_create()


def find_action(name):
    return next(a for n, a in acts.items() if n == name or n.startswith(name))


def play(name, frame):
    ad = arm.animation_data
    if name is None:  # bind pose
        ad.action = None
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = (1, 0, 0, 0)
            pb.location = (0, 0, 0)
            pb.scale = (1, 1, 1)
        scene.frame_set(frame)
        return
    act = find_action(name)
    ad.action = act
    if getattr(ad, 'action_slot', None) is None and len(getattr(act, 'slots', [])):
        ad.action_slot = act.slots[0]
    scene.frame_set(frame)


scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.view_settings.view_transform = 'Standard'
# light sky gradient (screen-space vertical ramp)
world = bpy.data.worlds.new('sky')
scene.world = world
world.use_nodes = True
nt = world.node_tree
bg = nt.nodes['Background']
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].position = 0.35
ramp.color_ramp.elements[0].color = (0.80, 0.83, 0.86, 1)
ramp.color_ramp.elements[1].position = 0.75
ramp.color_ramp.elements[1].color = (0.36, 0.50, 0.70, 1)
nt.links.new(tc.outputs['Window'], sep.inputs[0])
nt.links.new(sep.outputs['Y'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.0
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
scene.collection.objects.link(sun)
sun.data.energy = 4.0
sun.data.angle = math.radians(3)
sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
fill = bpy.data.objects.new('fill', bpy.data.lights.new('fill', 'SUN'))
scene.collection.objects.link(fill)
fill.data.energy = 0.8
fill.rotation_euler = (math.radians(-120), 0, math.radians(140))
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
cam.data.lens = 50
cam.data.clip_start = 1
cam.data.clip_end = 20000


def shot(name, clip, frame, loc, target=(0, 0, 0), lens=50):
    play(clip, frame)
    cam.data.lens = lens
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)
    print('[render] wrote', name)


# Blender space after import: head -Y, up +Z, whale's left side +X
if SET == 'lod0':
    shot('kun_side.png', None, 0, (520, 20, 0), (0, 20, -12))  # bind pose
    shot('kun_three_quarter_below.png', 'swim', 0, (260, -300, -170), (0, 5, 0))
    shot('kun_glide_three_quarter_above.png', 'breach_glide', 0, (230, -260, 200), (0, 10, 0))
    for f in (0, 60, 120):  # swim period is 6 s (180 frames): three evenly spaced phases
        shot(f'kun_swim_f{f:03d}.png', 'swim', f, (520, 20, 0), (0, 20, -12))
    shot('kun_closeup_head.png', 'swim', 0, (95, -170, 45), (0, -60, 0), lens=60)
else:
    shot('kun_lod1_side.png', 'swim', 60, (520, 20, 0), (0, 20, -12))
    shot('kun_lod1_three_quarter_below.png', 'swim', 0, (260, -300, -170), (0, 5, 0))
print('[render] DONE')
