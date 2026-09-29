import { useUiStore } from './uiStore'

export function LanguagePicker() {
  const language = useUiStore((state) => state.language)
  const setLanguage = useUiStore((state) => state.setLanguage)
  return <div className="segmented language-picker" role="group" aria-label={language === 'en' ? 'Language' : '语言'}>
    <button aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button>
    <button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English</button>
  </div>
}