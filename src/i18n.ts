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

      // --- milestone 5: the "who said that" round loop ---
      roundCounter: 'סבב {{current}} מתוך {{total}}',
      startFirstRound: 'התחלת הסבב הראשון',
      openingRound: 'פותחים סבב...',
      roundPromptLabel: 'השאלה הייתה: {{text}}',
      hostPreviewOnly: 'רק את/ה רואה את זה כרגע',
      skipItem: 'דילוג על התשובה',
      openVoting: 'הקראה ופתיחת הצבעה',
      waitingForHostToRead: 'המנחה מקריא/ה עוד רגע',
      whoWroteThis: 'מי כתב/ה את זה?',
      votesCastOf: 'הצביעו {{count}} מתוך {{total}}',
      everyoneVotesHint: 'גם מי שכתב/ה מצביע/ה, כדי לא להסגיר את עצמו/ה',
      changeVoteHint: 'אפשר לשנות עד לחשיפה',
      revealRound: 'חשיפה',
      revealingRound: 'חושפים...',
      authorWas: 'זה נכתב על ידי {{name}}',
      votedForLine: '{{voter}} חשב/ה שזה {{target}}',
      awardedLine: '{{name}} +{{points}}',
      pointsValue: '{{points}}',
      nextRound: 'לסבב הבא',
      finishGame: 'סיום המשחק',
      finishingGame: 'מסיימים...',
      roundSkipped: 'דילגנו על התשובה הזאת',
      noItemsLeft: 'אין עוד תשובות לסבבים',
      completeReveal: 'השלמת החשיפה',
      stillWorking: 'עדיין מנסים... אולי החיבור איטי',
      roundsLoadError: 'אי אפשר לטעון את הסבב כרגע.',
      revealLoadError: 'אי אפשר לטעון את תוצאות הסבב.',
      finalScoresTitle: 'הניקוד הסופי',
      roundActionError: 'הפעולה נכשלה. אפשר לנסות שוב.',
      voteError: 'אי אפשר להצביע כרגע.',
      scoreboardTitle: 'ניקוד',
      // --- milestone 6: "most likely to", the ending ---
      secondGameTitle: 'המשחק השני',
      secondGameQuote: 'התשובה של {{name}}: «{{text}}»',
      majorityScoringHint: 'אין תשובה נכונה - נקודה למי שהצביע/ה עם הרוב',
      // The second game's own reveal wording. Reusing the first game's
      // ("חשב/ה שזה") would say there was a right answer, which is exactly
      // what this game does not have.
      votedForSecondGameLine: '{{voter}} בחר/ה ב{{target}}',
      mostVotedIs: 'הכי הרבה קולות: {{names}}',
      defenceInvitation: '{{names}} - משפט אחד להגנה',
      majorityScoringReminder: 'נקודה לכל מי שהצביע/ה עם הרוב',
      loadingRound: 'רגע...',
      endGatheringConfirm: 'לסיים את הערב?',
      endGatheringYes: 'כן, לסיים',
      endGatheringNo: 'עוד לא',
      noRevealedItemsLeft: 'אין עוד תשובות שנחשפו',
      firstGameOver: 'המשחק הראשון נגמר',
      secondGameOver: 'המשחק השני נגמר',
      startSecondGame: 'למשחק השני',
      startingSecondGame: 'מתחילים...',
      endGathering: 'סיום הערב',
      endingGathering: 'מסיימים...',
      waitingForHostNextGame: 'ממתינים שהמנחה ימשיך/תמשיך',
      gatheringOver: 'זהו, נגמר!',
      winnerIs: '{{names}} ניצח/ה עם {{points}} נקודות',
      winnerIsOnePoint: '{{names}} ניצח/ה עם נקודה אחת',
      winnersAre: 'תיקו בין {{names}} עם {{points}} נקודות',
      winnersAreOnePoint: 'תיקו בין {{names}} עם נקודה אחת',
      thanksForPlaying: 'תודה ששיחקתם',

      // --- milestone 7: what the evening leaves behind ---
      // Says what keeping actually buys. The first version promised that
      // nobody would have to type their name again, which is the half of
      // DESIGN's list flow that did not survive the privacy constraint - see
      // matchName in memory.ts.
      keepingExplained: 'התשובות מהערב נשמרות אצלך בלבד',
      saveGroupOffer: 'לתת לקבוצה שם? כך תוכלו להמשיך איתה בפעם הבאה, עם כל מה שנאסף הערב',
      groupNamePlaceholder: 'שם הקבוצה (למשל: המשפחה)',
      saveGroup: 'שמירת הקבוצה',
      savingGroup: 'שומרים...',
      saveGroupError: 'אי אפשר לשמור את הקבוצה כרגע.',
      groupSaved: 'הקבוצה נשמרה',
      groupSavedNamed: 'הקבוצה «{{name}}» שמורה - בפעם הבאה היא תחכה לכם',
      keptFromTonight: 'נשמרו {{count}} תשובות מהערב',
      keptFromTonightOne: 'נשמרה תשובה אחת מהערב',
      keptNothing: 'לא נשמרו תשובות מהערב',
      keepEveningError: 'חלק מהתשובות של הערב לא נשמרו.',
      savedGroupsHint: 'פתיחת חדר לקבוצה שמורה ממשיכה את מה שהיא כבר זוכרת',
      savedGroupsLoadError: 'אי אפשר לטעון את הקבוצות השמורות כרגע.',
      viewMemory: 'מה אנחנו זוכרים',
      memoryTitle: 'מה אנחנו זוכרים',
      memoryEmpty: 'עדיין לא זוכרים כלום על הקבוצה הזאת',
      memoryLine: '{{who}}: {{text}}',
      memoryLoadError: 'אי אפשר לטעון את הזיכרון כרגע.',
      deleteFact: 'מחיקה',
      deleteFactError: 'אי אפשר למחוק כרגע.',
      forgetGroup: 'למחוק הכל על הקבוצה',
      forgetGroupConfirm: 'למחוק את כל מה שאנחנו זוכרים על הקבוצה הזאת?',
      forgetGroupYes: 'כן, למחוק',
      forgetGroupNo: 'לא, להשאיר',
      backButton: 'חזרה',
      feedbackQuestion: 'איך היה הערב?',
      feedbackOutcome_good: 'עבד מצוין',
      feedbackOutcome_mixed: 'ככה ככה',
      feedbackOutcome_died: 'לא עבד',
      feedbackHeadcount: 'כמה הייתם?',
      sendFeedback: 'שליחה',
      savingFeedback: 'שולחים...',
      feedbackThanks: 'תודה - זה בדיוק מה שעוזר לשפר',
      feedbackError: 'אי אפשר לשלוח כרגע.',
      savedGroupsTitle: 'הקבוצות ששמרתם',
      unknownPlayer: 'מישהו',
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
