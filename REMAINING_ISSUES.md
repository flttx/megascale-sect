# 剩余问题与优化方案（2026-09-27）

本文列出 R8 阶段结束时仍存在的问题，每条都给出根因、修法、验证方式和工作量。条目按模块分组，每组内按优先级排序。建议的执行顺序见最后一节。

## 0. 检查范围与现状

| 项 | 结果 |
| --- | --- |
| 代码状态 | `master` 上有未提交的起跳改动（9 个文件，见 §1），`package.json` 另有一处无关的包名改动 |
| `npx tsc --noEmit -p .` | 通过 |
| `npm run build` | 通过。dist 67 MB；JS 分包 index 405 kB / three 759 kB / r3f 814 kB（gzip 153 / 192 / 310 kB） |
| 上次全量验证 | R7e：8 项 verify 全部通过，最差 295 次 draw call（预算 400） |
| 起跳改动已跑的验证 | tsc、build、verify:characters、verify:riding-pose、verify:optimization 通过 |
| 飞行光束分叉 | 已修复并提交（f3f49f9）：拖尾改为沿实际速度方向，不再沿人物朝向 |

**本次检查的来源：**
- 起跳改动的独立审查；
- 两路只读审查：操控/镜头/飞行，UI/交互/存档/音频；
- 渲染/资产部分由主会话定点检查（这一路审查 agent 因 API 额度不足中途失败）。

抽查过、读代码确认属实的条目：J1、C1、C2、C9、C8（尾迹固定 28 帧）、U2、U3、U5。其余条目来自审查报告，报告里有代码位置和推理，但本次没有在浏览器里复现，修之前先按「验证」一栏复现一次。

**优先级：**
- **P0**：影响正确性、会丢数据，或会被用户直接撞到，下一轮先修。
- **P1**：用户已经提出的需求（鲲背停靠）。
- **P2**：明显的手感或健壮性问题。
- **P3**：低影响的问题和优化。
- **长期**：已知限制，目前接受。

### 总表

| ID | 优先级 | 模块 | 问题 | 工作量 |
| --- | --- | --- | --- | --- |
| J1 | P0 | 起跳 | 蹲身期间走下台沿会丢失这次起跳 | 小 |
| J2 | P0 | 起跳 | 蹲身中再按空格，这次按键会留到下一次落地 | 小 |
| C1 | P0 | 输入 | Ctrl 是下降键，Ctrl+W 会关闭标签页 | 小 |
| C2 | P0 | 输入 | 按 `event.key` 记录按键，Mac 按 Option/Cmd 会卡键，AZERTY 键位也不对 | 小 |
| U1 | P0 | 存档 | 灵光 id 按生成顺序编号，改布局后存档错位 | 中 |
| U2 | P0 | 可访问性 | 开场界面无法用键盘进入游戏 | 小 |
| K | P1 | 鲲 | 鲲背停靠、随鲲移动、鲲背灵光（用户需求） | 大 |
| C3 | P2 | 召剑 | 面对石碑、钟、祭坛召剑时，登剑点落在碰撞体内 | 小 |
| C4 | P2 | 落剑 | 在巨剑、柱础上方落剑会穿过模型 | 中 |
| C5 | P2 | 飞行 | 贴崖飞行像坐电梯，高速时能穿过薄山脊 | 中 |
| J3 | P2 | 起跳动作 | 伸腿找地由竖直速度决定，跳上高台时没有伸腿 | 小 |
| J4 | P2 | 起跳动作 | 落地后立即起跳，骨骼动画一帧跳变 | 小 |
| U3 | P2 | 音频 | 切到后台标签页后底噪一直响 | 小 |
| U4 | P2 | 验证 | verify:interact 有必然通过的断言 | 小 |
| U5 | P2 | 存档 | 版本不符直接丢弃，坏档被下次自动保存覆盖 | 小 |
| R1 | P2 | 渲染 | 没有处理 WebGL 上下文丢失 | 小 |
| C6–C10 | P3 | 操控 | 帧率相关的跳高、下台阶、剑尾迹；两个高度下限不一致 | 小 |
| U6–U14 | P3 | UI | 存储不可用、暂停时环境音、ARIA、验证覆盖、拍照、HUD 按钮等 | 小 |
| R2–R5 | P3 | 渲染 | KTX2 贴图、代码分割、低端机基线、GPU 计时 | 中 |
| J5, J6, E1–E5 | P3 | 文档/工程 | 注释与文档过时、包名改动未提交、验证脚本默认路径 | 小 |

---

## 1. 起跳改动（未提交）

涉及文件：
- `asset-pipeline/anim/build.mjs`、`build-report.json`
- 两套 `anim.glb`
- `GroundController.tsx`、`playerMotion.ts`、`playerHandle.ts`、`characterClips.ts`、`characterPose.ts`

改动内容：先蹲身再起跳（站立 0.1 s，跑动 0.05 s）；空中动作跟随竖直速度；跑跳时分腿。独立审查结论：1 个 bug、2 个视觉风险、2 个注释问题。**J1、J2 修好后再提交这一阶段。**

### J1 · P0 · 蹲身期间走下台沿会丢失这次起跳
- **位置**：`src/world/player/playerMotion.ts:114-117`、`:127`；`GroundController.tsx:100-101`
- **现象**：跑动时蹲身持续 0.05 s。冲刺 10 m/s 时这段时间会前进 0.5 m，所以在池沿、丹墀台阶、石板边缘前 0.5 m 内按空格，角色会直接走下去，不起跳。改动前是立即起跳的。取消阈值是 `stepLength·tan55° + 0.05`，随帧率变化：60 fps 冲刺约 0.29 m，144 fps 慢跑只要约 0.11 m。
- **根因**：
  - 蹲身一开始就把 `jumpBuffer` 清零了。
  - 走下台沿时，`velocity.y < 0` 这一行只取消蹲身，不补跳。
  - 滑坡时 `stepGround` 忽略 `jump`，这次起跳同样丢失。
- **修法**：用 coyote 式处理，蹲身中离地就立即起跳。滑坡时不开始蹲身。

