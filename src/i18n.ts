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
      loading: 'טוען...',
      signInWithGoogle: 'התחברות עם Google',
      signOut: 'התנתקות',
      greeting: 'שלום, {{name}}',
      signInError: 'ההתחברות נכשלה. נסה שוב.',
      createRoom: 'פתיחת חדר',
      creatingRoom: 'פותח חדר...',
      createRoomError: 'לא הצלחנו לפתוח חדר. נסה שוב.',
      roomCodeLabel: 'קוד החדר: {{code}}',
      copyLink: 'העתקת קישור להצטרפות',
      yourNamePrompt: 'איך קוראים לך?',
      yourNamePlaceholder: 'השם שלך',
      joinButton: 'הצטרפות',
      joining: 'מצטרף...',
      joinError: 'לא הצלחנו להצטרף. נסה שוב.',
      roomNotFound: 'החדר לא נמצא. ודא שהקישור נכון.',
      lobbyWaiting: 'ממתינים שהמארח יתחיל את הערב...',
      youSuffix: '(את/ה)',
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
