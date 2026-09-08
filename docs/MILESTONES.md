# FlashPlay — Milestones

Scope: the **first target only** — one session that works well with a real family
group. The targets after it (a live product strangers use, then a full portfolio
write-up) are deliberately not planned here, because what the real family session
teaches will change them.

**No dates.** The working pace is unknown and there is nothing to calibrate
against, so inventing a schedule would be fiction. Relative size is an ordering
aid, not a measurement.

**Boundaries are set by risk, not by architectural layer.** Each milestone ends at
the point where the riskiest remaining assumption actually gets tested. Splitting
by code layer is more convenient to build but pushes the real risk to the end, and
the biggest risk here is not an engineering one. See DECISIONS.md.

---

## How a milestone closes

**A two-part gate.** Independent subagent review for everything that can be read or
run, and a run with real people for everything that cannot — whether the material is
funny and whether the evening flowed are not verifiable by review at any level of
thoroughness.

The review is **a fixed number of passes, each through a different lens**:
correctness, data and security, mobile reality, and a full walkthrough of the
scenario. **Not a loop until it comes back clean** — a reviewer asked again always
produces something, so an unbounded loop closes on a tired reviewer rather than on
clean work.

**The review also checks that the milestone's lessons were captured**, and where.
This is the half a hook cannot do: a `Stop` hook enforces that the question gets
answered, but only another reader can judge whether the answer is real or a
sentence written to clear a gate. Ask the reviewer specifically: does each
recorded lesson name a concrete failure and what to do differently, or is it a
restatement of what happened?

**Severity bar: only a "serious" finding holds the gate.** A routine one goes to
BACKLOG.md and work continues. Without the bar, a routine housekeeping item stops a
milestone exactly as hard as a real bug.

---

## The list

| # | What gets built | What the gate tests | Size |
|---|---|---|---|
| 0 | **The prompt pool.** Zero code: 15–20 Hebrew harvest prompts. Does **not** block 1–3 and can run alongside them, but blocks 4 | All three prompt rules hold for every prompt: asks for a behaviour, answerable in thirty seconds by a nine-year-old, no common answer. Reviewable by an agent. **Whether the material is actually funny is not tested here** | Small |
| 1 | **Skeleton, separate Firebase project, redirect auth.** Repo, `CLAUDE.md` with verified commands, `docs/` in English, a Firebase project separate from the live Imposter Game one, Google sign-in by **redirect** | Deploy, send the link to WhatsApp, tap it from a real phone, sign in, and observe what happens to identity when the same person later opens it in their real browser | Small–medium |
| 2 | **Data model and security rules.** No interface. The single rule shape covering both hidden author and hidden votes | Emulator assertions. The headline claim: a client **cannot** fetch the author mapping before the phase flips to "revealed", and cannot fetch the group's fact store | Medium |
| 3 | **Room, joining, presence, player identity, member list.** The room layer, ported from Imposter Game | Test 1: three to five real phones, seconds from opening the room to everyone being in. Over two minutes is failure on the central promise. Plus: lock every screen at once and confirm resync on return to foreground | Medium |
| 4 | **Session state machine and the harvest phase.** Timeout or host override on **every** phase, minimum submission threshold, duplicate blocking, joining during submission | A multi-device run in which one device is **deliberately killed mid-phase** | Large |
| 5 | **"Who said that" round loop and scoring.** Host preview, skip, display on all phones, vote, reveal | Two things: **devtools open on a player device mid-round** — the author id is absent from the payload before reveal; if this fails the game is completely broken. **And whether the material is funny** — this is the earliest point that can be known, now that the paper test was declined | Large |
| 6 | **"Most likely to", cumulative scoring, the ending.** The second game built from revealed items, plus the one-sentence defence from whoever got the most votes | A full run with three to five friends. What is being tested is not "no bugs" but **whether the second game reads as a new question**. Plus a listener fan-out check across browser profiles on the laptop — see below | Medium |
| 7 | **Fact persistence, feedback, saving the group.** Facts written at the end of each game, cascading deletion, outcome feedback, list recycling | Emulator plus the abandoned-session case. **The real value is only testable at the second gathering**, which is outside this scope | Medium |
| 8 | **The family session** | This is the target itself, not a test of it | — |

---

## Two things the review surfaced

**Listener fan-out is otherwise first tested at the target itself.** Milestones 3
and 6 run against three to five devices, so the device count only becomes realistic
at milestone 8 — the evening that is the entire goal. A fan-out check using browser
profiles on the laptop therefore belongs in milestone 6, not after it.

