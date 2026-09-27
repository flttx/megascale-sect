# 云阙仙宗 · 修仙巨构探索

桌面端 Web 3D 探索游戏：一座 420 m 高的仙宗主殿坐落在云海之上的山巅平台，四周是石林、浮空仙岛与悬桥。玩家可在两位主角之间切换，步行登阶或御剑飞行，寻访碑文、钟楼、天象祭坛、观景台和传送阵，收集灵光，并在昼夜流转与五种天象中拍照留念。没有战斗与任务，重点是氛围、尺度与探索。

```bash
npm install
npm run dev      # 开发服务器（含 DEV 验证钩子）
npm run build    # 类型检查 + 生产构建到 dist/
```

打开开发服务器地址，选择角色，载入完成后点击「进入仙宗」锁定鼠标，也可用 Tab、Enter 或 Space 进入。仅支持桌面浏览器（Chrome / Edge，独立显卡）。

## 操作

| 操作 | 按键 |
| --- | --- |
| 移动 / 转向 | W A S D / 鼠标 |
| 冲刺 / 飞行加速 | Shift |
| 跳跃（地面） | Space |
| 召剑 → 踏剑 → 御剑；飞行中再按自动降落收剑；空中按下由飞剑接住 | F |
| 飞行升降 / 主动刹停 | Space / C / X |
| 环视角色，保持飞行方向 | 按住 Alt + 鼠标 |
| 男主角一 / 女主角二（同步更换佩剑） | 1 / 2 |
| 交互（碑文、钟、祭坛、坐忘、观景台、传送阵） | E |
| 卷轴：地图、碑文录、收集进度 | Tab |
| 拍照模式（自由机位、焦距、滤镜、暗角、导出 PNG） | P |
| 隐藏界面 | H |
| 设置与操作说明 / 退出镜头 | Esc |
| 静音 | M |
| 数据面板 / 碰撞辅助 | F3 / G |

移动和拍照使用物理键位；Ctrl 不用于下降。失焦、失去指针锁和 Cmd 组合操作会清空按键。设置、卷轴打开时停止玩家主动操作，世界继续运行，鲲背随动和入云救援继续生效。

设置中也可用鼠标或键盘切换角色、静音。拍照时 Esc 直接退出拍照，点击画面可继续操作；再次 Esc 打开设置。连续导出的 PNG 使用不同文件名。浏览器暂时拒绝锁定鼠标时，界面会提示重试。

## 世界与玩法

- **巨构场景**：主殿、山门与六座侧塔使用压缩后的 LOD 模型。山体用 CC0 扫描贴图，崖面有凹槽与台阶，山坡可以行走。四周有 36 根 Blender 程序化喀斯特石柱（25 根有可降落的岩架，其中 13 根在柱顶）、8 座浮空仙岛、两座可行走的悬索木桥、从岛缘流下的瀑布、汉白玉栏杆与旌旗；远处有 4 层山脊和 3 圈地平线山环。
- **主平台**：380 × 450 m 的石板台面按 30 m 分区，每区石料略有色差，以深色花岗岩带分隔。汉白玉御道沿中轴从大台阶延伸到主殿前，中间是云纹雕刻的御路石。前庭有松树树池、两方映天的碧水池，大香炉坐在两级丹墀上，两侧立着幡旗。
- **巨物**：两尊护山神像从山门两侧的云海中升起，双手没入云顶，头部约在 280 m 高处；约 460 m 的镇山巨剑插在东侧主峰上；约 310 m 长的鲲绕山巡游，破云时云海隆起、波纹扩散，并有远近不同的鸣叫；直径 120 m 的浑天仪悬在主殿上方，三层环反向旋转；锁云屿由五条铁链系在周围的石柱上。
- **植被**：Blender 程序化黄山松随阵风摆动，逆光时针叶透光。相机附近有 GPU 草地，风吹过时起伏成波，步行或低空御剑时草向两边分开，雪天被压低。
- **天象与昼夜**：晴空、山岚、细雨、落雪、雷暴五种天象自动流转，也可在天象祭坛或设置中切换。雨后地面湿润、有积水涟漪，雪后建筑积雪，雷暴有分叉闪电与按距离延迟的雷声。天空由大气散射 LUT 计算；中、高画质的云海是光线步进的体积云。云海薄雾贴着云顶，空气透视随距离逐渐加深，远山一层层淡入天色。晨昏有低角度的暖光，夜里有月光。
- **操控**：慢跑 5.5 m/s，冲刺 10 m/s，可以跳跃，也可以跳下悬崖，下落过快时飞剑会自动接住。镜头在肩后，会避开墙体和道具。主殿按屋顶高度场碰撞，可以飞上各层檐顶取灵光。御剑巡航 45 m/s，加速 140 m/s，俯冲更快，高速时有风线和轻微的镜头抖动。两位主角的动作片段由 Blender 重定向，步态随实际速度混合。
- **鲲背探索**：每圈路径时间 30 ≤ t < 150 s 时，可在坡度不超过 40° 的背部按 F 停靠，行走、起跳并收集 6 团灵光。角色、脚部和镜头随蒙皮表面移动；再次按 F 起飞会继承鲲的速度。鲲飞出普通世界边界时仍可离开并向内返航。入云前会提示，飞剑随后自动接走玩家。
- **探索点**：25 处交互点。碑文记载宗门传说；敲钟会惊起鹤群；在祭坛可以改变天象；坐忘蒲团能快进时辰；观景台有运镜；传送阵需先点亮，之后即可互相传送。共有 **66 团灵光**，罗盘指向最近一簇未收集灵光，地图随鲲更新移动标记。
- **声音**：本地合成风声、雨声、雷声、鸟鸣虫鸣，配五声音阶的铺底音乐与古筝拨弦，以及召剑、踏剑等动作音效。音量在设置中按通道调节。
- **Tripo 模型**：护山神像、镇山巨剑和鲲由 Tripo 生成（鲲的骨骼动画在 Blender 中制作）。另通过 Tripo HTTP API 生成 22 种道具，场景中用了 15 种。竹、奇石、灯笼、牌坊、石狮、香炉、亭子和灵晶实例化渲染，按距离切换 LOD；石碑、钟架、天象祭坛、坐忘台和传送阵用作交互点；仙鹤组成鹤群。松树和苔石改用 Blender 程序化模型；浮岛与旌旗为程序化生成，以匹配巨构的尺度。

