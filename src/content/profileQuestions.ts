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
    options: ['פופ', 'רוק', 'מזרחי', 'היפ הופ', 'קלאסי'],
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
  // Free text rather than a choice list, since 2026-09-22: with a universal
  // "אחר" chip now offered on every choice question (see GuidedQuestions.tsx),
  // stacking "שניהם"/"אף אחת"/"משהו אחר" on top of the two real options here
  // was three meta-options answering a question that only had two real ones -
  // "overkill", in Nitzan's own word. A question this open-ended was never a
  // good fit for a fixed list to begin with.
  { id: 'animalPerson', text: 'איזו חיה הכי מדברת אליך', kind: 'text' },
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

  // Added 2026-09-22, in response to "20 questions is nothing - at least 40":
  // a second batch, same three constraints as the first (behaviour/fact, not
  // opinion-only; thirty seconds; no common answer), same mix of kind and
  // topic so a much longer list still reads as variety rather than padding.
  { id: 'firstJob', text: 'העבודה הכי מוזרה שהייתה לך אי פעם', kind: 'text' },
  { id: 'collection', text: 'משהו שאת/ה אוסף/ת בלי סיבה טובה', kind: 'text' },
  { id: 'nickname', text: 'כינוי שקראו לך בעבר', kind: 'text' },
  { id: 'fear', text: 'דבר קטן שממש מפחיד אותך ולא הגיוני', kind: 'text' },
  { id: 'wordUse', text: 'מילה או ביטוי שאת/ה אומר/ת יותר מדי', kind: 'text' },
  { id: 'weirdCombo', text: 'שילוב אוכל מוזר שאת/ה דווקא אוהב/ת', kind: 'text' },
  { id: 'skillToLearn', text: 'דבר אחד שהיית רוצה ללמוד לעשות', kind: 'text' },
  { id: 'movieQuote', text: 'משפט מסרט או סדרה שאת/ה מצטט/ת בלי הפסקה', kind: 'text' },
  { id: 'lostItem', text: 'הדבר הכי יקר שאיבדת אי פעם', kind: 'text' },
  { id: 'superstition', text: 'הרגל או אמונה טפלה קטנה שיש לך', kind: 'text' },
  { id: 'bestGift', text: 'המתנה הכי טובה שקיבלת אי פעם', kind: 'text' },
  { id: 'unpopularOpinion', text: 'דעה לא פופולרית שיש לך על משהו של יומיום', kind: 'text' },
  { id: 'firstMemoryOfGroup', text: 'הזיכרון הראשון שלך מהקבוצה הזאת', kind: 'text' },
  { id: 'dailyRitual', text: 'משהו קטן שאת/ה עושה כל בוקר בלי לחשוב', kind: 'text' },
  {
    id: 'sleepSchedule',
    text: 'איזה טיפוס את/ה יותר',
    kind: 'single-choice',
    options: ['ינשוף לילה', 'ציפור בוקר', 'משתנה לפי מצב רוח'],
  },
  {
    id: 'phoneHabit',
    text: 'מה קורה לטלפון שלך יותר',
    kind: 'single-choice',
    options: ['סוללה על אפס', 'זיכרון על אפס', 'שניהם', 'אף אחד'],
  },
  {
    id: 'weatherPreference',
    text: 'מזג האוויר שהכי מתאים לך',
    kind: 'single-choice',
    options: ['שמש חזקה', 'קור צונן', 'גשם', 'רוח'],
  },
  {
    id: 'travelStyle',
    text: 'איך את/ה מעדיף/ה לתכנן טיול',
    kind: 'single-choice',
    options: ['תוכנית מסודרת מראש', 'ספונטני לגמרי', 'משהו באמצע'],
  },
  {
    id: 'competitiveness',
    text: 'עד כמה את/ה תחרותי/ת במשחקים',
    kind: 'single-choice',
    options: ['מאוד', 'קצת', 'ממש לא', 'תלוי במשחק'],
  },
  {
    id: 'hobbies2',
    text: 'דברים שאת/ה נהנה/ית לעשות עם הידיים',
    kind: 'multi-choice',
    options: ['ציור', 'נגינה', 'תפירה', 'נגרות', 'גינון', 'הרכבות', 'כלום מזה'],
  },
  {
    id: 'comfortFood',
    text: 'מה עוזר לך כשיום קשה',
    kind: 'multi-choice',
    options: ['אוכל', 'שינה', 'שיחה עם מישהו', 'סרט', 'הליכה', 'מוזיקה'],
  },
  {
    id: 'socialBattery',
    text: 'מה הכי ממלא לך את המצברים החברתיים',
    kind: 'multi-choice',
    options: ['מסיבה גדולה', 'שיחה אחת על אחת', 'זמן לבד', 'משפחה', 'חברים ותיקים'],
  },
] as const
