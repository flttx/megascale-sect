# 云阙仙宗 · 修仙巨构探索

桌面端 Web 3D 探索游戏：一座 420 m 高的仙宗主殿坐落在云海之上的山巅平台，四周是石林、浮空仙岛与悬桥。玩家可在两位主角之间切换，步行登阶或御剑飞行，寻访碑文、钟楼、天象祭坛、观景台和传送阵，收集灵光，并在昼夜流转与五种天象中拍照留念。没有战斗与任务，重点是氛围、尺度与探索。

```bash
npm install
npm run dev      # 开发服务器（含 DEV 验证钩子）
npm run build    # 类型检查 + 生产构建到 dist/
```

打开开发服务器地址，选择角色，载入完成后点击「进入仙宗」锁定鼠标。仅支持桌面浏览器（推荐 Chrome / Edge，独立显卡）。

## 操作

| 操作 | 按键 |
| --- | --- |
| 移动 / 转向 | W A S D / 鼠标 |
| 奔跑 / 飞行加速 | Shift |
| 召剑 → 踏剑 → 御剑；飞行中再按自动降落收剑 | F |
| 飞行升降 / 主动刹停 | Space / Ctrl 或 C / X |
| 环视角色，保持飞行方向 | 按住 Alt + 鼠标 |
| 男主角一 / 女主角二（同步更换佩剑） | 1 / 2 |
| 交互（碑文、钟、祭坛、坐忘、观景台、传送阵） | E |
| 卷轴：地图、碑文录、收集进度 | Tab |
| 拍照模式（自由机位、焦距、滤镜、暗角、导出 PNG） | P |
| 隐藏界面 | H |
| 设置与操作说明 / 退出镜头 | Esc |
| 静音 | M |
| 数据面板 / 碰撞辅助 | F3 / G |

## 世界与玩法

- **巨构场景**：主殿、山门与六座侧塔使用压缩后的 LOD 模型。四周有 34 根喀斯特石柱、7 座浮空仙岛、两座可行走的悬索木桥、瀑布、汉白玉栏杆与随风飘动的旌旗。
- **天象与昼夜**：晴空、山岚、细雨、落雪、雷暴五种天象自动流转，也可在天象祭坛或设置中切换。雨后地面湿润、有积水涟漪，雪后建筑积雪，雷暴有分叉闪电与按距离延迟的雷声。天空、云海、级联阴影、体积光、雾和环境光都随太阳高度变化。
- **探索点**：25 处交互点。碑文记载宗门传说；敲钟会惊起鹤群；在祭坛可以改变天象；坐忘蒲团能快进时辰；观景台有运镜；传送阵需先点亮，之后即可互相传送。另有 60 团灵光，罗盘会指向最近一簇未收集的灵光。进度自动保存在本地，下次进入可继续。
- **声音**：本地合成风声、雨声、雷声、鸟鸣虫鸣，配五声音阶的铺底音乐与古筝拨弦，以及召剑、踏剑等动作音效。音量在设置中按通道调节。
- **Tripo 道具**：通过 Tripo HTTP API 生成 22 种模型，场景中用了 19 种。松、竹、奇石、灯笼、牌坊、石狮、香炉、亭子和灵晶实例化渲染，按距离切换 LOD；石碑、钟架、天象祭坛、坐忘台和传送阵用作交互点；仙鹤组成鹤群。浮岛与旌旗改为程序化生成，以匹配巨构的尺度，对应的 3 个模型没有使用。

## 画质与性能

设置中有「流畅 / 均衡 / 极致」三档。渲染分辨率随帧率自适应；开启「自动」后，分辨率降到下限仍不够时会再降一档。极致档包含 4 级级联阴影、N8AO、Bloom、体积光和 4×MSAA。所有视角的 draw calls 预算为 ≤ 400，由 `npm run verify:perf` 检查。实测数据见 [PROGRESS.md](PROGRESS.md)。

## 资产

- **建筑**：`npm run assets:buildings` 从 `public/assets/models/` 下的原始 GLB 生成 LOD0/LOD1，体积由 151 MB 降到 21 MB。
- **角色与佩剑**：`npm run assets:optimize` 生成 `.optimized.glb`，体积由 184.8 MB 降到 9.2 MB。骨骼与动作见 [CHARACTER_PIPELINE.md](CHARACTER_PIPELINE.md)，压缩细节见 [OPTIMIZATION.md](OPTIMIZATION.md)。
- **道具**：`node scripts/tripo/generate.mjs [--only id1,id2] [--force] [--optimize-only]`。流程依次为概念图、image-to-model、gltf-transform 优化（meshopt + WebP + LOD1）。脚本从环境变量 `TRIPO_API_KEY` 读取密钥，不写入仓库。原始下载位于 `asset-pipeline/tripo/`（已忽略）；任务 ID 与积分记录在 `scripts/tripo/manifest.lock.json`。

## 验证

脚本使用本机 Chrome 连接开发服务器。可用环境变量 `BASE_URL`（默认 `http://127.0.0.1:5173/`）和 `CHROME_PATH` 指定地址与浏览器；截图和报告写入 `artifacts/`（已忽略）。

| 命令 | 内容 |
| --- | --- |
| `npm run verify:interact` | 交互点、灵光收集、卷轴、设置焦点、拍照导出、存档写入、无页面错误（37 项） |
| `npm run verify:perf` | 三档画质 × 7 个视角 + 雷暴，draw calls ≤ 400，FPS 中位数；可设 `MIN_FPS` 强制帧率 |
| `npm run verify:visual` | 06/12/17.5/22 时 × 4 视角 + 四种天象 + 闪电，亮度 / 对比度检查，输出 `artifacts/visual/contact.png` |
| `npm run verify:characters` | 双角色召剑、御剑、换人换剑、暂停恢复 |
| `npm run verify:navigation` | 山门、台阶、主殿墙边召剑、高空绕至背面 |
| `npm run verify:optimization` | 加载体积、脚部约束、换人、刹停、镜头、音频 |
| `npm run verify:riding-pose` | 御剑站姿与脚底接触 |
| `npm run verify:smoke` | 基础载入 |

开发用 URL 参数：`?quality=low|mid|high` 固定画质，`?hours=17.5` 固定时辰，`?weather=storm` 固定天象。`?env=graybox` 显示灰盒。DEV 构建在 `window` 上暴露验证钩子，例如 `__environmentReview`、`__setWeather`、`__setTimeOfDay`、`__ui` 和 `__interact`。

主场景参数在 `src/world/worldLayout.ts` 与 `src/world/sites.ts`，建筑资产在 `src/world/worldAssets.ts`，道具目录在 `src/world/props/propCatalog.ts`。