```ts
// playerMotion.ts GROUND 分支
if (!runtime.takeoffTime && runtime.jumpBuffer > 0 && !runtime.inAir && !sliding(runtime)) { ... }  // sliding 需要由 stepGround 暴露
...
const touchdown = stepGround(position, velocity, input, runtime.yaw, boosting, leap, delta)
if (velocity.y < 0 && runtime.takeoffTime) {
  // 蹲身期间走下台沿：从台沿直接起跳，而不是丢掉这次起跳
  velocity.y = JUMP_SPEED
  runtime.takeoff = runtime.takeoffTime = 0
}
```

  - `stepGround` 目前不返回滑坡状态。可以加一个模块级的 `lastSliding` 并导出只读函数，写法与 `ignoreProps` 相同。也可以把返回值改成 `{ touchdown, sliding }`，这样要同步改唯一的调用方。
- **验证**：
  - 在 60 fps 和 144 fps 下（Chrome 用 `--force-device-scale-factor` 配合限帧，或者 DEV 钩子固定 delta），分别在水池沿前 0.1 m、0.3 m、0.5 m 按空格起跳，每次都应该跳起。
  - 复跑 verify:characters。
- **工作量**：小

### J2 · P0 · 蹲身中再按空格，这次按键会留到下一次落地
- **位置**：`playerMotion.ts:114-115`
- **现象**：跑向 0.45 m 以内的矮台阶时快速双击空格，刚落到台阶上会意外再跳一次。
- **根因**：蹲身期间 `takeoffTime ≠ 0`，新的按键不会开始新的蹲身，但写入的 `jumpBuffer = 0.15` 一直留着，起跳时也没有清掉。
- **修法**：起跳那一帧清掉缓冲，`if (leap) runtime.jumpBuffer = 0`。也可以在 `Player.tsx` 的 keydown 里判断，`takeoffTime > 0` 时不写 `jumpBuffer`。
- **验证**：在矮台阶前双击空格，落地后不应该再跳。
- **工作量**：小

### J3 · P2 · 伸腿找地由竖直速度决定，与离地距离无关
- **位置**：`characterClips.ts:26-30`（注释）、`:164`、`:168`
- **现象**：
  - 跳上高台时，落地那一刻角色还在上升或刚过顶点，腿是收着的。随后 `leap` 一帧归零，只靠 18/s 的叠加缓动，腿在约 0.1 s 里展开。
  - 跳下低处时，下落速度达到 0.9·JUMP_SPEED 就进入 reach，此后一直保持这个姿势。
  - 注释写的是 "however high the ground is"，与实际行为不符。
- **修法**：下降段改用预计触地时间驱动，上升段在即将触地时也混入 reach。

```ts
// ClipLayer.update，inAir && jumped 分支
const h = runtime.position.y - (groundHeight(runtime.position.x, runtime.position.z, runtime.position.y) ?? -Infinity)
const g = LAYOUT.player.gravity, vy = runtime.velocity.y
const toLand = h > 0 && Number.isFinite(h) ? (vy + Math.sqrt(vy * vy + 2 * g * h)) / g : Infinity
const REACH_LEAD = JUMP.reach - JUMP.apex   // 片段里从顶点到伸腿的时长（约 0.167 s）
const reaching = 1 - smooth(toLand / REACH_LEAD)
const byRise = rise > 0 ? JUMP.lift + (JUMP.apex - JUMP.lift) * (1 - rise) : JUMP.apex
this.jumpTime = Math.max(byRise, JUMP.apex + (JUMP.reach - JUMP.apex) * reaching)
```

  - 每帧多一次 `groundHeight`，约 4 µs。
  - `toFall` 仍然按 `-rise` 计算。
  - 注释改为说明这是按「预计触地时间」驱动的。
- **验证**：连续截帧跳上 1.2 m 高台和跳下 3 m 平台，看触地前 0.1 s 腿是否已经伸出。verify:characters 通过。
- **工作量**：小

### J4 · P2 · 落地后立即起跳，骨骼动画一帧跳变
- **位置**：`characterClips.ts:157-161`
- **现象**：落地后 `jumpTime` 停在 reach（0.533）。下一帧开始蹲身，它一步跳到 0–0.1，而这时 `air` 还接近 1，所以伸腿姿势一帧就变成蹲姿。跑动时从最深的蹲姿开始，跳变更明显。
- **修法**：用两个 jumpTime 采样做 0.08 s 的交叉淡化。

```ts
// 字段：private jumpFrom = 0; private jumpFade = 1
// 蹲身开始那一帧（takeoff && !this.wasTakeoff）：this.jumpFrom = this.jumpTime; this.jumpFade = 0
this.jumpFade = Math.min(1, this.jumpFade + delta / 0.08)
sample(jump, Math.min(this.jumpFrom, jump.duration), w.jump * (1 - this.jumpFade))
sample(jump, Math.min(jumpTime, jump.duration), w.jump * this.jumpFade)
```

  - `sample` 本身按权重累加，所以不需要额外归一化。
- **验证**：落地后 0.1 s 内再次起跳，逐帧截图，确认没有一帧跳变。
- **工作量**：小

### J5 · P3 · 注释引用了不存在的名字，标记时间写了两份
- **位置**：`asset-pipeline/anim/build.mjs:293`
- **现象**：
  - 注释写的是 `characterClips.ts JUMP_MARKS`，实际常量名是 `JUMP`。
  - crouch 和 lift 的时间在 build.mjs 的 warp 节点里写了一份，在 `characterClips.ts:31` 又手写了一份。
  - build-report 里的 `marks` 没有取整，输出的是 0.36666666666666664 这样的全精度。
- **修法**：参照 `hallMeta.ts` / `rockMeta.ts` 的做法，由 build.mjs 生成 `src/world/player/jumpMarks.ts`（`export const JUMP = {...} as const`），characterClips 改为从这个文件导入。report 里的 marks 用 `toFixed(4)`。
- **工作量**：小

