"""Create an inspectable Blender counterpart and a protected Graybox backup.
Geometry and instance transforms come from the actual browser runtime export.
Run with Blender --background --factory-startup --python this_file.
"""
import bpy, json, math, pathlib
from mathutils import Matrix, Vector, Euler
ROOT = pathlib.Path(__file__).resolve().parents[1]
data = json.loads((ROOT / 'environment-pipeline/runtime-environment.json').read_text())
C = Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
for o in list(bpy.data.objects): bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.render.engine = 'BLENDER_EEVEE'
scene.world.color = (.35,.4,.45)
def collection(name, parent=None):
    c = bpy.data.collections.new(name); (parent or scene.collection).children.link(c); return c
gray = collection('ENV_Graybox')
buildings = collection('Existing_Tripo_Buildings')
materials = {}
def material(name):
    name = name or 'T02R_paving'
    if name in materials: return materials[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    n, l = m.node_tree.nodes, m.node_tree.links
    bs = n.get('Principled BSDF'); bs.inputs['Roughness'].default_value = .88
    tex = n.new('ShaderNodeTexNoise'); tex.inputs['Scale'].default_value = .14; tex.inputs['Detail'].default_value = 3
    geom = n.new('ShaderNodeNewGeometry'); l.new(geom.outputs['Position'], tex.inputs['Vector'])
    colors = n.new('ShaderNodeValToRGB')
    colors.color_ramp.elements[0].color = (.085,.096,.102,1)
    colors.color_ramp.elements[1].color = (.24,.255,.22,1)
    l.new(tex.outputs['Fac'], colors.inputs['Fac'])
    l.new(colors.outputs['Color'], bs.inputs['Base Color'])
    rough = n.new('ShaderNodeMapRange'); rough.inputs['To Min'].default_value = .76; rough.inputs['To Max'].default_value = .98
    l.new(tex.outputs['Fac'], rough.inputs['Value']); l.new(rough.outputs['Result'], bs.inputs['Roughness'])
    detail = n.new('ShaderNodeTexNoise'); detail.inputs['Scale'].default_value = 2.5
    l.new(geom.outputs['Position'], detail.inputs['Vector'])
    bump = n.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .22; bump.inputs['Distance'].default_value = .08
    l.new(detail.outputs['Fac'], bump.inputs['Height']); l.new(bump.outputs['Normal'], bs.inputs['Normal'])
    if name == 'T02R_terrain':
        sep = n.new('ShaderNodeSeparateXYZ'); l.new(geom.outputs['Normal'], sep.inputs[0])
        slope = n.new('ShaderNodeMapRange'); slope.inputs['From Min'].default_value = .55; slope.inputs['From Max'].default_value = .91
        l.new(sep.outputs['Z'], slope.inputs['Value'])
        mix = n.new('ShaderNodeMixRGB'); mix.inputs[2].default_value = (.17,.19,.13,1)
        l.new(slope.outputs['Result'],mix.inputs[0]); l.new(colors.outputs['Color'],mix.inputs[1]); l.new(mix.outputs[0],bs.inputs['Base Color'])
    if 'paving' in name or 'masonry' in name:
        brick = n.new('ShaderNodeTexBrick'); brick.inputs['Scale'].default_value = .3; brick.inputs['Mortar Size'].default_value = .008
        l.new(geom.outputs['Position'],brick.inputs['Vector']); l.new(brick.outputs['Color'],bs.inputs['Base Color'])
    materials[name] = m; return m
def make_mesh(entry, coll):
    p = entry['position']; vertices = [(p[i],-p[i+2],p[i+1]) for i in range(0,len(p),3)]
    idx = entry['index'] or list(range(len(vertices)))
    faces = [tuple(idx[i:i+3]) for i in range(0,len(idx),3)]
    mesh = bpy.data.meshes.new(entry['name']); mesh.from_pydata(vertices, [], faces); mesh.update()
    mesh.materials.append(material(entry['material']))
    for f in mesh.polygons: f.use_smooth = 'Terrain' in entry['name'] or 'Mountain' in entry['name']
    objects = []
    for i, raw in enumerate(entry['matrices']):
        web = Matrix([raw[j::4] for j in range(4)])
        obj = bpy.data.objects.new(entry['name'] + (f'_{i:03}' if len(entry['matrices'])>1 else ''), mesh)
        coll.objects.link(obj); obj.matrix_world = C @ web @ C.inverted(); objects.append(obj)
    return objects
for entry in data['meshes']:
    if entry['collection'] == 'ENV_Graybox': make_mesh(entry, gray)

def import_asset(filename, label, placements, height):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/assets/models' / filename))
    imported = list(set(bpy.data.objects)-before)
    bpy.context.view_layer.update()
    points = [o.matrix_world @ Vector(v) for o in imported if o.type == 'MESH' for v in o.bound_box]
    minimum = Vector(tuple(min(p[i] for p in points) for i in range(3)))
    maximum = Vector(tuple(max(p[i] for p in points) for i in range(3)))
    center = (minimum+maximum)*.5
    roots = [o for o in imported if o.parent not in imported]
    for o in imported:
        for old in list(o.users_collection): old.objects.unlink(o)
        buildings.objects.link(o)
    normalizer = bpy.data.objects.new(label+'_Normalize', None); buildings.objects.link(normalizer)
    normalizer.location = (-center.x,-center.y,-minimum.z)
    for o in roots: o.parent = normalizer
    scale = height/(maximum.z-minimum.z)
    template = [normalizer] + imported
    for index, placement in enumerate(placements):
        if index == 0: local = template
        else:
            mapping = {}
            for original in template:
                copy = original.copy(); buildings.objects.link(copy); mapping[original] = copy
            for original, copy in mapping.items(): copy.parent = mapping.get(original.parent)
            local = [mapping[original] for original in template]
        root = bpy.data.objects.new(f'{label}_{index}', None); buildings.objects.link(root)
        local[0].parent = root
        x,y,z = placement['position']; root.location = (x,-z,y)
        root.rotation_euler.z = placement['rotation'][1]
        root.scale = (scale*placement.get('scaleMultiplier',1),)*3
        root['source'] = filename; root['source_unchanged'] = True
layout = data['layout']
import_asset('主建筑.glb','MG01',[layout['main']],420)
import_asset('山门.glb','MG02',[layout['gate']],56)
import_asset('侧塔.glb','MG04',layout['towers'],120)
scene['backup_note'] = 'No pre-existing .blend existed. Exact Web Graybox reconstructed with original, unmodified GLBs before adding ENV_T02R.'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / 'artifacts/t02r/backup/environment-graybox.blend'))

