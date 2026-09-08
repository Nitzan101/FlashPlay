/**
 * The harvest prompt pool - milestone 0.
 *
 * These are the questions everyone in the room answers during the harvest
 * phase of "Who said that". Everyone gets the SAME prompt (otherwise the room
 * cannot tell which question the item being read out is answering), each
 * person submits two items to it, and a gathering uses two prompts. A pool of
 * 15-20 keeps a group's first few gatherings feeling fresh.
 *
 * This file is content, not code, and it is the one place in the repo where
 * Hebrew is correct rather than a policy violation: these strings are read by
 * the people playing.
 *
 * --- The three rules every prompt here must satisfy (DESIGN.md) ------------
 *
 * 1. **It asks for a behaviour**, not a fact and not an opinion. Only a
 *    behaviour can be asked about a second time as "who is most likely to do
 *    that". "Something embarrassing you did" rolls into the second game;
 *    "something nobody knows about you" breaks there, because the tenses
 *    stop working.
 * 2. **Answerable in thirty seconds, including by a nine-year-old.** A prompt
 *    that requires thought stops the harvest dead. It must also work for a
 *    grandmother - the target group is a family of mixed ages.
 * 3. **No common answer.** "What is your favourite colour" dies immediately:
 *    everyone writes the same thing and guessing becomes impossible.
 *
 * A fourth, unwritten one that follows from the ninety-second window: the
 * prompt has to be broad enough that ONE person can answer it TWICE.
 *
 * **Milestone 0's own gate review rejected the first version of this pool**
 * (2026-09-08): two prompts failed rule 3 outright (`late`, `searched-in-vain`
 * both collected the same one or two common answers - `פקקים`, `משקפיים`),
 * one failed rule 2 (`bought-unused` assumes an adult's spending habits, which
 * a nine-year-old does not have), and two carried real social risk at a family
 * table with no skip button built yet (`nobody-looking` invited a literal
 * confession; `small-lie` read as an accusation in front of whoever was lied
 * to). All five replaced below with the review's suggested text rather than
 * merely removed, to keep the pool at eighteen.
 *
 * --- How an item is re-read in the second game -----------------------------
 *
 * DESIGN requires that an item's text passes into "Most likely to" **as it
 * is**, wrapped only in a different question - there is no AI in the first
 * slice to splice free text into a template. In English that is invisible,
 * because "left his phone on the car roof" reads the same whoever says it.
 * In Hebrew it is not: an answer is written in the first person ("שכחתי את
 * המפתחות") and cannot be re-conjugated to third person without a generator.
 *
 * **The first fix proposed for this (quoting the item after `{name} כתב:`)
 * was itself wrong, per the same gate review.** Two bugs: `כתב` is masculine
 * and ungrammatical for a female player, and `PlayerDoc` (`src/lib/model.ts`)
 * carries no gender field to fix that with - there is nothing to inflect the
 * verb from. Worse, most prompts here open with `משהו ש...`, whose natural
 * answer is a bare noun (`גבינה צהובה`, `מכונת אספרסו`) - quoted after any
 * verb, `מי מכם הכי עלול לעשות את זה?` has no antecedent for `את זה` and
 * reads as grammatical nonsense.
 *
 * **The actual fix: each prompt carries its own second-game question.**
 * `secondGameQuestion` is a genderless, infinitive-form question (Hebrew's
 * infinitive has no person and no gender) that already contains the verb the
 * bare-noun answer is missing. Rendered as:
 *
 *     התשובה של דוד: «גבינה צהובה». מי מכם הכי עלול לאכול את זה
 *     בעמידה מול המקרר?
 *
 * `התשובה של {name}` (never `{name} כתב`) is genderless and grammatical for
 * every answer shape. Changing this wrapper means re-checking every prompt's
 * `secondGameQuestion` against it.
 */
import type { FactDrawer } from '../lib/model'

