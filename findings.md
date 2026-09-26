# 发现记录 · 云阙仙宗重建（2026-09-26）

## 现状审查（从玩家视角实玩截图，artifacts/audit/）

### 画面
- **地形**：两侧山体是平滑灰色大团，贴图拉伸模糊，像没做完的灰盒；没有岩层、崖面、碎石的层次。
- **主平台**：380×450 m 的平面灰色瓷砖，网格过于规整（像 CAD 渲染），空旷、无高差、无磨损与色彩变化。
- **光照**：整体灰白、低对比，像阴天；太阳方向感弱，建筑几乎看不到明暗面；远景雾是均匀的灰白，没有空气透视（远处偏蓝、逆光偏暖）。
- **喀斯特石柱**：挤出的圆柱，顶平、侧面无细节，34 根形状雷同。
- **浮岛**：倒锥体，形体简陋。
- **松树**：Tripo 松树的树冠是实心的绿色平盘，近看像盆景塑料片；出生点周围过密遮挡视线。
- **云海**：多层半透明平面，飞到高空时看起来是雾面而不是体积云。
- **尺度感**：420 m 主殿贴图在该尺度下分辨率不足，周围缺少人尺度参照；整体缺少让人感到“巨大”的元素。

### 操控
- 步行 3.2 m/s、奔跑 7 m/s，在千米级世界里过慢。
- 没有跳跃。
- **只能走在解析路面（道路 / 台阶 / 平台 / 登记的浮岛）上**，地形山坡不可行走，到处是看不见的墙。
- 相机固定在背后 4.8 m，看向角色前方 3 m 处，构图偏低；没有碰撞检测（只处理主殿盒体和地面）。
- 飞行巡航 30 / 加速 70 m/s，速度感弱（仅 FOV +8°）。

### 保留价值高的部分
- UI（HUD、卷轴、设置、拍照、存档）、交互点系统、天象状态机、音频合成、角色骨骼与御剑状态机、Tripo 管线、验证脚本框架。
- CSM 阴影、后处理管线（N8AO、GodRays、Bloom）结构合理，问题主要在参数和缺少的内容。

## 技术环境
- Windows（MSYS bash），Node 22，Chrome 在 `C:/Program Files/Google/Chrome/Application/chrome.exe`。
- Blender 5.2.1 LTS：bash 路径 `/d/Program Files/Blender Foundation/Blender 5.2/blender.exe`。
- 网络可访问 Poly Haven API（CC0 贴图）与 ambientCG。
- GPU：RTX 5060 Ti；当前极致档 250–360 FPS，性能余量充足。
- Tripo v3 API，密钥在 Windows 用户环境变量，`scripts/tripo/client.mjs` 已处理。
- 角色骨骼：Tripo 人形 rig v1，spec=mixamo，23 个骨骼；Tripo 动作迁移曾失败（骨架识别）。

