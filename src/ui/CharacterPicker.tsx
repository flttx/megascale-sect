import { CHARACTER_ASSETS } from '../world/player/characterAssets'
import type { CharacterId } from '../world/player/characterAssets'
import { useWorldStore } from '../world/store'
import { useTranslation } from './i18n'

const IDS: CharacterId[] = ['male', 'female']

export function CharacterPicker() {
  const t = useTranslation()
  const character = useWorldStore((state) => state.character)
  const phase = useWorldStore((state) => state.phase)
  const select = useWorldStore((state) => state.selectCharacter)
  return <div className="character-picker" role="group" aria-label={t('选择角色')}>
    {IDS.map((id) => <button key={id}
      aria-pressed={character === id} disabled={!['GROUND', 'FLIGHT'].includes(phase)}
      onClick={() => select(id)}><kbd>{CHARACTER_ASSETS[id].key}</kbd>{t(CHARACTER_ASSETS[id].name)}</button>)}
  </div>
}
