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
      loadingSlow: 'זה לוקח יותר מהרגיל...',
      signInWithGoogle: 'התחברות עם Google',
      signOut: 'התנתקות',
      greeting: 'שלום, {{name}}',
      // Error/progress copy is deliberately gender-neutral (plural or
      // impersonal), matching the `(את/ה)` choice already made for players -
      // these are exactly the screens where someone is having a bad moment.
      signInError: 'ההתחברות נכשלה. אפשר לנסות שוב.',
      createRoom: 'פתיחת חדר',
      creatingRoom: 'פותחים חדר...',
      createRoomError: 'אי אפשר לפתוח חדר כרגע.',
      roomCodeLabel: 'קוד החדר: {{code}}',
      roomLinkLabel: 'קישור להצטרפות',
      copyLink: 'העתקת קישור',
      linkCopied: 'הועתק!',
      copyFailed: 'אי אפשר להעתיק - אפשר להעתיק את הקישור שמופיע למעלה',
      yourNamePrompt: 'איך קוראים לך?',
      yourNamePlaceholder: 'השם שלך',
      joinButton: 'הצטרפות',
      joining: 'מצטרפים...',
      joinError: 'אי אפשר להצטרף כרגע.',
      roomNotFound: 'החדר לא נמצא. ייתכן שהקישור כבר לא בתוקף.',
      roomExpired: 'הקישור הזה כבר לא בתוקף. אפשר לבקש מהמארח לשלוח קישור חדש.',
      retryButton: 'ניסיון נוסף',
      lobbyWaitingGuest: 'ממתינים שהמארח יתחיל את הערב...',
      lobbyWaitingHost: 'שתפו את הקישור כדי שכולם יצטרפו',
      memberCountOne: 'משתתף אחד בחדר',
      memberCount: '{{count}} משתתפים בחדר',
      rosterLoadError: 'אי אפשר לטעון את רשימת המשתתפים כרגע.',
      youSuffix: '(את/ה)',
      hostFallbackName: 'המארח',
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
