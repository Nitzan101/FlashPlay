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

      // --- milestone 4: the harvest phase ---
      startGame: 'התחלת המשחק',
      startingGame: 'מתחילים...',
      startGameError: 'אי אפשר להתחיל את המשחק כרגע.',
      sessionLoadError: 'אי אפשר לטעון את החדר כרגע.',
      gameLoadError: 'אי אפשר לטעון את המשחק כרגע.',
      harvestIntro: 'לכל שאלה - תשובה אחת קצרה',
      yourAnswerPlaceholder: 'התשובה שלך',
      submitAnswer: 'שליחה',
      submittingAnswer: 'שולחים...',
      submitAnswerError: 'אי אפשר לשלוח כרגע.',
      alreadySubmitted: 'נשלח ✓',
      harvestTimeLeft: 'נשארו {{seconds}} שניות',
      harvestTimeUp: 'הזמן נגמר - עדיין אפשר לשלוח',
      extendTime: 'עוד דקה',
      extendingTime: 'מוסיפים זמן...',
      extendTimeError: 'אי אפשר להוסיף זמן כרגע.',
      harvestProgress: 'הוגשו {{count}} תשובות עד כה',
      // A noun, not an imperative: every label here stays genderless, and
      // 'המשך' reads as masculine-singular.
      continueToRounds: 'מעבר הלאה',
      advancingPhase: 'ממשיכים...',
      advancePhaseError: 'אי אפשר להמשיך כרגע.',
      // Seen by real people at the milestone-4 gate run, so it says what
      // happened in their terms - no internal vocabulary on a player's phone.
      roundsComingSoon: 'האיסוף הסתיים. הסבבים עדיין בבנייה.',
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