env = collection('ENV_T02R')
children = {name:collection(name,env) for name in ['Terrain','Terraces','Roads','Cliffs','HeroRocks','Scatter','Materials','Debug','FarMountains']}
for entry in data['meshes']:
    if entry['collection'] != 'ENV_T02R': continue
    name = entry['name']
    dest = 'Terrain' if 'Terrain' in name else 'FarMountains' if 'Mountain_Layer' in name else 'Roads' if 'Road' in name or 'Shoulder' in name or not entry['material'] else 'Terraces'
    make_mesh(entry,children[dest])
gray.hide_render = True; gray.hide_viewport = True

# Four shared Blender meshes, instanced by a node graph with editable masks.
with bpy.data.libraries.load(str(ROOT / 'environment-pipeline/rock-modules.blend'), link=False) as (src,dst):
    dst.objects = [name for name in src.objects if name.startswith('HeroRock_')]
modules = collection('Rock_Module_Library')
for obj in dst.objects:
    modules.objects.link(obj); obj.data.materials.clear(); obj.data.materials.append(material('T02R_rock'))
# Library objects need not be linked into the rendered scene for Collection Info.
scene.collection.children.unlink(modules)
points = bpy.data.meshes.new('Scatter_Points_BakedMasks')
points.from_pydata([(r['position'][0],-r['position'][2],r['position'][1]) for r in data['scatter']],[],[])
scatter = bpy.data.objects.new('Rock_Scatter_GeometryNodes',points); children['Scatter'].objects.link(scatter)
def attr(name, typ, values):
    a = points.attributes.new(name,typ,'POINT')
    for item,value in zip(a.data,values):
        if typ == 'FLOAT_VECTOR': item.vector = value
        else: item.value = value
