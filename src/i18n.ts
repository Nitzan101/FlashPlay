import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

/**
 * i18n infrastructure exists from day one so no UI string is ever hardcoded,
 * but Hebrew is the only shipped locale. See DESIGN: prompts and game content
 * are written in Hebrew from the start and are not translations, so adding a
 * language later is a content decision rather than a code refactor.
 */
export const resources = {
  he: {
    translation: {
      appName: 'FlashPlay',
      tagline: 'משחקים שנבנים מהאנשים שבחדר',
    },
  },
} as const

export const defaultLocale = 'he'

void i18n.use(initReactI18next).init({
  resources,
  lng: defaultLocale,
  fallbackLng: defaultLocale,
  interpolation: { escapeValue: false },
})

export default i18n
