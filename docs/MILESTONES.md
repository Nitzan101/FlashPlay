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

- **Milestone 2 — done (reopened once, then closed).** Data model, security
  rules, and 38 emulator assertions. The gate's independent review found four
  demonstrated holes in the first version; all four are fixed, each fix
  mutation-checked, and the review's design consequence (R1) settled. Firestore
  is in `me-west1` (Tel Aviv). Rules deployed.
- **Milestone 1 — done.** Repo, build, tests, lint, a separate Firebase project, and
  Google redirect sign-in working end to end on desktop and on a real phone from
  WhatsApp on iOS. Live at `https://flashplay-50bde.firebaseapp.com`.
- **Milestone 0 — not started.** Blocks milestone 4, not 3.
- **Milestone 3 — next.** Room, joining, presence, player identity, member list.
  Anonymous sign-in is enabled and verified live, so guests can authenticate.

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

### What the first suite missed, and what changed because of it

Not one of the original twenty assertions was a `list` or a query, and two of the
four holes were invisible to `getDoc`. The suite is now 38 assertions and every
rule that grants a read has an explicit list assertion beside it, including the
ones that are *supposed* to deny listing. Seven guards were mutation-checked
individually — the exact coverage is stated in the test file header rather than
claimed wholesale.
