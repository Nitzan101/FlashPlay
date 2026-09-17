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

export const PROFILE_QUESTIONS: readonly ProfileQuestion[] = [
  { id: 'hobby', text: 'התחביב שלך', kind: 'text' },
  { id: 'favoriteFood', text: 'האוכל האהוב עליך', kind: 'text' },
  {
    id: 'music',
    text: 'הסגנון המוזיקלי שהכי מדבר אליך',
    kind: 'single-choice',
    options: ['פופ', 'רוק', 'מזרחי', 'היפ הופ', 'קלאסי', 'אחר'],
  },
  {
    id: 'freeTime',
    text: 'איך הכי אוהב/ת לבלות זמן פנוי',
    kind: 'multi-choice',
    options: ['טיולים', 'ספרים', 'סרטים וסדרות', 'ספורט', 'בישול', 'משחקים', 'שינה'],
  },
  { id: 'funFact', text: 'עובדה משעשעת שרוב האנשים לא יודעים עליך', kind: 'text' },
  // The "general free paragraph" from the request: modelled as just another
  // text question rather than a separate mechanism, since it needs nothing a
  // text question doesn't already have.
  { id: 'general', text: 'משהו כללי שתרצה/י לספר על עצמך', kind: 'text' },
] as const