## 资产交付（后台 agent，2026-09-26）
- **巨物** `public/assets/colossi/`：guardian_a（护山神将，150 m，+Z 朝前，基座底 y=0）、guardian_b（护山仙女，150 m）、giant_sword（420 m，剑尖在原点、剑身沿 +Y）；各有 .lod1.glb。meshopt + quantization + webp，需 MeshoptDecoder。AO 通道无效未绑定。巨剑近看贴图糊（2048 上限）；guardian_a.lod1 底部抬高 0.18 m。原始 GLB 约 220 MB 在 `asset-pipeline/colossi/*/raw/`，已加入 .gitignore。
- **鲲** `public/assets/colossi/kun.glb` / `kun.lod1.glb`：头朝 +Z，约 247 × 89 × 260 m；片段 `swim`（12 s）、`breach_glide`（8 s），飞行路径由游戏代码驱动；需 MeshoptDecoder。
- **石柱 / 浮岛 / 巨石** `public/assets/environment/rocks/`：pillar_0..5（212–414 m，原点在底面中心）、isle_0..3（顶面直径 45–125 m，原点在顶面中心，下垂 63–146 m）与 16 块碎石（场景根下的兄弟节点，按 `extras.parent_island/offset` 跟随）、boulder_0..5（2.4–11.7 m，底面埋入 0.1–0.5 m）。COLOR_0 线性：R=AO/凹陷、G=植被权重、B=岩层条带。量化把缩放写进节点矩阵，接入时要用 matrixWorld 或烘焙进几何体。石柱 `extras.pine_points` 给出松树点位（pillar_1 / pillar_5 偏少，需按 G 补种）。可站立顶面取 0.9 × 最小边缘半径。
- **角色动作** `public/assets/characters/{male,female}/anim.glb`：idle / walk 1.5 m/s / run 5.6 m/s / sprint 6.9（男）、6.5（女）m/s / jump / fall / land / stand_on_sword，原地动作，timeScale = 目标速度 ÷ 片段速度（冲刺 9.5 m/s 需男 1.38、女 1.46）。轨道名 `mixamorigHips.quaternion`，与 rig.optimized.glb 完全匹配。stand_on_sword 为侧身双手张开，与现有 ridingPose 不同。女角色网格有一根带子在跑动时拉丝（蒙皮权重问题）。
- **松树** `public/assets/vegetation/`：pine_0（7 m 崖边斜松）、pine_1（13 m 迎客松，长臂朝 +X）、pine_2（22 m 伞冠）；LOD1 2400 面。材质 bark（不透明）+ needles（MASK 0.5，双面）。COLOR_0：R=AO（需着色器自行乘）、G=高度比、B=叶团风摆相位。真实米制，接入时 scale≈1，替换 propCatalog 的 pine_* 映射。

## 贴图（asset-pipeline/textures → public/assets/textures）
- 7 套 CC0 扫描贴图：cliff（marble_cliff_05，16 m）、rock_detail（2 m）、moss（12 m）、grass（2.2 m）、gravel（2.4 m）、paving（3 m）、marble；另有 roof_tiles 暂未使用。
- 每套有 2k 与 `.1k` 两档；运行时只加载 1k（worker 解码后打包成两张 DataArrayTexture：albedo+roughness、normal+AO+height）。2k 留给以后可能的更高画质档。
- DataArrayTexture 不翻转 Y，OpenGL 法线的绿通道在着色器里取反；三平面采样用 UDN 法线混合和预先算好的 textureGrad 导数，避免分支里的 mip 错误。

## 地形设计与调参（R2）
- 范围 x −1080..1080、z −1220..650；三档网格（12 / 6 / 3 m），在道路、平台、台阶边界插入精确的网格线，共 35 万三角面，主线程构建约 0.45–0.49 s，不需要 worker。
- 约束：平台 23.78 ± 0.03 m（x ±189，z −514..−66），道路 −0.2 ± 0.01 m。
- 崖面：在到崖缘的距离上叠 ridged 凹槽和噪声，避免崖壁像光滑圆柱；山峰加角向 ridged 瓣和五级台阶轮廓。
- 岩石着色：扫描贴图直接用会发白发平，改为 pow 1.35 × 0.75 压暗，加雨痕、黑色藻痕、铁锈斑和冷暖岩层。
- 远景：4 层远山脊（z −1100..−3200）+ 3 圈地平线山环（半径 3000 / 3900 / 4800 m，以 (0, −290) 为圆心，带缺口）。相机 far 提到 8000，大气特效把视深 > ~7.27 km 当作天空。
- 行走：自然地面高于 −60 m 才可站立；塔基旋转矩形（+0.6 m 余量）不可走。探针 1.2 m：上坡 ≤ 45°、下坡 ≤ 55°，受阻时先试 x 再试 z 方向滑移；自然地面 > 52° 时沿坡面下滑 6 m/s，行走时不会主动踏上这种坡。石碑基座判断保持原意：只有道路或石板上的石碑不加基座。
- 仍待处理：正午空气透视太浓（R6 调雾）；黄昏地平线可能有一条横带；RockField 仍是圆柱（接入 rocks 资产）；后方台地是一片平的草绿色（R4 植被）。
