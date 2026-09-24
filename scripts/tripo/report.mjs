// Writes asset-pipeline/tripo/REPORT.md from manifest.json + manifest.lock.json (+ live balance).
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { balance } from './client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'scripts/tripo/manifest.json'), 'utf8'))
const lock = JSON.parse(readFileSync(path.join(ROOT, 'scripts/tripo/manifest.lock.json'), 'utf8'))
const credits = (a) => (a.credits?.total ?? 0) + (a.history ?? []).reduce((n, h) => n + (h.credits?.total ?? 0), 0)
const kb = (b) => (b ? `${Math.round(b / 1024)}` : '–')
const now = await balance().catch(() => null)

const rows = manifest.assets.map((e) => {
  const a = lock.assets?.[e.id]
  const f = lock.failures?.[e.id]
  if (!a) return `| ${e.id} | ${e.name_zh} | – | – | – | – | – | – | ${f ? `FAILED: ${f.error.replace(/\|/g, '/')}` : 'not generated'} |`
  const lod1 = a.lod1 ? `${a.lod1.triangles} / ${kb(a.lod1.bytes)}` : '–'
  const note = a.status === 'ok' ? 'ok' : `${a.status}${a.note ? `: ${a.note}` : ''}`
  const via = a.tasks.modelType === 'text_to_model' ? ' (text-to-model fallback)' : ''
  return `| ${e.id} | ${e.name_zh} | ${a.raw.triangles} | ${a.lod0.triangles} / ${kb(a.lod0.bytes)} | ${lod1} | ${a.bbox.size.join(' × ')} | ${e.heightM} (×${a.scaleToHeight})${a.widthM ? `; 宽 ${a.widthM} (×${a.scaleToWidth})` : ""} | ${credits(a)} | ${note}${via} |`
})
const done = manifest.assets.filter((e) => lock.assets?.[e.id])
const total = done.reduce((s, e) => s + credits(lock.assets[e.id]), 0)
const retried = done.filter((e) => (lock.assets[e.id].tasks.attempts?.length ?? 0) > 1)
const regenerated = done.filter((e) => lock.assets[e.id].history?.length)
const fallbacks = done.filter((e) => lock.assets[e.id].tasks.modelType === 'text_to_model')
const runs = lock.runs ?? []
const first = runs.find((r) => !r.optimizeOnly)
const lines = [
  '# Tripo 道具批次报告 (props batch 1)',
  '',
  `生成时间 ${new Date().toISOString()}；图像模型 \`seedream_v5\`，3D 模型 \`${done[0] ? lock.assets[done[0].id].modelVersion : 'v3.1-20260211'}\`，纹理 \`${done[0] ? lock.assets[done[0].id].textureVersion : '-'}\`，texture_quality=detailed, PBR on。`,
  '',
  '坐标约定：+Y 向上，底部 y=0，x/z 以包围盒中心居中；Tripo 默认导出朝向 +X（正面朝 +X，例如牌坊的宽度方向是 Z）。LOD0 保留 Tripo 原始面数，LOD1 由 meshopt simplify 生成（lod1Ratio），与 LOD0 共用同一 pivot（切换时不跳动），因此个别 LOD1 的最低点被简化掉后会高出 y=0 约 0.2–0.4% 高度（浮岛B 底尖缩短约 3%，悬空不影响）。',
  '',
  'bbox 为优化后 LOD0 的文件单位尺寸 (x × y × z，底部 y=0，x/z 居中)；`heightM (×s)` 为目标真实高度及游戏内应乘的统一缩放 s = heightM / bbox.y；带“宽”的资产（传送阵/浮岛A/仙鹤）另给出按宽度（max(x,z)）的缩放，二者比例与模型实际比例不同时游戏需二选一。KB 为 meshopt + WebP 后的文件大小。',
  '',
  '| id | 名称 | raw 三角面 | LOD0 三角面 / KB | LOD1 三角面 / KB | bbox (文件单位) | heightM (×缩放) | credits | 状态 |',
  '|---|---|---:|---:|---:|---|---|---:|---|',
  ...rows,
  '',
  `**合计 credits（锁文件记录）：${total}**（${done.length}/${manifest.assets.length} 个资产完成）`,
  '',
  `余额：首次运行前 ${first?.balanceBefore ?? '–'}，当前 ${now ? `${now.balance}（冻结 ${now.frozen}）` : '–'}。`,
  '',
  '## 重试 / 回退 / 失败',
  '',
  retried.length ? retried.map((e) => `- ${e.id}：首个结果异常（${lock.assets[e.id].tasks.attempts[0].broken}），已用调整后的 prompt 重试一次。`).join('\n') : '- 无自动重试。',
  ...regenerated.map((e) => `- ${e.id}：已手动 --force 重生成 ${lock.assets[e.id].history.length} 次（旧任务 ${lock.assets[e.id].history.map((h) => h.tasks.model).join(", ")}，旧文件备份在 asset-pipeline/tripo/${e.id}/v1/）；credits 已计入。`),
  fallbacks.length ? fallbacks.map((e) => `- ${e.id}：image-to-model 两次失败，回退 text-to-model（${lock.assets[e.id].tasks.imageToModelFailures.join('; ')}）。`).join('\n') : '- 无 text-to-model 回退。',
  Object.values(lock.failures ?? {}).length ? Object.values(lock.failures).map((f) => `- ${f.id} 失败：${f.error}`).join('\n') : '- 无失败。',
  '',
  '## 运行记录',
  '',
  ...runs.map((r) => `- ${r.startedAt} → ${r.finishedAt ?? '未结束'}：${r.ids.join(', ')}${r.optimizeOnly ? '（仅重新优化）' : ''}；余额 ${r.balanceBefore} → ${r.balanceAfter ?? '?'}（花费 ${r.spent ?? '?'}）`),
  '',
]
writeFileSync(path.join(ROOT, 'asset-pipeline/tripo/REPORT.md'), lines.join('\n'))
console.log(`REPORT.md written: ${done.length} assets, ${total} credits`)