### J6 · P3 · 落地强度注释偏差
- **位置**：`characterClips.ts:140-141`
- **说明**：按 g = 28、jumpHeight = 1.3 算，平地跳的空中时间是 0.61 s，`landStrength ≈ 0.62`，不是注释里的 "about half"。空中时间到 0.9 s 就已满值，不是 "a second or more"。
- **修法**：只改注释。
- **工作量**：小

---

## 2. 鲲背停靠与灵光（P1，用户需求，未实现）

用户原话：「飞的鲸鱼上面也要能停靠，上面也加上灵光可以采集」。下面是已经定下的设计，所有数据都来自探针实测（`artifacts/r8/kunlib.mjs`、`kundeck.mjs`、`kunpath.mjs`）。

### 2.1 已知数据

**模型与路径**
- 模型长 260 m：glTF 中头在 +Z 101，尾在 −159。场景缩放 `KUN.scale` = 1.2，所以实际约 312 m。
- 沿闭合 CatmullRom 路径 `KUN_PATH`（centripetal）以 40 m/s 前进，一圈 7911 m，周期 197.8 s。

**飞行时间线**（t 为路径时间，可用 `?kunAt=` 指定）

| t（s） | 状态 |
| --- | --- |
| ≈ 11 | 破云 |
| 12–30 | 以 25–38° 爬升 |
| 30–155 | 平飞 |
| 64–91、112–138 | 飞出 `LAYOUT.worldLimit`（1100 m） |
| ≈ 155 起 | 以 −18° 到 −20° 俯冲 |
| 168 | 原点 y ≈ −33 |
| 171 | 头部没入云海（`CLOUD_SEA_Y` = −84） |

- 侧倾上限 `BANK_MAX` = 0.45 rad（约 26°）。

**鲲背几何**（root 骨骼坐标系，模型单位）
- 背顶在 y 20–30，范围 z ∈ [−50, 70]（头朝 +z），宽约 ±25–35 m。
- 亭子和树在 z −10…20、x −10…25 一带，高 y 34–47。

**游动形变**（相对 root 骨骼）

| 部位 | 形变 |
| --- | --- |
| z −40…−20、z 30…50 | 1.2–2.3 m |
| z 0…20（亭子所在） | 7–13 m |
| z ±50…60 | 5–6 m |

所以不能只按 root 骨骼的位移搬运玩家，要按脚下三角形实际的蒙皮位置搬运（见 2.4）。

**骨骼**：root、spine_00_head … spine_11_fluke、fin_L/R_01..03。鳍是独立骨骼。

**更新顺序**
- 当前 Kun 的 `useFrame` 优先级是默认的 0，Player 是 −1，所以鲲在玩家之后更新。
- `SkinnedMesh.getVertexPosition` 用的是骨骼的 `matrixWorld`，查询前必须已经更新。

### 2.2 鲲背高度数据（离线烘焙）

新建 `asset-pipeline/kun/deck.mjs`，复用 `artifacts/r8/kundeck.mjs` 的三角形光栅化：

1. 在绑定姿势下，把全部三角形变换到 root 骨骼坐标系。
2. 剔除鳍上的三角形：顶点 skinWeight 中 fin_* 骨骼的权重 > 0.3。
3. 按 1 m 网格光栅化，范围 x −40…40、z −80…100。每格记录最高那个三角形的 `(meshIndex, triIndex)`，没有则记 −1。
   - 亭子和树保留。亭子屋顶可以降落；树干和亭柱会因为 45° 爬坡限制和 1 m 规则自然挡住行走。
4. 输出 `src/world/colossi/kunDeckMeta.ts`，写法与 `hallMeta.ts` 一致：`{ x0, z0, cell, nx, nz, cells: string }`，cells 用 base64 编码的 Int32Array。81 × 181 格约 58 KB 原始数据，base64 后约 78 KB。也可以做行程编码，能再缩小一个数量级。

### 2.3 运行时查询

新建 `src/world/colossi/kunDeck.ts`：

```ts
export interface DeckHit { y: number; normalY: number; mesh: SkinnedMesh; tri: number; u: number; v: number }

/** 世界坐标 (x, z) 处、不高于 fromY + 1 m 的鲲背高度；鲲未加载或不在附近时返回 null。 */
export function kunDeckHit(x: number, z: number, fromY: number): DeckHit | null {
  if (!deck.ready || Math.hypot(x - deck.center.x, z - deck.center.z) > 200) return null   // 快速排除
  let y = fromY
  for (let pass = 0; pass < 2; pass++) {                 // 鲲有侧倾和俯仰：世界竖直线在局部系里是斜的，迭代一次
    local.set(x, y, z).applyMatrix4(deck.rootInverse)    // 根骨骼坐标系（模型单位）
    const cell = lookup(local.x, local.z)                // (meshIndex, tri) 或 null
    if (!cell) return null
    skinTriangle(cell, a, b, c)                          // 3 次 getVertexPosition，再乘 mesh.matrixWorld
    const hit = verticalHit(x, z, a, b, c)               // 竖直线与三角形平面求交，并算出重心坐标
    if (!hit) return null
    y = hit.y
  }
  return y > fromY + 1 ? null : result                   // 与 walkableHeight 的 1 m 规则一致
}
```

- **注册成可行走面**：`surfaces.ts` 新增一种可行走面：

  ```ts
  interface WalkableMoving { kind: 'moving'; heightAt(x: number, z: number, fromY: number): number | null }
  ```

  `surfaceY` 按 kind 分发。这样 `groundHeight`、`canStep`、落剑和镜头避让都能自动用上鲲背。
- **坡度**：`terrainSlope` 对非自然地面返回 0（`worldLayout.ts:71`），所以不能用它拦截鲲背上的陡坡降落。`requestFlightToggle` 的 FLIGHT 分支要另外判断：命中鲲背且 `normalY < cos 40°` 时，提示「鲲背此处陡峭」。
- **开销**：每次查询最多 6 次蒙皮顶点计算，每次 4 根骨骼。groundHeight 每帧约调用 10 次，合计不到 0.05 ms。

### 2.4 更新顺序与玩家随鲲移动

