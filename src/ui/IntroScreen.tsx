import { useEffect, useRef, useState } from 'react'
import { useProgress } from '@react-three/drei'
import { SITES } from '../world/interact/registry'
import { useWorldStore } from '../world/store'
import { CharacterPicker } from './CharacterPicker'
import { useStorageStatus, type SavedPosition } from './save'
import { ORB_COUNT } from '../world/interact/orbs'
import { worldAssetsReady } from '../world/worldAssets'
import { useTranslation } from './i18n'
import { LanguagePicker } from './LanguagePicker'

const ART = `/assets/references/${encodeURIComponent('主概念图')}.png`
const GUIDE: [string, string][] = [
  ['W A S D', '行走'], ['鼠标', '视角'], ['F', '召剑御空'], ['E', '交互'], ['Tab', '卷轴舆图'], ['Esc', '暂停设置'],
]

/** Where a saved journey stopped, named after the closest landmark. */
function placeName(position: SavedPosition, t: ReturnType<typeof useTranslation>) {
  let best = SITES[0], bestDistance = Infinity
  for (const site of SITES) {
    const d = Math.hypot(site.position[0] - position.x, site.position[2] - position.z)
    if (d < bestDistance) { best = site; bestDistance = d }
  }
  const name = t(best.name)
  return bestDistance < 60 ? t('在{place}附近', { place: name }) : t('{place}一带', { place: name })
}

/**
 * Title and loading screen over the concept art: a real asset-progress bar, the operation guide,
 * character choice and (when a save exists) an offer to resume where the last journey stopped.
 */
export function IntroScreen({ saved, onEnter }: { saved: SavedPosition | null; onEnter: (resume: SavedPosition | null) => void }) {
  const t = useTranslation()
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
    <div className="intro-language"><LanguagePicker /></div>
    <div className="intro-panel">
      <div className="intro-kicker"><span /> {t('云端 · 巨构实境漫游')}</div>
      <h1>{t('入云阙，')}<br /><em>{t('见云海。')}</em></h1>
      <p>{t('登临四百二十米云阙，步行或御剑探索，寻访碑文与云海，收集 {count} 道灵光。', { count: ORB_COUNT })}</p>
      <CharacterPicker />
      <div className="intro-load" aria-busy={!loaded}>
        <div className="intro-load-bar" role="progressbar" aria-label={t('仙宗载入进度')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <small>{loaded ? t('山门已开 · READY') : active ? t('正在凝聚山川云气… {percent}%', { percent }) : t('正在准备世界…')}</small>
      </div>
      {storage !== 'ok' && <p role="status" className="intro-storage">{t(storage === 'protected' ? '已有存档版本暂不支持，已保留原档并暂停保存。' : '本机存储不可用，本次进度未能保存。')}</p>}
      {saved && <button className="intro-resume" aria-pressed={resume} onClick={() => setResume(!resume)}>
        <i aria-hidden="true" />{t('继续旅程 · {place}', { place: placeName(saved, t) })}
      </button>}
      <button ref={enterButton} autoFocus className="enter-button" onClick={() => onEnter(resume ? saved : null)} disabled={!loaded}>
        {loaded ? t('进入仙宗') : t('载入仙宗 {percent}%', { percent })} <span>→</span>
      </button>
      <ul className="intro-guide" aria-label={t('操作说明')}>
        {GUIDE.map(([key, action]) => <li key={key}><kbd>{t(key)}</kbd>{t(action)}</li>)}
      </ul>
      <div className="intro-meta"><span>MG01 · {t('主殿 420m')}</span><span>MG02 · {t('山门 56m')}</span><span>MG04 · {t('侧塔 6座')}</span></div>
    </div>
    <div className="intro-side">WORLD 01 <span>—</span> YUNQUE SECT</div>
  </div>
}