for name,key in [('slope','slope'),('road_distance','roadDistance'),('building_distance','buildingDistance')]: attr(name,'FLOAT',[r[key] for r in data['scatter']])
attr('height','FLOAT',[r['position'][1] for r in data['scatter']])
attr('variant','INT',[r['variant'] for r in data['scatter']])
attr('rock_scale','FLOAT_VECTOR',[(r['scale'][0],r['scale'][2],r['scale'][1]) for r in data['scatter']])
rotations=[]
for r in data['scatter']:
    # Three.js XYZ intrinsic Euler corresponds to Blender reversed matrix order.
    x,y,z=r['rotation']; web = Matrix.Rotation(x,4,'X') @ Matrix.Rotation(y,4,'Y') @ Matrix.Rotation(z,4,'Z')
    rotations.append((C @ web @ C.inverted()).to_euler())
attr('rock_rotation','FLOAT_VECTOR',rotations)
nodes = bpy.data.node_groups.new('T02R_Slope_Height_Road_Building_Scatter','GeometryNodeTree')
nodes.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry')
nodes.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
n,l=nodes.nodes,nodes.links
inp=n.new('NodeGroupInput'); out=n.new('NodeGroupOutput')
library=n.new('GeometryNodeCollectionInfo'); library.inputs['Collection'].default_value=modules
library.inputs['Separate Children'].default_value=True; library.inputs['Reset Children'].default_value=True
instance=n.new('GeometryNodeInstanceOnPoints'); instance.inputs['Pick Instance'].default_value=True
l.new(inp.outputs['Geometry'],instance.inputs['Points']); l.new(library.outputs['Instances'],instance.inputs['Instance'])
def named(name,typ='FLOAT'):
    node=n.new('GeometryNodeInputNamedAttribute'); node.data_type=typ; node.inputs['Name'].default_value=name; node.label=name; return node.outputs['Attribute']
for name,socket,typ in [('variant','Instance Index','INT'),('rock_scale','Scale','FLOAT_VECTOR'),('rock_rotation','Rotation','FLOAT_VECTOR')]: l.new(named(name,typ),instance.inputs[socket])
selection=None
for name,operation,threshold in [('road_distance','GREATER_THAN',10),('building_distance','GREATER_THAN',0),('height','GREATER_THAN',-230),('slope','LESS_THAN',88)]:
    cmp=n.new('ShaderNodeMath'); cmp.operation=operation; cmp.inputs[1].default_value=threshold
    l.new(named(name),cmp.inputs[0])
    if selection is None: selection=cmp.outputs[0]
    else:
        both=n.new('FunctionNodeBooleanMath'); both.operation='AND'; l.new(selection,both.inputs[0]); l.new(cmp.outputs[0],both.inputs[1]); selection=both.outputs[0]
l.new(selection,instance.inputs['Selection']); l.new(instance.outputs['Instances'],out.inputs['Geometry'])
modifier=scatter.modifiers.new('T02R Editable Scatter','NODES'); modifier.node_group=nodes
scatter['distribution'] = 'Seeded clustered candidates; slope + height + macro noise + road/building exclusion. Per-point rotations/scales preserved from runtime.'

