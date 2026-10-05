/**
 * The built-in guided-question bank - milestone 8, the "structured info"
 * pillar alongside the party games' own harvest.
 *
 * Unlike a harvest prompt, a question here is never read aloud or turned into
 * a round - it exists only to become a private fact about the person who
 * answered it (see `writeProfileFacts` in `src/lib/profileQuestions.ts`). That
 * changes what makes a good one: no need for a common-answer problem (there is
 * no guessing game here), and no need to double as a second-game question -
 * just something worth remembering about a person, phrased short enough that
 * `"{question.text}: {answer}"` reads naturally on its own in the group's
 * "פרטים" screen (e.g. "התחביב שלך: ציור").
 *
 * A host's own questions (`CustomQuestionDoc`) sit alongside these, offered
 * the same way - see `useCustomQuestions`/`createRoom`'s snapshot into
 * `SessionDoc.customQuestions`.
 *
 * **Style, decided with Nitzan 2026-09-24 and applied in the 2026-09-24 to
 * 2026-09-27 review (see DECISIONS.md):** no gender slashes anywhere in this
 * bank. A slash in the question reads broken once it is glued to an answer
 * as a saved fact ("התחביב/ך שלך: ציור"), which a transient screen string
 * never has to survive. Every question here is phrased as a noun phrase or a
 * genderless verb form instead - the same reasoning `prompts.ts` already
 * documents for `secondGameQuestion`, and for the same underlying reason:
 * `PlayerDoc` carries no gender field to pick the right form from.
 */
import type { ProfileQuestion } from '../lib/model'

/**
 * Well past twenty, deliberately - Nitzan's own framing is "everyone answers
 * whatever comes to mind or flows for them", which a short fixed list works
 * against: with six questions, most of the room answers the same six. Real
 * variety is what makes "pick what resonates" a genuine choice rather than
 * "fill out this short form." See GuidedQuestions.tsx for how the lobby
 * avoids dumping the whole bank on screen at once.
 *
 * Mixed across two axes: **kind** (free text, single-choice, multi-choice -
 * so the screen itself has texture, not one input repeated over and over)
 * and **topic** (habits, taste, memory, values, mood - so a person who has
 * nothing to say about music still has dozens of other doors). Every one
 * still holds to the harvest prompts' own bar even though nothing here is a
 * guessing game: answerable in seconds, and works the same for a nine-year-
 * old and a grandparent (DESIGN's target group is a mixed-age family) -
 * which is why there is nothing here about work, dating, money or politics.
 */