## 存档与恢复

进入游戏后自动保存收集进度、所选角色与设置到 `yunque.save.v2`。首次读取旧 v1 时迁移固定的 60 条灵光 ID 映射，保留原 v1 数据。坏 JSON 先备份；未知版本或备份失败时保留原数据并暂停写入。存储不可用时本次会话停止重试，开场或设置界面显示提示。

位置只保存安全的静态地面，跳跃、下落和鲲背位置不会成为检查点；无有效位置时从出生点开始。页面隐藏时挂起音频，返回后恢复已解锁的音频上下文并保留静音设置。WebGL 上下文丢失时显示恢复遮罩；恢复后重建画布，保留本次进度与设置并回到检查点，12 秒超时后提供手动重试。

## 画质与性能

设置中有「流畅 / 均衡 / 极致」三档。渲染分辨率随帧率自适应；开启「自动」后，分辨率降到下限仍不够时会再降一档。极致档包含 4 级级联阴影、N8AO、Bloom、体积光和 4×MSAA。既有视角及鲲背视角的 draw calls 预算为 ≤400，由 `npm run verify:perf` 检查。R9 本轮 27 组场景最高 **296 次**，RTX 5060 Ti 上高档 147–238 fps；详细环境、CPU 降速与 GPU 分项数据见 [PROGRESS.md](PROGRESS.md)。CPU 降速不能代表真实低端 GPU。

拍照和卷轴面板在首次打开时加载；当前主包 562.64 kB（gzip 191.83 kB）。鲲背每帧复用骨骼矩阵，保持实时蒙皮查询；本机索引平均耗时从 3.40 ms 降至 1.69 ms。

## 资产

- **建筑**：`npm run assets:buildings` 从 `public/assets/models/` 下的原始 GLB 生成 LOD0/LOD1，体积由 151 MB 降到 21 MB。
- **角色与佩剑**：`npm run assets:optimize` 生成 `.optimized.glb`，体积由 184.8 MB 降到 9.2 MB。骨骼与动作见 [CHARACTER_PIPELINE.md](CHARACTER_PIPELINE.md)，压缩细节见 [OPTIMIZATION.md](OPTIMIZATION.md)。
- **重建资产**（`asset-pipeline/`，大体积原始文件已忽略）：`buildings/`（`meta.mjs` 从主殿 LOD0 测出屋顶高度场 `hallMeta.ts`）、`colossi/`（Tripo 神像与巨剑）、`kun/`（Tripo 鲲 + Blender 骨骼动画）、`rocks/`（Blender 石柱、浮岛、巨石，`meta.mjs` 生成 `rockMeta.ts`）、`vegetation/`（Blender 松树）、`textures/`（Poly Haven / ambientCG CC0 贴图）、`anim/`（动作重定向到角色骨骼）。Blender 脚本需 Blender 5.2。
- **道具**：`node scripts/tripo/generate.mjs [--only id1,id2] [--force] [--optimize-only]`。流程依次为概念图、image-to-model、gltf-transform 优化（meshopt + WebP + LOD1）。脚本从环境变量 `TRIPO_API_KEY` 读取密钥，不写入仓库。原始下载位于 `asset-pipeline/tripo/`（已忽略）；任务 ID 与积分记录在 `scripts/tripo/manifest.lock.json`。

## 验证

脚本自动查找 Windows / macOS / Linux 的 Chrome，再尝试 Playwright Chromium；可用 `CHROME_PATH` 指定路径，找不到时给出明确提示。本轮在 Windows 实跑。开发验证使用 `BASE_URL`（默认 `http://127.0.0.1:5173/`）；生产加载验证使用 `PREVIEW_URL`（默认 `http://127.0.0.1:4174/`）。截图和报告写入 `artifacts/`（已忽略）。