# Curve-to-Mesh authoring graph; the visible runtime road is its triangulated equivalent.
curve=bpy.data.curves.new('MainRoad_Curve','CURVE'); curve.dimensions='3D'; spline=curve.splines.new('POLY'); spline.points.add(len(data['road'])-1)
for point,p in zip(spline.points,data['road']):
    point.co=(p[0],-p[2],.025,1); point.radius=(18.2+.8*math.sin((p[2]-20)/142*math.pi*2))/2
road=bpy.data.objects.new('Road_Curve_Authoring',curve); children['Roads'].objects.link(road)
gn=bpy.data.node_groups.new('T02R_Road_Curve_To_Mesh','GeometryNodeTree')
gn.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry'); gn.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
n,l=gn.nodes,gn.links; i=n.new('NodeGroupInput'); o=n.new('NodeGroupOutput'); profile=n.new('GeometryNodeCurvePrimitiveLine')
profile.inputs['Start'].default_value=(-1,0,0); profile.inputs['End'].default_value=(1,0,0)
mesh=n.new('GeometryNodeCurveToMesh'); l.new(i.outputs['Geometry'],mesh.inputs['Curve']); l.new(profile.outputs['Curve'],mesh.inputs['Profile Curve']); l.new(mesh.outputs['Mesh'],o.inputs['Geometry'])
road.modifiers.new('Road Surface from Curve','NODES').node_group=gn
road.hide_render=True; road.hide_set(True); road['note']='Authoring source. Curve_MainRoad is the visible baked runtime equivalent.'

review=json.loads((ROOT/'artifacts/t02r/review-report.json').read_text())
for v in review['views']:
    cam=bpy.data.cameras.new(v['name']); obj=bpy.data.objects.new('VIEW_'+v['name'],cam); children['Debug'].objects.link(obj)
    obj.location=C@Vector(v['eye']); target=C@Vector(v['look']); obj.rotation_euler=(target-obj.location).to_track_quat('-Z','Y').to_euler(); cam.lens=25
    if v['name'].startswith('E'): scene.camera=obj
sun=bpy.data.lights.new('Environment_Key','SUN'); sun.energy=2.25; sun.angle=math.radians(12)
light=bpy.data.objects.new('Environment_Key',sun); scene.collection.objects.link(light); light.rotation_euler=(.4,-.5,-.6)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get()
evaluated=scatter.evaluated_get(deps)
# Check nodes can be realized/baked without destroying the editable graph.
bake=bpy.data.node_groups.new('T02R_Bake_Instances','GeometryNodeTree')
bake.interface.new_socket(name='Geometry',in_out='INPUT',socket_type='NodeSocketGeometry'); bake.interface.new_socket(name='Geometry',in_out='OUTPUT',socket_type='NodeSocketGeometry')
bi=bake.nodes.new('NodeGroupInput'); bo=bake.nodes.new('NodeGroupOutput'); realize=bake.nodes.new('GeometryNodeRealizeInstances')
bake.links.new(bi.outputs['Geometry'],realize.inputs[0]); bake.links.new(realize.outputs[0],bo.inputs[0])
bmod=scatter.modifiers.new('Bake validation temporary','NODES'); bmod.node_group=bake
bpy.context.view_layer.update(); deps=bpy.context.evaluated_depsgraph_get(); baked=bpy.data.meshes.new_from_object(scatter.evaluated_get(deps),depsgraph=deps)
baked.calc_loop_triangles(); bake_triangles=len(baked.loop_triangles); bpy.data.meshes.remove(baked); scatter.modifiers.remove(bmod)
scene['T02R'] = 'Continuous terrain, artificial terraces, curved road carving, fractured hero rocks, slope-based materials, instanced scatter.'
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'environment-pipeline/T02R-environment.blend'))
(ROOT/'environment-pipeline/blender-report.json').write_text(json.dumps({'collections':list(children),'scatter_candidates':len(data['scatter']),'bake_triangles':bake_triangles,'original_glbs_modified':False,'blender':bpy.app.version_string},indent=2))
print('T02R_BLEND_SAVED',bake_triangles)
