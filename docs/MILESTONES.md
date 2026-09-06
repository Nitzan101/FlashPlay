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

- **Milestone 2 — REOPENED.** The gate's independent review found four serious
  holes, each demonstrated by an executed assertion rather than by reading. The
  data model, the fact-store half of the gate, and the model/rules path
  agreement all hold up; the round-play rules do not. See below.
- **Milestone 1 — done.** Repo, build, tests, lint, a separate Firebase project, and
  Google redirect sign-in working end to end on desktop and on a real phone from
  WhatsApp on iOS. Live at `https://flashplay-50bde.firebaseapp.com`.
- **Milestone 0 — not started.**
- **Milestone 3 — blocked**, on milestone 2 and on enabling anonymous sign-in in
  the Firebase console (verified disabled: `ADMIN_ONLY_OPERATION`).

### Milestone 2 — open defects

**S1. The reveal guard reads a document the attacker may write.** `itemRevealed()`
gates on `items/{id}.revealed`, but any player may `create` an `items` document
with no field validation, and the host's skip button *deletes* one. So: list the
item ids, wait for a skip, re-create that id with `revealed: true`, and read the
author of an item that was never revealed. Proven end to end. The general form is
worse than the exploit: **the lock's key is a document the people being locked out
can write.**

**S2. Every gathering is enumerable without the link.** `allow read: if isSignedIn()`
on `/sessions/{sessionId}` never mentions the wildcard, so it grants `list` as well
as `get` — `getDocs(collection('sessions'))` returns every session's room code,
host and scores. DESIGN deliberately treats the join link as a bearer token, so
joining *with* the code is intended; needing no code at all is not. The fix is to
deny `list` on sessions, not to add another membership helper.

**S3. A vote can be cast after the reveal, once the answer is public.** `update` is
guarded by `!roundRevealed(...)`; `create` has no phase guard. A player who
abstained has no document, so their post-reveal write is a create. Proven: read the
now-public votes, then cast the correct answer for two points.

**S4. Authorship can be stolen.** `itemAuthors` create checks that you name
*yourself*, never that the item is *yours*. Between a player's two writes (item,
then author) anyone can claim it — and `update: if false` then locks the real
author out permanently. The two-write gap on a phone network is the disconnection
case DESIGN already calls out.

**R1 (design consequence, not a leak).** An unrevealed item's author is unreadable
by every client forever, host included — there is no server. DESIGN says the ~12
unrevealed items are kept as facts, attributed to their author. **Milestone 7
cannot write those facts under these rules**, so this must be settled as part of
fixing the above, while rules changes are still cheap.

**R2–R7 (routine):** the trailing catch-all `match` is a no-op (Firestore is
default-deny); an anonymous user can currently open a gathering as host, though
DESIGN requires a registered one; `items` create validates no fields, lengths or
counts; `PlayerDoc.hasDevice` describes a document the rules forbid the host from
creating; votes' `get`/`update` check the player id but not session membership.

### What the test suite missed, and why

**Not one `list` or query assertion in the twenty.** S1 and S2 are both invisible
to `getDoc` and only appear through `getDocs`. Whole rules had no coverage at all:
the `games` block, `players` create/update/delete, `items` create/update/delete,
`sessions` create, and — where S3 hides — votes `create`, since the only vote test
exercised the `update` path.