export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  { id: 'hobby', text: 'התחביב שלך', kind: 'text' },
  { id: 'favoriteFood', text: 'האוכל שאי אפשר לסרב לו', kind: 'text' },
  { id: 'funFact', text: 'עובדה משעשעת שרוב האנשים לא יודעים עליך', kind: 'text' },
  { id: 'dreamTrip', text: 'היעד שהכי בא לך לנסוע אליו', kind: 'text' },
  { id: 'childhoodMemory', text: 'זיכרון ילדות שכיף לספר עליו', kind: 'text' },
  { id: 'hiddenTalent', text: 'הכישרון שלך', kind: 'text' },
  { id: 'comfortShow', text: 'הסרט או הסדרה שראית יותר מדי פעמים', kind: 'text' },
  { id: 'petPeeve', text: 'דבר קטן שממש מוציא אותך מהכלים', kind: 'text' },
  { id: 'proudOf', text: 'הישג שלך שכיף לך להיזכר בו', kind: 'text' },
  { id: 'lifeMotto', text: 'משפט או פתגם שמלווה אותך', kind: 'text' },
  { id: 'perfectWeekend', text: 'איך נראה סוף השבוע המושלם שלך', kind: 'text' },
  // The "general free paragraph" from the original request: modelled as just
  // another text question rather than a separate mechanism, since it needs
  // nothing a text question doesn't already have.
  { id: 'general', text: 'משהו כללי שכדאי לדעת עליך', kind: 'text' },
  // Added 2026-09-24, his own idea, separate from `proudOf` (an achievement)
  // rather than folded into it - a small daily thing, not a milestone.
  { id: 'smileMemory', text: 'דבר שכל פעם שנזכרים בו מעלה לך חיוך', kind: 'text' },
  {
    id: 'music',
    text: 'הסגנון המוזיקלי שהכי מדבר אליך',
    kind: 'multi-choice',
    options: ['מזרחי', 'ים תיכוני', 'פופ', 'רוק', 'טראנס', 'שירי ארץ ישראל', 'שירי קודש'],
  },
  {
    id: 'season',
    text: 'העונה האהובה עליך',
    kind: 'single-choice',
    options: ['חורף', 'אביב', 'קיץ', 'סתיו'],
  },
  {
    id: 'favoriteMeal',
    text: 'ארוחת היום האהובה עליך',
    kind: 'single-choice',
    options: ['בוקר', 'צהריים', 'ערב', 'נשנושים כל היום'],
  },
  {
    id: 'rechargeStyle',
    text: 'מה עוזר לך להטעין מצברים אחרי יום עמוס',
    kind: 'multi-choice',
    options: [
      'שקט ובדידות',
      'חברים',
      'טבע ואוויר',
      'מסך',
      'תנועה וספורט',
      'שינה ומנוחה',
      'אוכל מנחם',
      'מוזיקה',
      'חיבוק',
    ],
  },
  // Free text rather than a choice list, since 2026-09-22: with a universal
  // "אחר" chip now offered on every choice question (see GuidedQuestions.tsx),
  // stacking "שניהם"/"אף אחת"/"משהו אחר" on top of the two real options here
  // was three meta-options answering a question that only had two real ones -
  // "overkill", in Nitzan's own word. A question this open-ended was never a
  // good fit for a fixed list to begin with.
  { id: 'animalPerson', text: 'איזו חיה הכי מדברת אליך', kind: 'text' },
  {
    id: 'freeTime',
    text: 'איך הכי כיף לך לבלות זמן פנוי',
    kind: 'multi-choice',
    options: [
      'טיולים',
      'קריאה',
      'סרטים וסדרות',
      'ספורט',
      'בישול ואפייה',
      'משחקי קופסה',
      'משחקי מחשב',
      'חברים ומשפחה',
      'יצירה',
      'שינה',
    ],
  },
  {
    id: 'strongSuits',
    text: 'התחומים שהכי מתאימים לך',
    kind: 'multi-choice',
    options: [
      'בישול',
      'ספורט',
      'אמנות',
      'טכנולוגיה',
      'מוזיקה',
      'כתיבה',
      'ארגון',
      'הומור',
      'תיקונים בבית',
      'ידע כללי',
    ],
  },
  {
    id: 'values',
    text: 'מה הכי חשוב לך בחיים',
    kind: 'multi-choice',
    options: [
      'משפחה',
      'חברים',
      'הרפתקאות',
      'יצירתיות',
      'למידה',
      'בריאות',
      'קריירה',
      'חופש',
      'שקט נפשי',
      'לעזור לאחרים',
    ],
  },

  // Added 2026-09-22, in response to "20 questions is nothing - at least 40":
  // a second batch, same three constraints as the first (behaviour/fact, not
  // opinion-only; thirty seconds; no common answer), same mix of kind and
  // topic so a much longer list still reads as variety rather than padding.
  { id: 'firstJob', text: 'העבודה הכי מוזרה שהייתה לך אי פעם', kind: 'text' },
  { id: 'collection', text: 'אוסף שיש לך בלי שום סיבה טובה', kind: 'text' },
  { id: 'nickname', text: 'כינוי שקראו לך בעבר', kind: 'text' },
  // `fear` deleted 2026-09-24, merged into the harvest prompt `false-scare` -
  // asking the same thing twice in one evening. See prompts.ts and
  // DECISIONS.md. Facts already saved as `profile_fear` are untouched.
  { id: 'wordUse', text: 'מילה או ביטוי שיוצאים לך יותר מדי מהפה', kind: 'text' },
  { id: 'weirdCombo', text: 'שילוב אוכל מוזר שיש לך חולשה אליו', kind: 'text' },
  { id: 'skillToLearn', text: 'דבר אחד שהיית רוצה ללמוד לעשות', kind: 'text' },
  // `movieQuote` deleted 2026-09-24 - Nitzan's call, "not a good question".
  { id: 'lostItem', text: 'הדבר הכי יקר שאיבדת אי פעם', kind: 'text' },
  { id: 'superstition', text: 'הרגל או אמונה טפלה קטנה שיש לך', kind: 'text' },
  { id: 'bestGift', text: 'המתנה הכי טובה שקיבלת אי פעם', kind: 'text' },
  { id: 'unpopularOpinion', text: 'דעה לא פופולרית שיש לך על משהו של יומיום', kind: 'text' },
  { id: 'firstMemoryOfGroup', text: 'הזיכרון הראשון שלך מהחבורה הזאת', kind: 'text' },
  { id: 'dailyRitual', text: 'הרגל קטן של כל בוקר, כזה שקורה בלי לחשוב', kind: 'text' },
  {
    id: 'sleepSchedule',
    text: 'טיפוס של בוקר או של לילה',
    kind: 'single-choice',
    options: ['בוקר - ישר לעניינים', 'חיית לילה', 'משתנה כל יום'],
  },
  {
    id: 'phoneHabit',
    text: 'מה קורה לטלפון שלך יותר',
    kind: 'single-choice',
    options: ['הסוללה נגמרת מהר', 'אין מקום בזיכרון', 'גם וגם', 'הטלפון שלי מטופל היטב'],
  },
  // `weatherPreference` (the weather you like) replaced 2026-09-24 by the
  // sharper opposite angle below, his call.
  {
    id: 'dislikedWeather',
    text: 'מזג אוויר שנוא',
    kind: 'single-choice',
    options: ['חום כבד', 'קור חודר', 'לחות', 'רוח חזקה', 'גשם בלי מטרייה'],
  },
  {
    id: 'travelStyle',
    text: 'איך הכי כיף לך לתכנן טיול',
    kind: 'single-choice',
    // A spectrum from full control to none, so no two options sit close
    // together (reworded 2026-10-05 after the middle two read as the same).
    // The question keeps "לתכנן" at his call, though the last option is "no plan".
    options: ['הכול מתוכנן מראש, שעה אחרי שעה', 'כמה נקודות קבועות, והשאר פתוח', 'בלי שום תוכנית, פשוט נוסעים'],
  },
  {
    id: 'competitiveness',
    text: 'כמה תחרותיות יש בך במשחקים',
    kind: 'single-choice',
    options: ['תחרותי עד הסוף', 'ככה-ככה', 'בא לי לשחק - לא מעניין מי ינצח', 'תלוי מי משחק נגדי'],
  },
  {
    id: 'hobbies2',
    text: 'דברים שכיף לך לעשות עם הידיים',
    kind: 'multi-choice',
    options: ['ציור', 'נגינה', 'תפירה וסריגה', 'נגרות ותיקונים', 'גינון', 'הרכבות (לגו וכו׳)', 'אפייה'],
  },
  // `comfortFood` deleted 2026-09-24 - it duplicated `rechargeStyle` and
  // `socialBattery` too closely once all three covered "what helps you";
  // his call was to keep those two and drop this one.
  {
    id: 'socialBattery',
    text: 'הפורמט החברתי המועדף עליך',
    kind: 'multi-choice',
    options: [
      'מסיבה גדולה',
      'שיחה אחת על אחת',
      'חבורה קטנה',
      'משפחה',
      'חברים ותיקים',
      'אנשים חדשים',
      'זמן לבד',
    ],
  },

  // Added 2026-09-24, his own suggestions during the review.
  { id: 'favoriteSinger', text: 'זמר אהוב', kind: 'text' },
  {
    id: 'favoriteReality',
    text: 'תוכנית הריאליטי האהובה עליך',
    kind: 'single-choice',
    options: [
      'האח הגדול',
      'הישרדות',
      'המירוץ למיליון',
      'הכוכב הבא',
      'מאסטר שף',
      'חתונה ממבט ראשון',
    ],
  },
] as const
