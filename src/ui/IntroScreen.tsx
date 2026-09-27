import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { SITES } from '../world/interact/registry'
import { useWorldStore } from '../world/store'
import { CharacterPicker } from './CharacterPicker'
import { useStorageStatus, type SavedPosition } from './save'
import { ORB_COUNT } from '../world/interact/orbs'
import { worldAssetsReady } from '../world/worldAssets'

const ART = `/assets/references/${encodeURIComponent('主概念图')}.png`
const GUIDE: [string, string][] = [
  ['W A S D', '行走'], ['鼠标', '视角'], ['F', '召剑御空'], ['E', '交互'], ['Tab', '卷轴舆图'], ['Esc', '暂停设置'],
]

/** Where a saved journey stopped, named after the closest landmark. */
function placeName(position: SavedPosition) {
  let best = SITES[0], bestDistance = Infinity
  for (const site of SITES) {
    const d = Math.hypot(site.position[0] - position.x, site.position[2] - position.z)
    if (d < bestDistance) { best = site; bestDistance = d }
  }
  return bestDistance < 60 ? `${best.name}旁` : `${best.name}一带`
}

/**
 * Title and loading screen over the concept art: a real asset-progress bar, the operation guide,
 * character choice and (when a save exists) an offer to resume where the last journey stopped.
 */
export function IntroScreen({ saved, onEnter }: { saved: SavedPosition | null; onEnter: (resume: SavedPosition | null) => void }) {
  const storage = useStorageStatus()
  const { progress, active } = useProgress()
  const ready = useWorldStore((state) => worldAssetsReady(state.assets))
  const characterReady = useWorldStore((state) => state.characterReady[state.character])
  const [resume, setResume] = useState(saved !== null)
  const loaded = ready && characterReady
  const enterButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (loaded) enterButton.current?.focus() }, [loaded])
  const percent = loaded ? 100 : Math.min(99, Math.round(progress))
  return <div className="intro-screen" data-ready={loaded}>
    <div className="intro-art" style={{ backgroundImage: `url("${ART}")` }} aria-hidden="true" />
    <div className="intro-panel">
      <div className="intro-kicker"><span /> 云端 · 巨构实境漫游</div>
      <h1>入山，<br /><em>见天地。</em></h1>
      <p>以一人之躯，丈量四百二十米的云阙。沿石道穿过山门，登阶入宗，或御剑绕行高殿；研读碑文，远眺云海，拾取散落的 {ORB_COUNT} 道灵光。</p>
      <CharacterPicker />
      <div className="intro-load" aria-busy={!loaded}>
        <div className="intro-load-bar" role="progressbar" aria-label="仙宗载入进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <small>{loaded ? '山门已开 · READY' : active ? `正在凝聚山川云气… ${percent}%` : '正在准备世界…'}</small>
      </div>
      {storage !== 'ok' && <p role="status" className="intro-storage">{storage === 'protected' ? '已有存档版本暂不支持，已保留原档并暂停保存。' : '本机存储不可用，本次进度未能保存。'}</p>}
      {saved && <button className="intro-resume" aria-pressed={resume} onClick={() => setResume(!resume)}>
        <i aria-hidden="true" />从上次停留处继续 · {placeName(saved)}
      </button>}
      <button ref={enterButton} autoFocus className="enter-button" onClick={() => onEnter(resume ? saved : null)} disabled={!loaded}>
        {loaded ? '进入仙宗' : `载入仙宗 ${percent}%`} <span>→</span>
      </button>
      <ul className="intro-guide" aria-label="操作说明">
        {GUIDE.map(([key, action]) => <li key={key}><kbd>{key}</kbd>{action}</li>)}
      </ul>
      <div className="intro-meta"><span>MG01 · 主殿 420m</span><span>MG02 · 山门 56m</span><span>MG04 · 侧塔 6座</span></div>
    </div>
    <div className="intro-side">WORLD 01 <span>—</span> YUNQUE SECT</div>
  </div>
}
