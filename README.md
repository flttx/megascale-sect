# 云阙仙宗 · Web 3D MVP

在现有建筑和男女角色 GLB 上搭建的可步行、可御剑飞行巨构场景。原始 GLB 保留在项目根目录；建筑读取 `public/assets/models/`，角色读取 `public/assets/characters/` 的 Tripo 骨骼衍生资产及原佩剑副本。

```bash
npm install
npm run dev
npm run build
```

打开开发服务器显示的地址，选择角色，载入完成后点击“进入仙宗”锁定鼠标。

| 操作 | 按键 |
| --- | --- |
| 移动 / 转向 | W A S D / 鼠标 |
| 奔跑 / 飞行加速 | Shift |
| 御剑主动刹停（优先于加速 / 移动输入） | X |
| 男主角一 / 女主角二（同步更换佩剑） | 1 / 2，也可点击角色按钮 |
| 召剑 → 跃起踏剑 → 御剑 | F |
| 自动下降 → 收剑落地（道路或平台上方） | 飞行时 F；降落中再按 F 取消 |
| 飞行升降 | Space / Ctrl 或 C |
| 环视角色，保持飞行方向 | 按住 Alt + 鼠标，松开回正 |
| 暂停 / 恢复 | Esc 释放鼠标 / 点击继续 |
| 数据 / 碰撞辅助 | F3 / G |
| 音效开关 | M 或右侧音效按钮 |

男女角色均有骨骼呼吸、步行、奔跑、施法、屈膝起跳和飞行平衡动作。步频跟随实际位移，支撑脚使用两节腿骨 IK 约束落点；起跳增加蓄力，踏剑与落地有缓冲。步行 3.2 m/s、奔跑 7 m/s，御剑巡航 / 加速仍为 30 / 70 m/s。

御剑采用左脚在前、右脚在后的站姿，双手收于后腰；踏剑时平滑进入姿态，升降与倾斜时脚部跟随剑面。两把佩剑分别校准剑面朝向与位置。`npm run verify:riding-pose` 检查两角色的姿态和脚底接触，并保存正面、侧面、背面截图到 `artifacts/riding-pose/`。

召剑包含聚光、旋转法阵、粒子与飞剑飞入，踏剑有扩散光环，飞行剑气保留空间轨迹。风声随速度变化，召剑、起跳、踏剑和收剑均有本地合成音效；点击进入后启用，M 可静音，暂停时自动淡出。相机随速度缓慢扩大视野，支持阻挡检查和独立环视。

默认使用 `.optimized.glb` 副本：角色与佩剑共 **9.18 MB**，相较原 184.81 MB 减少 **95%**。两角色在载入阶段预加载、预上传贴图并保留实例，换人无需再次下载。原文件与骨骼产物仍保留。优化实现、实测与限制见 [OPTIMIZATION.md](OPTIMIZATION.md)。

Tripo 已返回两套可用的人形骨骼，预设动作迁移接口失败，当前动作由本地骨骼程序驱动。具体任务、费用与限制见 [CHARACTER_PIPELINE.md](CHARACTER_PIPELINE.md)。

主场景参数集中在 `src/world/worldLayout.ts`，模型文件与目标高度集中在 `src/world/worldAssets.ts`。资产尺寸、实际布置和已知限制见 `PROGRESS.md`。

浏览器验证：`npm run verify:characters`（角色与御剑完整流程）、`npm run verify:optimization`（加载体积、脚部约束、换人、刹停、镜头、音频输出与静音）、`npm run verify:navigation`（山门 / 台阶 / 绕殿）。脚本使用本机 Chrome；开发服务器若不是 5173 端口，可设置 `BASE_URL` 环境变量，也可设置 `CHROME_PATH`。`npm run assets:optimize` 可从保留的原始骨骼 / 佩剑副本重建优化资产。

```powershell
$env:BASE_URL='http://127.0.0.1:5174'
npm run verify:characters
```
