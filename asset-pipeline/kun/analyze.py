# Print slice profile of the whale along Y (Blender coords, head at -Y): centre x/z, core height, lateral extent.
import bpy, sys
import numpy as np
a = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=a[0])
o = [o for o in bpy.data.objects if o.type == 'MESH'][0]
n = len(o.data.vertices)
P = np.empty(n * 3); o.data.vertices.foreach_get('co', P); P = P.reshape(-1, 3)
ymin, ymax = P[:, 1].min(), P[:, 1].max()
print('Y range', ymin, ymax, 'X', P[:, 0].min(), P[:, 0].max(), 'Z', P[:, 2].min(), P[:, 2].max())
N = 40
for i in range(N):
    y0 = ymin + (ymax - ymin) * i / N; y1 = ymin + (ymax - ymin) * (i + 1) / N
    S = P[(P[:, 1] >= y0) & (P[:, 1] < y1)]
    if len(S) == 0: print(i, 'empty'); continue
    core = S[np.abs(S[:, 0] - np.median(S[:, 0])) < 0.05]
    zc = (core[:, 2].min() + core[:, 2].max()) / 2 if len(core) else float('nan')
    h = (core[:, 2].max() - core[:, 2].min()) if len(core) else 0
    print(f'{i:2d} s={i / N:.3f} n={len(S):5d} xmed={np.median(S[:, 0]):+.4f} x[{S[:, 0].min():+.3f},{S[:, 0].max():+.3f}] z[{S[:, 2].min():+.3f},{S[:, 2].max():+.3f}] core_zc={zc:+.4f} core_h={h:.4f}')