export interface HarvestPrompt {
  id: string
  /** Hebrew, second person plural - the form that reads naturally to a whole
   *  room at once and does not assume the reader's gender. */
  text: string
  /** Which drawer the facts this prompt collects live in. Every prompt here
   *  is `personal`: both first-slice games need an item attributable to one
   *  named person, and a group fact ("something that happened to us") cannot
   *  be re-asked as "who is most likely to do that". Group-drawer prompts
   *  arrive with a game that actually wants them. */
  drawer: FactDrawer
  /** The genderless, infinitive-form question the second game asks after
   *  quoting this prompt's answer - see the module comment above for why
   *  this exists as its own field rather than one shared wrapper sentence. */
  secondGameQuestion: string
}

export const HARVEST_PROMPTS: readonly HarvestPrompt[] = [
  {
    id: 'forgot-where',
    text: 'משהו ששכחתם איפה שמתם אותו',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לשכוח איפה שם את זה?',
  },
  {
    id: 'broke-something',
    text: 'משהו ששברתם או קלקלתם בטעות',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לשבור את זה?',
  },
  {
    id: 'excuse',
    text: 'תירוץ שהמצאתם כדי לא לצאת מהבית',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להמציא את התירוץ הזה?',
  },
  {
    id: 'fridge',
    text: 'משהו שאכלתם בעמידה מול המקרר',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לאכול את זה בעמידה מול המקרר?',
  },
  {
    id: 'wrong-name',
    text: 'פעם שקראתם למישהו בשם הלא נכון',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לקרוא למישהו בשם הלא נכון?',
  },
  {
    id: 'false-scare',
    text: 'פעם שנבהלתם ממשהו שבכלל לא היה מפחיד',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להיבהל ככה?',
  },
  {
    id: 'said-and-regretted',
    text: 'משהו שאמרתם ורגע אחרי זה התחרטתם',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להגיד את זה?',
  },
  {
    id: 'mismatched-clothes',
    text: 'פעם שיצאתם מהבית עם בגד הפוך או שתי נעליים שונות',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לצאת ככה מהבית?',
  },
  {
    id: 'fell-asleep',
    text: 'מקום מוזר שנרדמתם בו',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להירדם שם?',
  },
  {
    id: 'waved-at-stranger',
    text: 'פעם שנופפתם לשלום למישהו שלא הכרתם',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לנופף למישהו זר?',
  },
  {
    id: 'postponing',
    text: 'משהו שאתם דוחים כבר חודש',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לדחות את זה חודש?',
  },
  {
    id: 'like-my-parents',
    text: 'משהו שאתם עושים בדיוק כמו ההורים שלכם',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לעשות את זה כמו ההורים?',
  },
  {
    id: 'checked-if-seen',
    text: 'משהו שעשיתם ומיד הסתכלתם לצדדים לבדוק אם מישהו ראה',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לעשות את זה ולבדוק שאף אחד לא ראה?',
  },
  {
    id: 'carry-everywhere',
    text: 'משהו שאתם לוקחים לכל מקום ואף פעם לא משתמשים בו',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לקחת את זה לכל מקום בלי להשתמש?',
  },
  {
    id: 'laughed-wrong-moment',
    text: 'פעם שצחקתם בדיוק ברגע שאסור היה לצחוק',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול לצחוק דווקא אז?',
  },
  {
    id: 'hid-something',
    text: 'משהו שהחבאתם כדי שאף אחד לא ימצא',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להחביא את זה?',
  },
  {
    id: 'small-lie',
    text: 'שקר קטן שאמרתם כשהייתם ילדים',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול להגיד שקר כזה?',
  },
  {
    id: 'tripped',
    text: 'פעם שנפלתם או נתקלתם במשהו מול כולם',
    drawer: 'personal',
    secondGameQuestion: 'מי מכם הכי עלול ליפול ככה מול כולם?',
  },
] as const

/** DESIGN: "A pool of 15-20 prompts is required." Asserted in prompts.test.ts
 *  so that trimming the pool below a workable size fails loudly. */
export const MIN_POOL_SIZE = 15
export const MAX_POOL_SIZE = 20

/** Two prompts per gathering, and a group must not see the same one twice in
 *  one evening. */
export const PROMPTS_PER_GATHERING = 2