| 命令 | 内容 |
| --- | --- |
| `npm run verify:interact` | 交互、精确灵光计数、卷轴、设置焦点、拍照、存档内容及刷新恢复、交互绘制增量预算、无页面错误（42 项） |
| `npm run verify:perf` | 三档画质 × 既有 7 视角与鲲背 + 高档雷暴，27 组，draw calls ≤400；记录累计三角面；可设 `MIN_FPS` 强制帧率 |
| `npm run verify:visual` | 06/12/17.5/22 时 × 4 视角 + 四种天象 + 闪电，亮度 / 对比度检查，输出 `artifacts/visual/contact.png` |
| `npm run verify:characters` | 双角色召剑、御剑、换人换剑、暂停恢复 |
| `npm run verify:navigation` | 山门、台阶、主殿墙边召剑、高空绕至背面 |
| `npm run verify:optimization` | 加载体积、脚部约束、换人、刹停、镜头、音频 |
| `npm run verify:riding-pose` | 御剑站姿、脚底接触，飞行截图不能是黑帧 |
| `npm run verify:smoke` | 基础载入、指针锁、真实按键进入飞行与画面渲染；失败非零退出 |
| `npm run verify:controls` | 60/144 fps 台沿起跳、重复按键、异常 keyup / Cmd / 失锁、原生键盘进入、拍照输入 |
| `npm run verify:save` | v1 坐标迁移、幂等、坏档备份、未知版本保护、存储失败不重试、安全位置 |
| `npm run verify:motion` | 召剑/降落避障、20/60/144 fps 三条陡崖路线，每 0.05 s 比较完整轨迹 |
| `npm run verify:jumps` | 双角色在 60/144 fps 跳上 1.2 m 高台时提前伸腿、连续起跳交叉淡化 |
| `npm run verify:kun` | 双角色随动、落脚、跳跃、上下鲲、越界、菜单救援、6 团连续收集、地图和停靠时段 |
| `npm run verify:stability` | 音频挂起/恢复/拒绝重试；真实 WebGL 丢失、Canvas 重建、超时重试和进度保留 |
| `npm run verify:framerate` | 20/60/144 fps 跳高、滞空、低台阶贴地、高速尾迹和传送重置 |
| `npm run verify:ui` | 卷轴可访问性、设置换人/静音、角色存档、拍照退出/文件名、React 提交次数和短音效节点释放 |
| `npm run verify:environment` | 灰盒与实景 12 个视角、几何及原始建筑哈希；运行时快照默认输出到 artifacts，见管线说明 |
| `npm run verify:profile` | 普通 / CPU 四倍降速、鲲索引与锚点计时、8,489 顶点参考对照、静态查询及 GPU 分项采样 |
| `npm run verify:loading` | 生产包可选面板未提前下载；首次打开、换画质/角色、WebGL 恢复后再次使用 |

性能采样可设置 `QUALITIES`、`WIDTH`、`HEIGHT`、`CPU_THROTTLE`、`PERF_OUT`。例如在 PowerShell 中运行额外的流畅档 CPU 降速检查：

```powershell
$env:QUALITIES = 'low'
$env:WIDTH = '1280'
$env:HEIGHT = '720'
$env:CPU_THROTTLE = '4'
$env:PERF_OUT = 'artifacts/perf-low.json'
npm run verify:perf
Remove-Item Env:QUALITIES, Env:WIDTH, Env:HEIGHT, Env:CPU_THROTTLE, Env:PERF_OUT
```

生产加载检查前先执行 `npm run build`，在另一个终端启动 `npm run preview -- --port 4174 --strictPort`，然后运行 `npm run verify:loading`。GPU 分项仅在 DEV 的 `?profileGpu` 下拆开 pass，普通性能检查保持生产渲染方式。环境快照导出说明见 [environment-pipeline/README.md](environment-pipeline/README.md)。

开发用 URL 参数：`?quality=low|mid|high` 固定画质，`?hours=17.5` 固定时辰，`?weather=storm` 固定天象，`?kunAt=40` 从鲲的平飞阶段开始。`?env=graybox` 显示灰盒。DEV 构建在 `window` 上暴露验证钩子，例如 `__environmentReview`、`__setWeather`、`__setTimeOfDay`、`__kunSetTime`、`__ui` 和 `__interact`。重烘焙鲲背三角形与灵光锚点：`node asset-pipeline/kun/deck.mjs`。

R9：类型检查、构建与上述 **19 项全部通过**，交互 42/42、视觉 21/21。汇总、日志、CPU / GPU 采样和生产恢复截图位于 `artifacts/r9/`；帧率报告位于 `artifacts/framerate/`；鲲背站立、行走、飞离截图位于 `artifacts/kun/`。真实低端设备复测、有条件开展的 KTX2 / 阴影优化及布料、室内等限制见 [REMAINING_ISSUES.md](REMAINING_ISSUES.md)。

主场景参数在 `src/world/worldLayout.ts` 与 `src/world/sites.ts`，巨物布局在 `src/world/colossi/layout.ts`，昼夜配色与雾在 `src/world/sky/atmosphere.ts`，建筑资产在 `src/world/worldAssets.ts`，道具目录在 `src/world/props/propCatalog.ts`。