**Writing the prompts is not a line of code, so it fell out of the original build
order.** It is several hours of content work and a real dependency of milestone 4,
which is why it is held as milestone 0 in its own right rather than as an item
inside 4.

---

## Explicitly out of the first slice

**Participant without a phone.** The mechanism stays in the design — requirements
declared as data, and the rule that a game needing secret per-player information
cannot include a participant without a screen. Only the implementation is deferred.
The conscious cost: the family session has to be assembled from people who all have
a phone, which slightly weakens test 2, whose whole value is a less technologically
forgiving group. See BACKLOG.md.

**The generator.** The two chosen games do not need it, which is the entire point of
choosing them.

**The wizard.** The two-game sequence is fixed in advance in the first slice.

---

## Status

- **Milestone 2 — done (reviewed twice, reopened twice).** Data model, security
  rules, and 48 emulator assertions. The gate's independent review found four
  demonstrated holes in the first version; all four are fixed, each fix
  mutation-checked, and the review's design consequence (R1) settled. Firestore
  is in `me-west1` (Tel Aviv). Rules deployed.
- **Milestone 1 — done.** Repo, build, tests, lint, a separate Firebase project, and
  Google redirect sign-in working end to end on desktop and on a real phone from
  WhatsApp on iOS. Live at `https://flashplay-50bde.firebaseapp.com`.
- **Milestone 0 — written, gate review in flight.** Eighteen Hebrew harvest
  prompts in `src/content/prompts.ts`, all personal-drawer, with
  `prompts.test.ts` holding everything mechanical (pool size, unique ids,
  actually-Hebrew text, phone-readable length). The three prompt rules are
  judgements and are reviewed by reading, which is this milestone's gate.
  Writing them surfaced a design constraint English had hidden - the second
  game must quote an item after the author's name rather than re-tell it,
  because Hebrew conjugates for person and nothing in the first slice can
  re-conjugate free text. See DECISIONS.md, "Decisions made in milestone 0".
  This unblocks milestone 4.
- **Milestone 3 — implemented, gate not yet run.** Room creation, joining by
  link, presence heartbeat, and the live member list are built: an
  unguessable session id, a separate reclaimable `roomCodes/{code}` lookup
  (closing the squatting finding from milestone 2's re-review - see
  BACKLOG.md and DECISIONS.md), and host-registration now enforced in rules,
  not just hidden client-side. An independent review of the first version
  found two more holes - a room-code claim was never checked against the
  session it pointed at, and the "registered host" tests were passing
  vacuously rather than for the real reason - both closed and
  mutation-checked; see DECISIONS.md, "An independent review of the first
  version, and what it found." Automated evidence: `npm run build`,
  `npm test` (31 tests, prompt-pool tests included), and `npm run test:rules`
  (71 emulator assertions: 64 in `firestore-rules.test.ts`, 7 in
  `room.test.ts`, which proves the client's claim/retry contract end to end
  rather than only what the rules allow in isolation). Four of the
  milestone's own guards are mutation-checked (`isRegistered()`, the
  reclaim-requires-expiry guard, the session/hostUid cross-check on
  `create`, the revealed-item field lock below). **A second independent
  review then found one of those claims was itself false** - the
  `isRegistered()` count was right in total but for the wrong reason, one of
  its two assertions being overdetermined by an unrelated clause. Fixed and
  re-verified; see DECISIONS.md, "A second independent review, on the
  coverage claims themselves."

  **A security review then found a real hole, unrelated to the room-code
  work**, in a rule milestone 2 shipped: revealing an item only constrained
  the `revealed` flag, leaving `text` open on the same write - the host could
  rewrite what someone supposedly wrote at the exact moment the room reads
  it. Fixed with a field-lock (`affectedKeys().hasOnly(['revealed'])`) and
  mutation-checked. See DECISIONS.md, "A security review found a fourth hole."

  **Then the first live run failed three times, on all of that being green.**
  A laptop clock 200ms fast had every room-code claim denied; the guest's
  anonymous sign-in happened after the first Firestore read instead of
  before it; and the client asked "have I already joined?" by reading its own
  player document, which the roster guard forbids until that document exists.
  All three are fixed, each with a test that fails without the fix. The full
  account is in DECISIONS.md, "The first live run"; the general lesson is in
  CLAUDE.md and is worth carrying into every later milestone: **all three
  hid behind a test double that could not produce the real failure — the
  emulator cannot skew a clock, and a mock answers "not found" where real
  rules answer "permission denied."**

  **Live end-to-end result (2026-09-07):** a room opened on the laptop, four
  separate browser identities joined by link, and all four appeared on every
  screen with live presence, without a refresh. A closed window's dot went
  grey on its own. **And a real phone joined, was locked for over a minute,
  and resumed on unlock with the roster intact and its presence back to
  green** - the one part of this that a laptop genuinely cannot stand in for,
  and the thing most likely to have been broken.

  That leaves exactly two things for the gate, both needing people rather
  than code: **a timed run with three to five real phones** (the under-two-
  minutes claim is about humans finding a WhatsApp message and typing a name,
  which four browser tabs cannot measure), and **the independent four-lens
  review**.

  **Not yet done:** the actual gate - a three-to-five real phone join test
  under two minutes with a mid-session screen-lock/foreground check, and the
  independent four-lens review.

