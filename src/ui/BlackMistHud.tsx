import { useEffect, useRef, useState } from 'react'
import {
  beginBlackMistExploration,
  resetBlackMist,
  setBlackMistPaused,
  skipBlackMistCinematic,
  useBlackMistStore,
} from '../world/blackMist/runtime'
import { useWorldStore } from '../world/store'
import { useTranslation } from './i18n'
import { useUiStore } from './uiStore'
import './blackMist.css'
import { retryEldritchAssets, useEldritchLoadingStore } from '../world/blackMist/eldritchLoading'

const CAPTIONS = {
  horizon: { title: '天边异象', text: '天边，出现了第二片云海。', chapter: 'I' },
  approach: { title: '黑潮迫近', text: '它遮住日光，也吞没群山。', chapter: 'II' },
  impact: { title: '千年钟声', text: '千年钟声，被黑潮截断。', chapter: 'III' },
  transformation: { title: '天地易形', text: '云阙，正在醒成另一种模样。', chapter: 'IV' },
  aftermath: { title: '异境初醒', text: '黑雾未散，前路仍在。', chapter: 'V' },
} as const

/** Only phase boundaries and user actions render React; the scene owns the continuous mist timeline. */
export function BlackMistHud() {
  const t = useTranslation()
  const active = useWorldStore((state) => state.started && state.gameMode === 'black-mist')
  const soundEnabled = useWorldStore((state) => state.soundEnabled)
  const cameraMode = useWorldStore((state) => state.cameraMode)
  const playerStable = useWorldStore((state) => state.phase === 'GROUND' || state.phase === 'FLIGHT')
  const locked = useWorldStore((state) => state.locked)
  const hidden = useUiStore((state) => state.hudHidden)
  const overlay = useUiStore((state) => state.overlay)
  const phase = useBlackMistStore((state) => state.phase)
  const cinematic = useBlackMistStore((state) => state.cinematic)
  const manualPaused = useBlackMistStore((state) => state.manualPaused)
  const awaitingExplore = useBlackMistStore((state) => state.awaitingExplore)
  const assetStatus = useEldritchLoadingStore((state) => state.status)
  const [showGuide, setShowGuide] = useState(true)
  const skipButton = useRef<HTMLButtonElement>(null)
  const exploreButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!active || manualPaused || hidden || overlay) return
    if (cinematic) {
      setShowGuide(true)
      skipButton.current?.focus({ preventScroll: true })
    } else if (awaitingExplore) {
      exploreButton.current?.focus({ preventScroll: true })
    }
  }, [active, cinematic, manualPaused, awaitingExplore, hidden, overlay, assetStatus])
  useEffect(() => {
    if (!active || cinematic || awaitingExplore) return
    const timer = window.setTimeout(() => setShowGuide(false), 14000)
    return () => window.clearTimeout(timer)
  }, [active, cinematic, awaitingExplore])
  if (!active || hidden || overlay || (!cinematic && cameraMode !== 'player')) return null
  const caption = CAPTIONS[phase]
  const explore = () => {
    setShowGuide(false)
    beginBlackMistExploration()
  }
  if (cinematic)
    return (
      <div className="black-mist-cinema" data-phase={phase} data-paused={manualPaused}>
        <div className="black-mist-matte black-mist-matte-top" aria-hidden="true" />
        <div className="black-mist-matte black-mist-matte-bottom" aria-hidden="true" />
        <header className="black-mist-cinema-heading">
          <span>{t('云阙仙宗')}</span>
          <i aria-hidden="true" />
          <strong>{t('黑雾入侵')}</strong>
        </header>
        <div className="black-mist-cinema-actions" aria-label={t('过场操作')}>
          <button
            aria-label={t('过场音效')}
            aria-pressed={soundEnabled}
            onClick={() => useWorldStore.getState().toggleSound()}
          >
            {t(soundEnabled ? '音效开' : '音效关')}
          </button>
          <button onClick={() => setBlackMistPaused(true)}>
            {t('设置')} <kbd aria-hidden="true">Esc</kbd>
          </button>
          <button
            ref={skipButton}
            className="black-mist-skip"
            disabled={assetStatus !== 'ready'}
            aria-label={t('跳过过场，进入异变世界')}
            onClick={skipBlackMistCinematic}
          >
            {t('跳过过场')} <kbd aria-hidden="true">Space</kbd>
          </button>
        </div>
        <div key={phase} className="black-mist-caption" role="status" aria-live="polite" aria-atomic="true">
          <small>
            <span aria-hidden="true">{caption.chapter} / </span>
            {t(caption.title)}
          </small>
          <p>{t(caption.text)}</p>
        </div>
        {assetStatus !== 'ready' && !manualPaused && (
          <section
            className="black-mist-asset-status"
            role={assetStatus === 'error' ? 'alert' : 'status'}
            aria-live="polite"
          >
            <strong>{t(assetStatus === 'error' ? '异境暂未显现' : '正在凝聚异境…')}</strong>
            <p>
              {t(
                assetStatus === 'error'
                  ? '异境景物未能载入。请重试，过场会从停留之处继续。'
                  : '正在准备宗门异变，画面就绪后将自动继续。',
              )}
            </p>
            {assetStatus === 'error' && (
              <button autoFocus onClick={retryEldritchAssets}>
                {t('重新载入异境')}
              </button>
            )}
          </section>
        )}
      </div>
    )
  return (
    <div className="black-mist-aftermath">
      <div className="black-mist-world-state" aria-label={t('世界状态')}>
        <i aria-hidden="true" />
        <span>{t('云阙 · 异变之境')}</span>
        <button
          onClick={resetBlackMist}
          disabled={!playerStable}
          title={!playerStable ? t('请等当前动作结束后重看过场') : undefined}
        >
          {t('重看过场')}
        </button>
      </div>
      {(awaitingExplore || (showGuide && locked)) && (
        <section className="black-mist-handoff" aria-label={t('异境探索')}>
          <small>{t('异境初醒')}</small>
          <h2>{t('黑雾未散，前路仍在。')}</h2>
          <p>{t('步行或御剑，重访异变后的宗门；也可以用镜头记录这片天地。')}</p>
          <p>{t('异变组织会感知你的靠近。留意蓄势，及时躲开；被击中后将在最近的传送阵复活。此境不采集灵光。')}</p>
          {awaitingExplore ? (
            <button ref={exploreButton} className="black-mist-explore" onClick={explore}>
              {t('探索异变世界')} <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button className="black-mist-dismiss" aria-label={t('收起探索提示')} onClick={() => setShowGuide(false)}>
              {t('收起')}
            </button>
          )}
        </section>
      )}
    </div>
  )
}