**Kun.tsx**
1. `useFrame` 改为优先级 −2，排在 Player（−1）之前。它与 WeatherSystem 同为 −2，两者没有依赖。
2. `anim.mixer.update(dt)` 之后调用 `group.updateMatrixWorld(true)`，更新 `deck.rootInverse`、`deck.center`，并把 `deck.ready` 置为 true。
3. 有玩家在鲲背上时，把 `BANK_MAX` 缓动到约 0.15。原来的 26° 侧倾会让鲲背超过步行坡度限制，看起来也难受。

**PlayerRuntime**
- 新增 `aboard: DeckAnchor | null`，内容为 `{ mesh, tri, u, v, point: Vector3, yaw: number }`：脚下三角形、重心坐标、上一帧记录的世界点和鲲的航向。

**Player.tsx 的 useFrame**
- 在 `stepPlayer` 调用前处理，暂停时也要执行，因为暂停时鲲照常游动：

```ts
if (state.aboard) {
  const now = evaluateAnchor(state.aboard, scratch)      // 同一三角形、同一重心坐标，用本帧的蒙皮重新计算
  delta.subVectors(now, state.aboard.point)
  const turn = kunHeading() - state.aboard.yaw
  state.position.add(delta); state.origin.add(delta); state.destination.add(delta)
  state.yaw += turn; state.facing += turn; state.sequenceYaw += turn
  shiftCameraRig(delta, turn)                            // CameraRig 新导出：平移 pivot 与 last，镜头不滞后
}
```

- `stepPlayer` 之后：如果仍在鲲背上，用 `kunDeckHit` 在新位置重新取锚点，写回 `aboard`。
- **为什么按锚点三角形搬运，而不是按 root 骨骼的矩阵差**：亭子一带相对 root 骨骼有 7–13 m 的游动形变。按 root 骨骼搬运时，玩家会在鲲背上来回滑动，按锚点三角形搬运则不会。
- **镜头**：CameraRig 的 x/z 严格跟随 pivot，但 pivot.y 以 12/s 缓动。鲲爬升时竖直速度可达 24 m/s，不补偿的话镜头会落后约 2 m，所以需要 `shiftCameraRig` 同时平移 pivot 和 `rig.last`。每帧的位移不超过 4 m，远小于 `SNAP = 30`，不会被当成瞬移。

### 2.5 上鲲与离开

| 情况 | 处理 |
| --- | --- |
| GROUND 且脚下是鲲背（`groundHeight` 等于 `kunDeckHit` 的结果） | 挂上 `aboard` |
| 在鲲背上起跳，处于空中 | 保持 `aboard`，按起跳时的锚点继续搬运。空中约 0.6 s，鲲会前进 24 m，不搬运的话会掉到鲲尾后面 |
| SUMMONING / BOARDING / LANDING / DISMOUNTING | 保持 `aboard`，`origin` 与 `destination` 一起平移 |
| FLIGHT 中按 F，落点在鲲背上 | 进入 LANDING 时挂上 `aboard`；每帧用 `kunDeckHit` 重新计算 `destination.y` |
| 进入 FLIGHT（BOARDING 结束，或 catchWithSword） | 清除 `aboard`，`velocity += 锚点速度`（delta / dt）。stepFlight 本身按指数把速度拉向输入目标，所以继承的速度会平滑衰减 |
| 传送 | 清除 `aboard`。下一帧如果脚下是鲲背，会按第一条规则重新挂上 |
| 从鲲背边缘走下去 | 走下时清除 `aboard`；下落超过 `RESCUE_SPEED` 时飞剑自动接住（已有逻辑） |

**俯冲前强制离开**
- 鲲从 t ≈ 155 开始俯冲。在鲲背上且 t ≥ 150 时，提示一次「鲲将没入云海」。
- 玩家的 y < `CLOUD_SEA_Y + 60`（−24 m），或鲲头低于云顶 + 40 m 时，调用 `catchWithSword` 并提示「飞剑载你离开鲲背」。
- LANDING 的目标是正在俯冲的鲲时，取消降落，并提示「鲲正没入云海，无法停靠」。

**世界边界**
- 鲲在 t 64–91 和 t 112–138 时位于 1100 m 之外。`FlightController.tsx:48-50` 会在起飞第一帧把玩家拉回 1100，看起来像瞬移。
- 改为逐轴取 `limit = max(worldLimit, |起步位置|)`。这样不会被向内拉扯，但也不能再往外飞。
- 地面阶段没有 x/z 夹紧，不受影响。

**存档**
- `src/ui/save.ts:61` 只接受 |x| < 1200、|z| < 1300、−80 < y < 600 的位置。
- 按审查结论，存档只在 GROUND 阶段记录位置。在鲲背上存档后读回时，鲲已经游走，玩家会悬在空中或落回出生点。
- 修法：在鲲背上时不更新存档位置，保留最后一次不在鲲背上的地面位置。

### 2.6 鲲背灵光

- `orbs.ts`：
  - 新增分组 `'kun'`（标签「鲲背」），6 团，id 接在末尾（`orb_60`…`orb_65`，已有 id 不变）。
  - 每团记录 root 骨骼坐标系下的 `(x, z)`，沿背脊分布在 z −45…65，避开亭子（x −10…25、z −10…20）。
  - 如果先做了 U1，id 改用 `orb_kun_0…5`。
- 新增 `orbPosition(orb, out)`：固定灵光直接返回 `orb.position`；鲲背灵光返回鲲背高度 + 1.5 m。鲲未加载时返回 null，这时不显示也不能收集。以下四处改为调用它：
  - `Interactables.tsx` 的 SpiritOrbs：鲲背灵光每帧写 instanceMatrix。实例化网格的包围球不再覆盖这些灵光，要设 `frustumCulled = false`，或每帧扩大包围球。
  - `Hud.tsx` 的 `nearestOrbCluster`：罗盘指向鲲的当前位置。
  - `ScrollOverlay.tsx` 的地图：画出鲲的当前位置和已收集的鲲背灵光。
  - DEV 钩子 `visitOrb`。