### How milestone 2 was closed

The four holes and how each was fixed — the shape of the fix matters more than
the fix, because the same shape is what the next milestone should reuse:

**S1, the reveal guard could be forced open.** The guard read `items/{id}.revealed`,
a document players could create and the host could delete: delete, re-create with
the flag set, and the author document opened. Fixed by removing item deletion
entirely rather than restricting it — no legitimate flow needs it — and by
forbidding `revealed` at creation, so the flag can only ever be flipped
false→true by the host.

**S2, every gathering was enumerable.** `allow read` on a session granted `list`
as well as `get`, because the condition never mentioned the wildcard. Now `get`
only. **This forced a real design decision: the room code is the session's
document id**, since a room can only be opened by fetching an id you already
know and there is no query-based lookup. The player roster was tightened the
same way — it holds real names and required only being signed in.

**S3, a vote could be cast after the reveal.** `update` was phase-guarded and
`create` was not; a player who abstained has no document, so their post-reveal
write was a create. Both are guarded now.

**S4, authorship could be stolen.** The rule checked that you named *yourself*,
never that the item was *yours*. Fixed by inverting the write order: the author
claim is written first, and an item cannot be created unless a matching claim
already exists and belongs to the caller. Claims are unlistable and
first-write-wins, so there is nothing to observe or race. **This is a client
contract as much as a rule** — see `ITEM_WRITE_ORDER` in `src/lib/model.ts`.

**R1, unrevealed items could never be attributed.** Design keeps the items that
never got a round as facts attributed to their author, but nothing could read
those authors — there is no server to make an exception from. The host, and only
the host, can now read them once the gathering's phase is `finished`.

### The second review, and what the fixes themselves broke

Re-reviewing after fixing was not ceremony. Every one of the four repairs
removed or narrowed a permission, and tightening rules is how a product gets
locked out of its own database — so the second pass asked the opposite question:
not what an attacker can still reach, but what no longer works. It confirmed all
four originals closed, and found three more:

**Two of them were created by the fixes.** R1 let the host read authorship once
the gathering is `finished`, and nothing stopped the host setting `finished`,
reading the answer key, and setting it back — the host is a scoring player, and
DESIGN says their screen never contains the answer. Fixed by making the phase
monotonic: peeking now costs the gathering. And denying session *listing* made
the room code the document id, which meant a deleted session's id could be
re-created by anyone — inheriting the previous gathering's roster, items and
claims, because Firestore does not delete subcollections. Fixed by denying
session deletion outright.

**One was a documented instruction that could not work.** `ITEM_WRITE_ORDER`
said to write the claim and the item in one batch. Rules `get()` cannot see a
batch's own pending writes, so that batch is always rejected — verified against
the emulator. The contract now says two sequential writes, and says why, and
says to use a fresh id on retry, because an orphan claim can never be completed.

Everything else the review raised belongs to milestones that do not exist yet -
room-code lifecycle, unguessable item ids, where a skip gets recorded, the host
preview being defeated by a devtools list. All are in BACKLOG.md with the
finding intact.

### What the first suite missed, and what changed because of it

Not one of the original twenty assertions was a `list` or a query, and two of the
four holes were invisible to `getDoc`. The suite is now 48 assertions, and
eleven guards have been mutation-checked individually — deleted one at a time,
the matching assertion watched to go red, then restored.

Worth recording that the first repair of this gap was itself overstated: the
claim "every rule granting a read has a list assertion beside it" was written
when `games`, `rounds`, `items`, the private store and the pre-reveal vote list
had none. The second review caught it. **State coverage by pointing at
assertions, never by describing them** — the exact figures now live in the test
file header.
