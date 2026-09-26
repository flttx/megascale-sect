# Locate the most stretched edges of the skinned Kun at given clip frames (diagnostic only).
# blender -b kun_rig.blend -P diag_deform.py -- clip:frame [clip:frame ...]
import bpy, sys
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
obj = bpy.data.objects['Kun_body']; arm = bpy.data.objects['Kun']; me = obj.data
n = len(me.vertices)
R = np.empty(n * 3); me.vertices.foreach_get('co', R); R = R.reshape(-1, 3)
E = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', E); E = E.reshape(-1, 2)
rl = np.linalg.norm(R[E[:, 0]] - R[E[:, 1]], axis=1)
print('rest edge len median', np.median(rl), 'min', rl.min())
ymin, L = R[:, 1].min(), np.ptp(R[:, 1])
names = [g.name for g in obj.vertex_groups]
W = np.zeros((n, len(names)))
for v in me.vertices:
    for g in v.groups: W[v.index, g.group] = g.weight
for tr in arm.animation_data.nla_tracks: tr.mute = True
for spec in argv:
    clip, f = spec.split(':')
    arm.animation_data.action = bpy.data.actions[clip]
    bpy.context.scene.frame_set(int(f))
    dg = bpy.context.evaluated_depsgraph_get(); ev = obj.evaluated_get(dg); m = ev.to_mesh()
    Q = np.empty(n * 3); m.vertices.foreach_get('co', Q); Q = Q.reshape(-1, 3); ev.to_mesh_clear()
    ql = np.linalg.norm(Q[E[:, 0]] - Q[E[:, 1]], axis=1)
    r = ql / np.maximum(rl, 1e-9)
    # absolute error in metres is what shows visually
    ab = np.abs(ql - rl)
    print(f'== {spec}: |ratio-1|>0.2 edges {np.sum(np.abs(r - 1) > 0.2)}  abs change >0.5 m {np.sum(ab > 0.5)} max abs {ab.max():.2f} m')
    for k in np.argsort(-np.abs(np.log(r)))[:12]:
        a, b = E[k]; p = R[a]
        top = np.argsort(-W[a])[:3]
        print(f'  ratio {r[k]:.3f} rest {rl[k]:.3f} m  s={(p[1]-ymin)/L:.3f} x={p[0]:+.1f} z={p[2]:+.1f}  ' + ' '.join(f'{names[t]}:{W[a, t]:.2f}' for t in top))
    for k in np.argsort(-ab)[:6]:
        a, b = E[k]; p = R[a]; top = np.argsort(-W[a])[:3]
        print(f'  ABS {ab[k]:.2f} m ratio {r[k]:.3f} rest {rl[k]:.2f}  s={(p[1]-ymin)/L:.3f} x={p[0]:+.1f} z={p[2]:+.1f}  ' + ' '.join(f'{names[t]}:{W[a, t]:.2f}' for t in top))