- 总数 60 → 66，需要同步改的地方：
  - 收集完成的通知改为不写死数字：「诸天灵光尽收 · 云阙诸天为你澄明」。
  - `README.md:40` 的「另有 60 团灵光」。
  - `scripts/verify-interact.mjs:42` 的正则 `/灵光\s*0\s*\/\s*60/`，改为从页面读 `ORB_COUNT`。
  - 在 `ORB_TINT` 和 `ORB_GROUP_LABELS` 里加上 `kun`。
- Draw call：灵光仍在同一个实例化网格里，不增加调用。

### 2.7 验证

新建 `scripts/verify-kun.mjs` 并登记到 package.json 和 README。脚本以 `?kunAt=40` 打开页面，按下表逐项断言：

| 步骤 | 断言 |
| --- | --- |
| `visitOrb(60)` 传送到鲲背 | phase = GROUND，`aboard` 不为空 |
| 静止 5 s | 玩家在 root 坐标系中的漂移 < 0.3 m；落脚误差 < 0.05 m |
| 前进 2 s | 仍在鲲背上，相对鲲背有位移；无浏览器错误 |
| 起跳 | 落回鲲背，相对起跳点漂移 < 0.5 m |
| 收集 6 团鲲背灵光 | 计数 +6 |
| F 召剑起飞 | 起飞前后速度变化 < 5 m/s；没有位置瞬移（单帧位移 < 5 m） |
| 飞回鲲背并按 F | 降落成功，重新挂上 `aboard` |
| 以 `?kunAt=145` 在鲲背上等待 | 在玩家 y < −24 之前被飞剑接走，并出现提示 |
| 截图 | 鲲背站立、行走、飞离（`artifacts/kun/`） |

另外复跑 tsc、build 以及 verify:interact、navigation、perf、smoke、characters、optimization，并做一次独立审查后再提交。

### 2.8 风险

- 鲲背的法线由蒙皮三角形决定。头尾附近形变大，可能出现个别陡三角形，行走时会被当成墙。验收时沿背脊走完一整趟检查。
- 镜头可能穿进鲲身。CameraRig 的避让只看 `groundHeight` 和碰撞体，鲲身的侧面不在其中。可以接受，也可以给鲲身加 3 个随鲲移动的胶囊碰撞体，只给镜头用。
- 爬升段（t 12–30）坡度 25–38°，虽然能站，但观感不好。考虑爬升段不允许降落到鲲背。

---

## 3. 操控、镜头、飞行

### C1 · P0 · 按住 Ctrl 下降时按 W 会关闭标签页
- **位置**：`src/world/player/Player.tsx:44`、`:113`；`README.md:21`
- **根因**：下降键是 Ctrl 或 C，Ctrl+W 是 Chrome 的保留快捷键，页面无法 `preventDefault`。
- **修法**：去掉 `'control'`，只保留 C。README 操作表同步修改。界面提示本来就只写了 SPACE / C。
- **验证**：代码里不再有 `'control'` 分支；飞行中按 C 仍能下降。
- **工作量**：小

### C2 · P0 · Mac 上会卡键，AZERTY 键盘 WASD 错位
- **位置**：`Player.tsx:35`、`:37`、`:52`；`src/ui/useUiKeys.ts:15`
- **现象**：
  - 按住 W 再按 Option，然后松开 W，keyup 收到的是 `'∑'`，`'w'` 留在集合里，角色会一直往前走。
  - Option+Space 松开时收到的是 NBSP，飞行时会一直上升。
  - 按住 Cmd 时，浏览器不发其他键的 keyup。
- **根因**：用 `event.key.toLowerCase()` 记录按键，同一个物理键在 keydown 和 keyup 时得到的字符可能不同。
- **修法**：
  - 移动、升降、冲刺、刹停、环视改用 `event.code`（`KeyW` / `Space` / `KeyC` / `ShiftLeft` / `ShiftRight` / `KeyX` / `AltLeft`）。
  - 功能键（F、E、M、1/2、Tab、P、H）也可以统一改用 `code`，这样与键盘布局无关。
  - 检测到 `event.metaKey` 时清空按键集合，避免 Cmd 组合键之后卡键。
- **验证**：DEV 下派发 `{ key: '∑', code: 'KeyW' }` 的 keyup，确认按键集合被清空。
- **工作量**：小

### C3 · P2 · 面对石碑、钟、祭坛召剑时，登剑点落在碰撞体内
- **位置**：`src/world/player/playerMotion.ts:70-76`
- **现象**：
  - 石碑半径 1.6 m，钟 2.6 m，祭坛 3.3 m。身体被挡在距中心 r + 0.35 处，向前 1.15 m 就落进了碰撞体里。
  - 登剑后角色嵌在模型里。飞行首帧 margin 为 −1，碰撞整个关闭，会穿模飞出。
- **修法**：候选落点除了高度，还要检查碰撞：在 `find` 的条件里加上 `!bodyInsideAnyCollider(x, h, z, …) && !insideStructure(x, h + 1, z)`。被挡时会自动改用另外三个方向；四个方向都不行时提示「请在开阔处召剑」。
- **验证**：分别贴着三种交互点、面朝它们召剑。
- **工作量**：小

### C4 · P2 · 在巨剑、柱础等上方落剑会穿过模型
- **位置**：`playerMotion.ts:87-90`、`:168-169`
- **现象**：落点只用 `groundHeight` 计算，下降过程也不做碰撞检测。有 198 个非开放圆柱碰撞体下方有可走地面，落剑会穿过模型落到下面，然后被 `bodyBlocked` 卡在模型里。
- **修法**：按 F 时检查落点：`bodyInsideAnyCollider(x, surface, z)` 或 `insideStructure` 命中时拒绝降落，提示「下方有遮挡」。更好的做法是把碰撞体顶部 `maxY` 当作落点：圆柱顶面可以站。
- **验证**：悬停在巨剑（332, −717）上方按 F。
- **工作量**：中

### C5 · P2 · 贴崖飞行像坐电梯，高速时能穿过薄山脊
- **位置**：`playerMotion.ts:157-159`；`FlightController.tsx:37-45`
- **现象**：
  - 水平贴着峰腰（坡度 43.6 m/m）飞时，玩家会被一帧抬上崖顶，镜头随之猛跳。
  - 审查的离线模拟：每帧位移 9.8 m 时，14 万段里有 1300 段穿过地形；每帧 2.3 m 时有 136 段。结果与帧率有关。
