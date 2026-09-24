# Tripo 道具批次报告 (props batch 1)

生成时间 2026-09-24T05:37:58.706Z；图像模型 `seedream_v5`，3D 模型 `v3.1-20260211`，纹理 `v3.5-20260815`，texture_quality=detailed, PBR on。

坐标约定：+Y 向上，底部 y=0，x/z 以包围盒中心居中；Tripo 默认导出朝向 +X（正面朝 +X，例如牌坊的宽度方向是 Z）。LOD0 保留 Tripo 原始面数，LOD1 由 meshopt simplify 生成（lod1Ratio），与 LOD0 共用同一 pivot（切换时不跳动），因此个别 LOD1 的最低点被简化掉后会高出 y=0 约 0.2–0.4% 高度（浮岛B 底尖缩短约 3%，悬空不影响）。

bbox 为优化后 LOD0 的文件单位尺寸 (x × y × z，底部 y=0，x/z 居中)；`heightM (×s)` 为目标真实高度及游戏内应乘的统一缩放 s = heightM / bbox.y；带“宽”的资产（传送阵/浮岛A/仙鹤）另给出按宽度（max(x,z)）的缩放，二者比例与模型实际比例不同时游戏需二选一。KB 为 meshopt + WebP 后的文件大小。

| id | 名称 | raw 三角面 | LOD0 三角面 / KB | LOD1 三角面 / KB | bbox (文件单位) | heightM (×缩放) | credits | 状态 |
|---|---|---:|---:|---:|---|---|---:|---|
| pine_guest | 迎客松 | 19169 | 19169 / 501 | 5607 / 147 | 1 × 0.754 × 0.997 | 14 (×18.568) | 45 | ok |
| pine_tall | 高松 | 19702 | 19702 / 530 | 4916 / 114 | 0.609 × 1 × 0.71 | 18 (×18) | 45 | ok |
| pine_small | 小松 | 14767 | 14767 / 508 | 2953 / 98 | 0.79 × 1 × 0.966 | 6 (×6) | 45 | ok |
| bamboo | 竹丛 | 15190 | 15190 / 539 | 6084 / 194 | 0.584 × 1 × 0.808 | 8 (×8) | 45 | ok |
| rock_scholar | 太湖石 | 11940 | 11940 / 490 | 1996 / 89 | 0.197 × 1 × 0.428 | 3.5 (×3.5) | 45 | ok |
| rock_moss | 苔石 | 9760 | 9760 / 527 | 2062 / 92 | 0.789 × 0.376 × 1 | 2 (×5.319) | 45 | ok |
| stone_lantern | 石灯笼 | 9239 | 9239 / 508 | 2316 / 113 | 0.424 × 1 × 0.406 | 2.4 (×2.4) | 45 | ok |
| lantern_post | 灯柱宫灯 | 10841 | 10841 / 412 | 2164 / 85 | 0.253 × 1 × 0.528 | 4.5 (×4.5) | 45 | ok |
| banner_pole | 旗幡 | 7620 | 7620 / 416 | 1904 / 84 | 0.289 × 1 × 0.284 | 10 (×10) | 45 | ok |
| incense_burner | 香炉鼎 | 10954 | 10954 / 424 | – | 0.701 × 1 × 0.856 | 3 (×3) | 45 | ok |
| stone_lion | 石狮 | 15708 | 15708 / 512 | 3141 / 83 | 0.482 × 1 × 0.586 | 3.2 (×3.2) | 45 | ok |
| pavilion | 八角亭 | 36781 | 36781 / 1142 | 7868 / 273 | 0.941 × 1 × 0.984 | 9 (×9) | 45 | ok |
| pailou | 牌坊 | 37552 | 37552 / 1216 | 7508 / 226 | 0.227 × 0.55 × 1 | 12 (×21.818) | 45 | ok |
| stele_turtle | 赑屃碑 | 15005 | 15005 / 526 | – | 0.422 × 1 × 0.685 | 4.5 (×4.5) | 45 | ok |
| bell_frame | 古钟 | 18755 | 18755 / 480 | – | 0.783 × 1 × 0.731 | 6 (×6) | 45 | ok |
| teleport_array | 传送阵 | 29246 | 29246 / 978 | – | 0.997 × 0.227 × 1 | 2 (×8.811); 宽 10 (×10) | 45 | ok |
| spirit_crystal | 灵石 | 9490 | 9490 / 298 | 1898 / 59 | 0.708 × 1 × 0.809 | 2.5 (×2.5) | 45 | ok |
| crane | 仙鹤 | 9882 | 9882 / 239 | 2470 / 68 | 0.637 × 0.297 × 1 | 0.8 (×2.694); 宽 2.2 (×2.2) | 90 | ok |
| weather_altar | 祭坛 | 18648 | 18648 / 465 | – | 1 × 0.595 × 0.998 | 4 (×6.723) | 45 | ok |
| meditation_platform | 蒲团台 | 7824 | 7824 / 275 | 1560 / 56 | 0.998 × 0.34 × 1 | 0.8 (×2.353) | 45 | ok |
| floating_isle_a | 浮岛A | 37567 | 37567 / 1360 | 7494 / 189 | 0.969 × 0.882 × 1 | 18 (×20.408); 宽 35 (×35) | 45 | ok |
| floating_isle_b | 浮岛B | 29418 | 29418 / 1092 | 5855 / 167 | 0.934 × 1 × 0.964 | 12 (×12) | 45 | ok |

**合计 credits（锁文件记录）：1035**（22/22 个资产完成）

余额：首次运行前 20345，当前 19310（冻结 0）。

## 重试 / 回退 / 失败

- 无自动重试。
- crane：已手动 --force 重生成 1 次（旧任务 25852157-fa34-4676-863f-9219c104005c，旧文件备份在 asset-pipeline/tripo/crane/v1/）；credits 已计入。
- 无 text-to-model 回退。
- 无失败。

## 运行记录

- 2026-09-24T05:11:43.031Z → 2026-09-24T05:14:45.524Z：stone_lantern；余额 20345 → 20300（花费 45）
- 2026-09-24T05:15:43.980Z → 2026-09-24T05:15:44.940Z：stone_lantern（仅重新优化）；余额 20300 → 20300（花费 0）
- 2026-09-24T05:15:54.905Z → 2026-09-24T05:31:37.461Z：pine_guest, pine_tall, pine_small, bamboo, rock_scholar, rock_moss, lantern_post, banner_pole, incense_burner, stone_lion, pavilion, pailou, stele_turtle, bell_frame, teleport_array, spirit_crystal, crane, weather_altar, meditation_platform, floating_isle_a, floating_isle_b；余额 20300 → 19355（花费 945）
- 2026-09-24T05:33:02.298Z → 2026-09-24T05:33:21.702Z：pine_guest, pine_tall, pine_small, bamboo, rock_scholar, rock_moss, stone_lantern, lantern_post, banner_pole, incense_burner, stone_lion, pavilion, pailou, stele_turtle, bell_frame, teleport_array, spirit_crystal, crane, weather_altar, meditation_platform, floating_isle_a, floating_isle_b（仅重新优化）；余额 19355 → 19355（花费 0）
- 2026-09-24T05:33:34.128Z → 2026-09-24T05:36:23.107Z：crane；余额 19355 → 19310（花费 45）
