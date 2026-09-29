import { createI18n } from 'vue-i18n'
import { LanguageEnum } from '@/enums/appEnum'
import enMessages from './langs/en.json'
import zhMessages from './langs/zh.json'

export const languageOptions = [
  { value: LanguageEnum.ZH, label: '简体中文' },
  { value: LanguageEnum.EN, label: 'English' }
]
function readLanguage(): LanguageEnum {
  try {
    const saved = JSON.parse(localStorage.getItem('emr-ui-v1-preferences') || '{}')
    return saved.language === LanguageEnum.EN ? LanguageEnum.EN : LanguageEnum.ZH
  } catch {
    return LanguageEnum.ZH
  }
}
const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: readLanguage(),
  fallbackLocale: LanguageEnum.ZH,
  messages: { zh: zhMessages, en: enMessages }
})
export const $t = i18n.global.t
export default i18n
