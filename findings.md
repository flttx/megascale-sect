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
- **巨物** `public/assets/colossi/`：guardian_a（护山神将，150 m，+Z 朝前，基座底 y=0）、guardian_b（护山仙女，150 m）、giant_sword（420 m，剑尖在原点、剑身沿 +Y）；各有 .lod1.glb。meshopt + quantization + webp，需 MeshoptDecoder。AO 通道无效未绑定。巨剑近看贴图糊（2048 上限）；guardian_a.lod1 底部抬高 0.18 m。原始 GLB 约 220 MB 在 `asset-pipeline/colossi/*/raw/`，**提交前需加 .gitignore**。
- **松树** `public/assets/vegetation/`：pine_0（7 m 崖边斜松）、pine_1（13 m 迎客松，长臂朝 +X）、pine_2（22 m 伞冠）；LOD1 2400 面。材质 bark（不透明）+ needles（MASK 0.5，双面）。COLOR_0：R=AO（需着色器自行乘）、G=高度比、B=叶团风摆相位。真实米制，接入时 scale≈1，替换 propCatalog 的 pine_* 映射。
