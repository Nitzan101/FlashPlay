/**
 * The harvest prompt pool - milestone 0.
 *
 * These are the questions everyone in the room answers during the harvest
 * phase of "Who said that". Everyone gets the SAME prompt (otherwise the room
 * cannot tell which question the item being read out answers), each person
 * submits two items to it, and a gathering uses two prompts. A pool of 15-20
 * keeps a group's first few gatherings feeling fresh.
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
 * --- How an item is re-read in the second game -----------------------------
 *
 * DESIGN requires that an item's text passes into "Most likely to" **as it
 * is**, wrapped only in a different question - there is no AI in the first
 * slice to splice free text into a template. In English that is invisible,
 * because "left his phone on the car roof" reads the same whoever says it.
 * In Hebrew it is not: an answer is written in the first person ("שכחתי את
 * המפתחות") and cannot be re-conjugated to third person without a generator.
 *
 * So the second game must quote rather than re-tell:
 *
 *     דוד כתב: «שכחתי את המפתחות בדלת». מי מכם הכי עלול לעשות את זה?
 *
 * The name sits in its own clause, the item is quoted verbatim, and the
 * question is grammatical for any answer. **Every prompt below is written to
 * be answered in the first person, because that wrapper is what reads them.**
 * Changing the wrapper means re-checking this whole file.
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
}

export const HARVEST_PROMPTS: readonly HarvestPrompt[] = [
  { id: 'forgot-where', text: 'משהו ששכחתם איפה שמתם', drawer: 'personal' },
  { id: 'broke-something', text: 'משהו ששברתם או קלקלתם בטעות', drawer: 'personal' },
  { id: 'excuse', text: 'תירוץ שהמצאתם כדי לא ללכת לאיזשהו מקום', drawer: 'personal' },
  { id: 'fridge', text: 'משהו שאכלתם בעמידה מול המקרר', drawer: 'personal' },
  { id: 'late', text: 'פעם שאיחרתם, ובגלל מה', drawer: 'personal' },
  { id: 'searched-in-vain', text: 'משהו שחיפשתם בכל הבית והיה עליכם כל הזמן', drawer: 'personal' },
  { id: 'said-and-regretted', text: 'משהו שאמרתם ורציתם מיד להחזיר', drawer: 'personal' },
  { id: 'avoided-call', text: 'משהו שעשיתם רק כדי לא לענות לטלפון', drawer: 'personal' },
  { id: 'fell-asleep', text: 'מקום מוזר שנרדמתם בו', drawer: 'personal' },
  { id: 'wrong-place', text: 'פעם שנכנסתם למקום הלא נכון', drawer: 'personal' },
  { id: 'postponing', text: 'משהו שאתם דוחים כבר חודש', drawer: 'personal' },
  { id: 'like-my-parents', text: 'משהו שאתם עושים בדיוק כמו ההורים שלכם', drawer: 'personal' },
  { id: 'nobody-looking', text: 'משהו שאתם עושים רק כשאף אחד לא מסתכל', drawer: 'personal' },
  { id: 'bought-unused', text: 'משהו שקניתם ולא השתמשתם בו אף פעם', drawer: 'personal' },
  { id: 'laughed-wrong-moment', text: 'משהו שגרם לכם לצחוק בדיוק כשאסור היה', drawer: 'personal' },
  { id: 'hid-something', text: 'משהו שהחבאתם כדי שלא ימצאו', drawer: 'personal' },
  { id: 'small-lie', text: 'שקר קטן שסיפרתם השבוע', drawer: 'personal' },
  { id: 'tripped', text: 'פעם שנפלתם או נתקלתם במשהו מול אנשים', drawer: 'personal' },
] as const

/** DESIGN: "A pool of 15-20 prompts is required." Asserted in prompts.test.ts
 *  so that trimming the pool below a workable size fails loudly. */
export const MIN_POOL_SIZE = 15
export const MAX_POOL_SIZE = 20

/** Two prompts per gathering, and a group must not see the same one twice in
 *  one evening. */
export const PROMPTS_PER_GATHERING = 2
