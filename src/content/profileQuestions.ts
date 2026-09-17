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
 */
import type { ProfileQuestion } from '../lib/model'

/**
 * Twenty rather than a handful, deliberately - Nitzan's own framing is
 * "everyone answers whatever comes to mind or flows for them", which a short
 * fixed list works against: with six questions, most of the room answers the
 * same six. Real variety is what makes "pick what resonates" a genuine choice
 * rather than "fill out this short form." See GuidedQuestions.tsx for how the
 * lobby avoids dumping all twenty on screen at once.
 *
 * Mixed on purpose across two axes: **kind** (12 free-text, 5 single-choice,
 * 3 multi-choice - so the screen itself has texture, not one input repeated
 * twenty times) and **topic** (habits, taste, memory, values, mood - so a
 * person who has nothing to say about music still has eighteen other doors).
 * Every one still holds to the harvest prompts' own bar even though nothing
 * here is a guessing game: answerable in seconds, and works the same for a
 * nine-year-old and a grandparent (DESIGN's target group is a mixed-age
 * family) - which is why there is nothing here about work, dating, money or
 * politics.
 */
export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  { id: 'hobby', text: 'התחביב שלך', kind: 'text' },
  { id: 'favoriteFood', text: 'האוכל האהוב עליך', kind: 'text' },
  { id: 'funFact', text: 'עובדה משעשעת שרוב האנשים לא יודעים עליך', kind: 'text' },
  { id: 'dreamTrip', text: 'היעד שהכי בא לך לנסוע אליו', kind: 'text' },
  { id: 'childhoodMemory', text: 'זיכרון ילדות שאת/ה אוהב/ת לספר עליו', kind: 'text' },
  { id: 'hiddenTalent', text: 'כישרון שיש לך שרוב האנשים לא יודעים עליו', kind: 'text' },
  { id: 'comfortShow', text: 'הסרט או הסדרה שאת/ה חוזר/ת עליו/ה שוב ושוב', kind: 'text' },
  { id: 'petPeeve', text: 'דבר קטן שממש מוציא אותך משלך', kind: 'text' },
  { id: 'proudOf', text: 'הישג שאת/ה הכי גאה בו', kind: 'text' },
  { id: 'lifeMotto', text: 'משפט או פתגם שמלווה אותך', kind: 'text' },
  { id: 'perfectWeekend', text: 'איך נראית סוף השבוע המושלם שלך', kind: 'text' },
  // The "general free paragraph" from the original request: modelled as just
  // another text question rather than a separate mechanism, since it needs
  // nothing a text question doesn't already have.
  { id: 'general', text: 'משהו כללי שתרצה/י לספר על עצמך', kind: 'text' },
  {
    id: 'music',
    text: 'הסגנון המוזיקלי שהכי מדבר אליך',
    kind: 'single-choice',
    options: ['פופ', 'רוק', 'מזרחי', 'היפ הופ', 'קלאסי', 'אחר'],
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
    text: 'איך הכי אוהב/ת להטעין מצברים אחרי יום עמוס',
    kind: 'single-choice',
    options: ['שקט לבד', 'עם חברים', 'בטבע', 'מול מסך'],
  },
  {
    id: 'animalPerson',
    text: 'איזו חיה הכי מדברת אליך',
    kind: 'single-choice',
    options: ['כלב', 'חתול', 'שניהם', 'אף אחת', 'משהו אחר'],
  },
  {
    id: 'freeTime',
    text: 'איך הכי אוהב/ת לבלות זמן פנוי',
    kind: 'multi-choice',
    options: ['טיולים', 'ספרים', 'סרטים וסדרות', 'ספורט', 'בישול', 'משחקים', 'שינה'],
  },
  {
    id: 'strongSuits',
    text: 'תחומים שאת/ה מרגיש/ה הכי בבית בהם',
    kind: 'multi-choice',
    options: ['בישול', 'ספורט', 'אמנות', 'טכנולוגיה', 'מוזיקה', 'כתיבה', 'ארגון'],
  },
  {
    id: 'values',
    text: 'מה הכי חשוב לך בחיים',
    kind: 'multi-choice',
    options: ['משפחה', 'קריירה', 'הרפתקאות', 'יצירתיות', 'למידה', 'בריאות', 'חברים'],
  },
] as const