- **根因**：飞行的子步只检查碰撞体和建筑，地形只在整帧结束后做一次高度钳制。
- **修法**：把地形检查放进子步循环：

```ts
const rise = (groundHeight(nx, nz, y + hover) ?? -Infinity) + hover - y
if (rise > MAX_CLIMB * Math.abs(stepXZ)) { /* 阻挡该轴，速度分量清零 */ } else if (rise > 0) y += rise
```

  - MAX_CLIMB 取约 1.5，即允许约 56° 的抬升。
- **验证**：沿同一条贴崖航线在 20、60、144 fps 下各回放一次，轨迹差 < 1 m，且没有穿过山脊。
- **工作量**：中

### C6 · P3 · 跳跃高度随帧率变化
- **位置**：`GroundController.tsx:131-132`
- **现象**：跳跃最高点在 20 fps 时 1.09 m，60 fps 时 1.23 m，144 fps 时 1.27 m。
- **根因**：用的是半隐式欧拉积分。
- **修法**：改成解析积分：`position.y += velocity.y * dt - 0.5 * g * dt * dt; velocity.y -= g * dt`。
- **验证**：离线模拟各帧率下的最高点，都应等于 v²/2g（1.3 m）。
- **工作量**：小

### C7 · P3 · 高帧率下走下低台阶，动作会抽动
- **位置**：`GroundController.tsx:125`
- **现象**：
  - 吸附阈值 `stepLength·tan55° + 0.05` 与每帧步长成正比。144 fps 时走下 0.3 m 台阶或 0.42 m 阵盘，吸附会失败，`inAir` 来回翻转，下落动画一抽一抽。
  - 0.74 m 高的蒲团会在一帧内直接抬上去。
- **修法**：
  - 阈值改为 `Math.max(0.45, stepLength * DROP_GRADIENT + 0.05)`。
  - 上台阶时给角色加一个视觉 y 偏移，按指数衰减，避免一帧抬升。
- **验证**：144 fps 下走完祭坛台阶，`inAir` 不翻转。
- **工作量**：小

### C8 · P3 · 剑尾迹长度随帧率变化
- **位置**：`src/world/player/SwordWake.tsx:6`（`COUNT = 28`）、`:34`
- **现象**：
  - 尾迹固定 28 帧长：144 fps 时约 0.19 s，30 fps 时约 0.93 s。
  - 低于约 24 fps 加速俯冲时，每帧位移超过 8 m，尾迹每帧都被重置，看起来直接消失。
- **修法**：
  - 按时间采样：每 1/60 s 推入一个点，不足一个间隔时只更新队首点。
  - 重置阈值改为 `max(8, speed * dt * 2)`。
- **验证**：限帧 20 fps 加速俯冲，尾迹仍在；144 fps 时尾迹长度与 60 fps 相同。
- **工作量**：小

### C9 · P3 · 飞行下限与地面下限不一致
- **位置**：`FlightController.tsx:49`（−50）；`worldLayout.ts:49`（`TERRAIN_WALK_FLOOR = −60`）
- **现象**：在 −60 到 −50 之间的地面召剑，飞行第一帧会被推到 −50，跳变可达数米。
- **修法**：从 worldLayout 导出同一个下限常量，飞行和行走都用它，统一取 −60 即可。
- **工作量**：小

### C10 · 优化 · 同一帧重复查询地形
- `groundHeight` 单次约 4.2 µs，`terrainGradient` 约 8.5 µs，每帧合计 0.1–0.15 ms，不是瓶颈。
- 可以在同一帧、同一 xz 上缓存 `terrainHeight`，滑坡探测复用已经算出的 gradient。
- 可行走面只有 99 个，线性扫描约 1 µs，不需要加索引。
- 碰撞体已经有 32 m 网格索引（`surfaces.ts:24`），单次查询约 0.08 µs。

---

## 4. UI、交互、存档、音频、验证

### U1 · P0 · 灵光 id 按生成顺序编号，改布局后存档错位
- **位置**：`src/world/interact/orbs.ts:24`、`:49`、`:54`
- **现象**：id 是 `orb_${String(out.length).padStart(2, '0')}`（orb_00…orb_59），即列表里的序号。只要增减一根石柱、改变柱顶排序，或者某个浮岛的 24 次随机尝试没能放够 2 团，后面所有 id 都会整体错位。旧存档里的收集记录会悄悄落到别的灵光上。
- **修法**：
  1. 改成语义 id：`orb_road_${k}`、`orb_pillar_${pillarId}_${k}`、`orb_isle_${islandId}_${k}`、`orb_roof_${k}`、`orb_kun_${k}`。
  2. `SAVE_VERSION` 升到 2。在 `save.ts` 里冻结一张 v1 的「序号 → 新 id」映射表（由当前代码生成一次后写死），`loadSave` 读到 v1 时先迁移。
  3. DEV 下断言：每个浮岛恰好 2 团，总数等于预期（66）。随机放置失败时报错，而不是悄悄少放。
- **验证**：构造一份 v1 存档（收集了 orb_00、orb_30、orb_59），读档后逐个比对这些灵光的坐标，确认迁移到了原来那几团。
- **工作量**：中。**建议在加鲲背灵光之前做。**

### U2 · P0 · 开场界面无法用键盘进入游戏
- **位置**：`src/ui/useUiKeys.ts:16`；`Player.tsx:36`
- **现象**：
  - `useUiKeys` 对 Tab 一律 `preventDefault`，开场界面上 Tab 无法把焦点移到「进入仙宗」。
  - 这个按钮也没有 autoFocus。
  - `Player.tsx` 在窗口层对空格也 `preventDefault`，焦点在按钮上时按空格不会触发点击。
- **修法**：
  - 这两个监听器只在 `started && (locked || devInput)` 时拦截。
  - 焦点在 `.interface` 内的表单控件上时直接放行。
  - 开场按钮加 `autoFocus`。
- **验证**：刷新页面后只用 Tab / Enter / Space 能进入游戏。
- **工作量**：小

### U3 · P2 · 切到后台标签页后底噪一直响
- **位置**：`src/world/audio/mixer.ts:44`、`:76`
- **现象**：切到后台后 rAF 停止，但 AudioContext 还在运行。风声、雨声、飞行风声停在最后一帧的增益上，一直响着。
- **根因**：没有处理 `visibilitychange`；`setMuted` 只把增益置 0，从不 suspend。
- **修法**：在 mixer 里监听 `visibilitychange`：hidden 时 `context.suspend()`，visible 时 `resume()`。两个 Promise 都要有非空的 catch（例如记一次 `warn`）。
- **验证**：DEV 下切换标签页，读取 `context.state`。
- **工作量**：小

### U4 · P2 · verify:interact 有必然通过的断言
- **位置**：`scripts/verify-interact.mjs:105`
- **现象**：
  - 脚本开始时清空了存档，`autoWeather` 初始就是 true。
  - 在祭坛选天象不会把它置为 false，而是由 `MANUAL_HOLD` 暂留当前天象。
  - 所以即使「顺其自然」按钮坏了，"auto weather restored" 这一项也照样通过。
- **修法**：先通过 `__ui` 或 store 把 `autoWeather` 设为 false，再点按钮，断言它变回 true。
- **工作量**：小

### U5 · P2 · 存档没有迁移，坏档会被覆盖
- **位置**：`src/ui/save.ts:69`、`:77`
- **现象**：
  - 版本号不符时直接返回 null。
  - JSON 解析失败时只打一条 warn，下一次自动保存就覆盖了原数据，无法找回。
- **修法**：
  - 加迁移链 `migrate(data: unknown): SaveData | null`，按 `version` 逐级升级（U1 需要用到）。
  - 解析失败时先把原字符串备份到 `yunque.save.corrupt`，再从头开始。
- **验证**：手工写入坏 JSON，或者 `version: 0` 的存档，刷新后检查。
- **工作量**：小

### U6–U14 · P3

| ID | 位置 | 问题 | 修法 |
| --- | --- | --- | --- |
| U6 | `save.ts:102-103`、`:145` | localStorage 不可用时（隐私模式、配额满），每 8 秒 warn 一次，设置页底部仍写着「设置自动保存于本机」 | 第一次写入失败后置 `storageOk = false`，停止写入，只提示一次；底部文案按状态显示 |
| U7 | `src/world/weather/WeatherSystem.tsx:97` | Esc 暂停后，环境音、时钟、天象和闪电照常运行；`ambientAudio.update` 的注释写的是暂停时停止，与实际不符 | active 改为 `started && locked`。时钟在暂停时是否也停，需要产品决定；至少先改正注释 |
| U8 | `src/ui/ScrollOverlay.tsx:39`、`:44`、`:217` | 三个 tab 的 `aria-controls` 都指向 `scroll-panel-*`，但只渲染了当前面板；进度条没有可读名称 | 只给选中的 tab 设 `aria-controls`；每个 progressbar 加 `aria-label`（如「灵光 12/66」） |
| U9 | `verify-interact.mjs:161`、`:236`、`:238`；`scripts/smoke.mjs` | 灵光检查拿到 5 团里的 3 团就算通过；存档检查只看 key 是否存在；draw call 增量只打印、不断言；全程用 `setDevInput(true)` 绕过指针锁；smoke 没有断言，也不会非零退出；`verify-environment.mjs` 没有登记 | 灵光改为全部收到才通过；解析存档内容并断言 `orbs.length`，另加一轮「刷新 → 恢复」；draw call 增量设上限；smoke 加断言和退出码；登记 verify-environment |
| U10 | `src/ui/PhotoMode.tsx`、`photoExport.ts` | 锁定状态下按 Esc，会先解锁并打开设置，而不是退出拍照模式；导出文件名只精确到秒，1 秒内连拍两张会重名 | 拍照模式下失锁时直接退出拍照、不打开设置；文件名加毫秒或自增序号 |
| U11 | `src/app/App.tsx:96-99`；`src/app/styles.css:89` | HUD 右下角的声音和角色按钮几乎点不到：锁定时点击会进入画布，解锁 180 ms 后设置面板的遮罩（z-index 30）又盖住它们 | 把这两项移进设置菜单（加一行角色选择），HUD 上只保留显示 |
| U12 | `src/app/App.tsx:45`；`src/world/debug/DebugHud.tsx` | `Interface` 订阅了整个 `telemetry`，每秒重渲染约 4 次；调试面板关闭时 DebugHud 也在订阅 | 用细粒度 selector 只取需要的字段；`debug = false` 时不挂载 DebugHud |
| U13 | `src/world/interact/sounds.ts:4-10` | `output()` 每次播放都新建 GainNode，从不 disconnect | 在 source 的 `onended` 里断开，或者复用一个每通道的 GainNode |
| U14 | 其他 | 存档不保存所选角色；`ready` 判断里的 `=== 3` 是魔数；Chrome 在按 Esc 退出指针锁后约有 1 s 冷却，这期间点「继续」会锁定失败，而且没有提示 | 存档加上 `character`；`3` 提为具名常量；`requestLock` 失败时提示「请稍候再点继续」，也可以 1 s 后自动重试一次 |

---

## 5. 渲染、性能、资产

这一节由主会话定点检查（原计划的审查 agent 失败了）。覆盖面比前两节窄，建议之后补一次完整审查。

### R1 · P2 · 没有处理 WebGL 上下文丢失
- **现象**：`src` 里没有 `webglcontextlost` 的监听。驱动重置、显存耗尽或切换显卡后，画面会黑屏，而且没有任何提示。
- **修法**：
  - 在 Canvas 的 `onCreated` 里给 `gl.domElement` 挂 `webglcontextlost`，调用 `event.preventDefault()`，并显示遮罩「画面暂时中断，正在恢复…」。
  - 收到 `webglcontextrestored` 后，用递增的 key 重挂 `<Canvas>`，因为 R3F 不会自动重建所有 GPU 资源。最省事的办法是保存进度后 `location.reload()`（存档已有）。
- **验证**：DEV 下调用 `gl.getExtension('WEBGL_lose_context').loseContext()`，1 s 后再调用 `restoreContext()`。
- **工作量**：小

### R2 · P3 · 贴图没有 GPU 压缩格式
- **现象**：
  - 项目里没有用 KTX2 / Basis。WebP 和 JPEG 上传到 GPU 后都是 RGBA8，一张 2048² 的贴图连同 mipmap 约 22 MB 显存。
  - dist 中建筑 21 MB，角色 9 MB，道具 9.6 MB，贴图 7.2 MB。
- **修法**：
  - 用 `gltf-transform uastc`（法线、ORM 贴图）和 `etc1s`（颜色贴图）给建筑与角色贴图出一份 KTX2。
  - drei 的 `useGLTF` 接上 `KTX2Loader`：设置 transcoder 路径，把 basis 转码器打包进本地 public，不用 CDN。
  - 地形的 texture array 在 worker 里解码；这一步可以之后单独再做。
- **预期**：显存约降为原来的 1/4 到 1/6，文件体积与 WebP 相当。收益主要在低端显卡上。
- **验证**：用 `renderer.info.memory` 和 Chrome 任务管理器的 GPU 内存做前后对比；截图与现在逐项比对。
- **工作量**：中

### R3 · P3 · 首屏 JS 没有代码分割
- **现象**：`src` 里没有 `lazy()` 或动态 `import()`。拍照模式、卷轴、运镜、天象特效都打在首包里，index 405 kB（gzip 153 kB）。
- **修法**：用 `React.lazy` 加载 `PhotoMode`、`ScrollOverlay`、`cinematics`，放在 `<Suspense fallback={null}>` 里；`@react-three/postprocessing` 放进 PostFX 的动态 chunk。
- **预期**：首包减少约 60–120 kB（gzip 20–40 kB）。与约 45 MB 的资产相比收益有限，所以排在后面。
- **工作量**：小

### R4 · P3 · 没有低端设备的性能基线
- **现象**：`verify:perf` 只在 RTX 5060 Ti 上测 draw call 和 FPS。建筑仍约千万三角面，低端机的瓶颈不清楚。
- **修法**：
  - verify:perf 增加一个 `CPU_THROTTLE=4` 选项（CDP 的 `Emulation.setCPUThrottlingRate`）。
  - 加一组「流畅档 + 1280×720」的采样，并记录 `renderer.info.render.triangles`。
  - 可选：用 `EXT_disjoint_timer_query_webgl2` 采集 GPU 帧时间，分别算出云海 raymarch、N8AO、GodRays 各自占多少。
- **工作量**：中

### R5 · 优化 · 远景 LOD1 不投影
- 这一项 R7c 没有做，因为当时余量已经够了。draw call 回升到 350 以上时再做：给 LOD1 级别设 `castShadow = false`，可以减少远处级联的阴影调用。

---

## 6. 文档与工程

| ID | 问题 | 修法 |
| --- | --- | --- |
| E1 | `OPTIMIZATION.md` 仍是 R5 之前的数据：步行 3.2 / 奔跑 7 m/s、御剑 30 / 70 m/s；当前是慢跑 5.5 / 冲刺 10、巡航 45 / 加速 140。README 链接到这份文档，读者会被误导 | 在标题下注明「R5 之前的历史记录，现行参数见 README」，或者改正各项参数 |
| E2 | `package.json` 有一处未提交的改动（`megascale-sect-mvp` → `megascale-sect`），与当前任务无关，每次提交都要手动避开 | 单独提交：`chore: rename the package`；如果不想要，就 `git checkout package.json` 撤销 |
| E3 | 验证脚本默认的 `CHROME_PATH` 是 Windows 路径，其他机器要手动指定 | 按 `process.platform` 选默认路径（macOS 用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`），找不到时给出明确报错 |
| E4 | `progress.md` 和 `PROGRESS.md` 在不区分大小写的文件系统上是同一个文件 | 保持现状，只用 `PROGRESS.md`（task_plan.md 里已经记过） |
| E5 | README 的 verify:interact「37 项」会随 U4 / U9 的修改变化 | 改完后同步更新项数 |

---

## 7. 长期限制（目前接受）

- 长袍和头发依赖自动蒙皮，没有布料模拟。大幅动作时可能穿插，极限步幅的末段仍有少量滑步。
- 主殿按屋顶高度场碰撞，檐下空间算作实心；没有室内场景。
- 悬索桥与仙岛衔接处有 0.36–0.5 m 的视觉台阶（行走面是连续的）。
- 远处的石柱轮廓偏圆润。
- 山门和侧塔没有精细的镜头碰撞。
- three 和 r3f 两个分包各约 760 / 810 kB。
- 主平台没有切成分层台地（见 R7d 的决策）。
- 如果要继续推进这些限制，按以下方向：
  - 布料：给长袍下摆加 2–3 根弹簧骨链（verlet），不做完整布料。
  - 远景石柱：LOD1 加细节法线贴图。
  - 室内：需要新的主殿室内模型，Tripo 不适合，工作量大。

---

## 8. 建议执行顺序

1. **修起跳并提交**：J1、J2，顺带改 J5、J6 的注释。复跑 tsc、build、verify:characters、riding-pose、optimization，然后提交起跳阶段（只暂存那 9 个文件）。
2. **输入与键盘**：C1、C2、U2。一起改，然后复跑 verify:interact 和 verify:characters。
3. **存档**：U1、U5，然后 U6。必须在鲲背灵光之前做。
4. **鲲背**：按 §2 分四步提交：
   1. 鲲背数据与查询；
   2. 随鲲移动与上下鲲规则；
   3. 鲲背灵光；
   4. verify-kun 与文档。
5. **手感**：C3、C4、C5、J3、J4、C6–C9。
6. **健壮性**：U3、U4、R1，然后其余 U 项和 E 项。
7. **性能**：R4（先建基线），再按数据决定是否做 R2、R3、R5。

每一步完成后：跑相关的 verify，做一次独立审查，再按 `<type>(<scope>): <description>` 提交。不要暂存 `package.json`，除非是在处理 E2。
