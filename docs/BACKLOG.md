# FlashPlay — Backlog

Deliberately deferred, with the reason. An undocumented deferral gets
re-proposed in three weeks; "we decided not to do X because Y" is worth as much
as the decisions themselves.

Nothing here is a to-do list. Items move out of this file only when something
concrete requires them.

---

## Product gaps

**The "strangers" hole in the wizard.** Almost none of the fifteen approved games
work with a group of strangers, because they all feed on personal material. The
eight generic games rejected below probably belong exactly here. Either remove the
option from the wizard or populate it with them — not yet decided.

**The 3–4 bucket is thin.** Of fifteen games, only The expert, Impression and
Charades actually work with three or four people. Not blocking, but the wizard
barely chooses anything there.

**The wizard is meaningless at a first gathering.** A new group has no facts, so
the first game must be a harvest and there is nothing to choose between. The wizard
starts working from the second game and the second gathering. Not a defect, but the
design should acknowledge it rather than pretend otherwise.

**The eight generic games.** Describe without the word, pairs challenge, draw it,
who in the room, the ladder, secret ranking, the group task, the covert task. All
fail the threshold test — they work with a deck of cards and with strangers. To be
considered as filler only once a critical mass of games that pass the threshold
exists.

**Can a gathering be paused and resumed on another day.** Not decided, not needed
for the first version.

---

## Content and quality

**A quality gate and a latency budget for the generator.** What happens when the
generator produces output that is *bad* rather than merely slow or failed, and how
many seconds is the threshold beyond which it falls back to a template. Not
relevant to the first slice, which has no generator; to be settled when the first
AI game is built.

**Fact staleness and duplication.** A fact about a job Yossi left two years ago, and
five people who write the same thing. The "prefer unused" rule handles part of this
and not all of it.

---

## Platform and testing

**Android is completely untested.** WhatsApp on Android has historically used an
isolated WebView, and Google refuses OAuth sign-in from embedded WebViews, so
sign-in there may behave differently from the confirmed iOS result. Exposure is
narrow — only a host signs in with Google, guests never do — so this blocks other
people hosting rather than the first family session.

**Infrastructure for simulating players in tests.** Not needed for the first slice,
where the low end is three or four players and four browser profiles on a laptop
suffice. Needed once groups of fifteen and up are being tested. Imposter Game
solved part of this with two-client tests against an emulator.

**Room-code expiry still passes through a client clock.** The 2026-09-07
outage (see DECISIONS.md) was fixed by having the client ask for less than the
rule's ceiling — `ROOM_CODE_CLOCK_SKEW_MARGIN_MS`. That absorbs any realistic
skew but does not remove the class of bug: a device more than thirty minutes
fast is still denied. The principled fix is to keep expiry entirely in server
time — write `createdAt` with `serverTimestamp()`, have the rule assert
`request.resource.data.createdAt == request.time`, and derive expiry as
`createdAt + window` inside the rule, so no client clock enters any
comparison. Deferred because it means moving that field from an epoch-millis
number to a Firestore `Timestamp`, which is inconsistent with every other
timestamp in the model (`joinedAt`, `lastSeenAt`, `createdAt` everywhere) —
worth doing as one deliberate pass over all of them, not as a one-field
exception.

**Orphaned session data is never actually deleted.** Milestone 3 made a reclaimed
room code point at a brand-new session, leaving the old one's document and every
subcollection (players, items, votes) in place but unreachable - see
DECISIONS.md, "Decisions made in milestone 3". Harmless to correctness and cheap
at this scale, but real cleanup needs something that can walk and delete
subcollections, which is a server this app deliberately does not have. Worth
doing once storage or privacy (an abandoned gathering's data sitting around
indefinitely) actually costs something - not before.

---

## Deferred implementation

**Participant without a phone.** The design is settled — requirements declared as
data, and the rule that a game needing secret per-player information cannot include
a participant without a screen. What is deferred is the interface work: voting on
their behalf every round in every game, and typing on their behalf during a
time-pressured harvest. The cost was underestimated originally.

**Consequence of deferring it:** the first family session has to be assembled from
people who all have a phone, which slightly weakens the value of that test, since
its whole point is a group that is mixed in age and less technologically forgiving.

Re-enters scope when a third game is added, or when a real gathering is blocked by
it.

---

## Deliberately out of the product

Not backlog — these are not "later", they are "no", unless the thesis changes.

Payments, content packs and commissions. User-submitted game ideas in the first
version — the submission pipeline with a moderation interface is planned later, and
consciously as an engineering showpiece rather than a growth engine. A native app.
Remote play where participants are not in the same room, since the entire value
depends on physical presence. A browsable catalogue of all games.

---

## Deferred from the milestone-2 security re-review

Found by an independent review of the *fixes*, and deliberately not fixed in
milestone 2 because each belongs to a milestone that has not been built yet.
Recorded with the finding intact so none of them is rediscovered from scratch.

**Room-code lifecycle and squatting — resolved in milestone 3.** See
DECISIONS.md, "Decisions made in milestone 3": the session id is now a random
unguessable string, the room code lives in its own `roomCodes/{code}` document
with a bounded, reclaimable `expiresAt`, and the fix is mutation-checked in
`room.test.ts` and `firestore-rules.test.ts`. `SessionDoc.expiresAt` remains
unenforced by rules - it is display-only now, carried over from the room
code's own expiry at creation - since the session document itself is never
deleted regardless of what it says.

**Item ids must be unguessable — milestone 4.** The claim-before-item ordering
that closed authorship theft made this a security requirement rather than a
convenience: a predictable id lets another player pre-claim it and permanently
block that submission, since claims cannot be updated and only the host can
delete one. Written next to `ITEM_WRITE_ORDER` in `src/lib/model.ts`; repeated
here because it is the kind of requirement that gets optimised away by someone
who thinks sequential ids read better.

**Orphan claims are unbounded — milestone 4.** A claim can be created for an id
that never becomes an item, with arbitrary fields and no size or count limit.
Harmless to correctness, unbounded in storage. Wants a field shape check and a
per-player cap when the harvest is built.

**Skip has nowhere to be recorded — milestone 5.** Item deletion was removed
(it was what opened the reveal guard), and `revealed` only flips one way, so a
skipped item is now byte-identical to one that simply never got a round.
**This matters at milestone 7:** unrevealed items are kept as facts for future
gatherings, so on the current model the offensive item the host skipped is
retained, attributed, and resurfaced at the next gathering — exactly what the
skip button exists to prevent. Needs either a `skipped` field on the item or a
skip record on the round.

**The host preview is already defeated — milestone 5.** Players may list `items`
from the moment of submission and read `rounds` during the `preview` phase, so a
player with devtools sees the item under preview before the host reads it out.
DESIGN: "if everyone sees the item at the same time he does, the button is
worthless." Pre-existing rather than caused by the fixes, and squarely on
milestone 5's gate, which tests exactly this device.

**`PlayerDoc.uid` can lie — routine.** The rules check the document id against
the caller's uid but never the `uid` *field*. Harmless while client code keys
off the document id, a trap the day it keys off the field.

## From the milestone-3 security re-review

**Session creation doesn't constrain `phase`/`scores` — routine.** A host can
open a session already `phase: 'finished'` with fabricated `scores`. No
cross-user exposure - it is their own session - but worth a field-shape check
whenever `sessions` create is next touched.

**Session update lets the host freely rewrite `roomCode`/`groupId`/
`currentGameId` — routine.** No security effect, since nothing in the rules
gates on those fields, but it is a data-coherence gap: `SessionDoc.roomCode`
can drift from what `roomCodes` actually points to. Same fix shape as the item
lock above - `affectedKeys()` bounded to the fields a given transition should
touch - if this bites in practice.

**`VoteDoc.votedForPlayerId` is never checked against the roster — routine.**
A player can vote for a uid that isn't a player in this gathering. Votes stay
hidden until reveal either way, so this is not a leak, but scoring logic
(milestone 5) should not assume every vote resolves to a real player.

## From the milestone-3 mobile-reality and scenario reviews

Two independent reviews converged, unprompted, on the same three serious
findings, all fixed in the same pass as this file's other entries: a presence
dot that read "everyone left" during the lobby's normal steady state, a
share mechanism that was silent on both success and failure with no visible
fallback, and error/loading screens with no retry. What follows is what was
deliberately NOT fixed alongside them, and why.

**Real per-player presence needs a different mechanism, not a wider window.**
The dot is gone from the lobby (see the comment in `Lobby.tsx`) because
tuning `PRESENT_WINDOW_MS` cannot fix a locked phone whose JS timers stop
rather than slow down - "prefer removing a failure mode to tuning it." A
correct version would need `serverTimestamp()` (removing the client-clock
class of bug entirely, same fix already proposed for `roomCodes.expiresAt`)
and a genuinely different UX framing than a binary online/away dot, which the
lock-cycle DESIGN itself documents makes misleading on principle. Revisit once
a screen actually needs to distinguish "here" from "away" - nothing in
milestone 3 does.

**No QR code and no manual code-entry screen.** DESIGN names QR as the
fallback join channel; neither it nor a "type a code" field exist. The fix
shipped alongside this entry (a visible, selectable join URL under the code)
closes the immediate "the copy button failed and there is nothing else"
dead end, but the 4-digit code shown to the room still has nowhere to be
typed. Building the QR fallback and a manual-entry field is real feature
work, not a quick fix - deferred until a session without a working link
(no clipboard, no share, no camera) actually happens.

**Duplicate names have no disambiguation.** Harmless in a lobby; becomes a
real blocker at milestone 5/6, which vote for a person **by name**. Needs
deciding before then - append a number, show the join order, or require
uniqueness at join time.

**A "ghost" player row can never be removed from the UI.** The rules already
allow the host to delete a player document; no control exists to do it. Bites
whenever someone re-joins under a fresh uid (cleared storage, "Open in
Safari" from the WhatsApp browser) and their old row just sits there.

**No Open Graph image.** The `og:title`/`og:description` tags added alongside
this entry give WhatsApp's link preview *something*, but there is no art
asset for `og:image` yet - the preview card will still be plain.

**Smaller, not worth their own entry:** no `navigator.wakeLock` request to
keep a phone's screen on during the harvest/round loop (would reduce how
often the lock cycle bites, but is a real UX tradeoff - draining a guest's
battery - not an unambiguous win); no `pageshow`/bfcache handling for
`visibilitychange` (iOS Safari has historically been unreliable there;
bounded cost today since the interval alone catches up within 25s); the
780KB single JS bundle has no code-splitting and no loading shell, so the
first paint on a slow shared wifi is a blank white screen; `npm run
test:rules` requires `.env.local` to exist even though `room.test.ts` never
touches the real project, because importing `room.ts` pulls in
`firebase.ts`, which throws on missing env vars at module load.

## From the milestone-4 four-lens review

The two serious findings (the submission slot being readable by every player,
and a killed device stranding its own submission permanently) were fixed in
the same pass, not deferred - see DECISIONS.md, "What the milestone-4 review
found." What follows is what was left.

**The harvest progress figure counts items, not people.** `useHarvestProgress`
shows the host "N answers so far" across both prompts, so four answers could
be four people who answered one prompt each or two who answered both - a host
deciding whether to give the room another minute cannot tell those apart.
Counting *submitters* instead is not a small change: it would mean reading the
submission slots, and those are now readable only by their own owner, because
a slot pairs a uid with an item id and `items` is public - exactly the answer
key `itemAuthors` withholds. So the honest options are a host-only aggregate
that does not exist without a server, or leaving the item count as the
approximation it is. Left as-is deliberately; revisit if the host actually
struggles with the call at a real gathering.

**An answer typed but not sent when the host advances is lost silently.** The
phase flip unmounts the harvest screen mid-keystroke. Persisting the draft
would not help - submissions are closed by then, in the rules as well as the
UI - so the only real improvement is a warning before the host advances, or a
"you didn't finish this one" acknowledgement afterwards. Neither is built.

**A submission whose first write lands just before the host advances is lost.**
The slot's create is gated on `phase == 'harvesting'` and so is the item's, so
a sequence that straddles the host's tap reserves a slot it can never fill.
The player sees a submission error, the harvest is over anyway, and the slot
is inert - no wrong state, just an answer that did not make it. Fixing it
properly needs the whole submission to be one atomic write, which the
claim-before-item ordering deliberately prevents.

**No host control to clear a stranded slot.** The rules allow the host to
delete one; no UI does. Much less pressing now that a retry resumes a
stranded slot on its own, and only reachable at all if a slot can never be
completed (the straddle case above).

## From the milestone-5 four-lens review

The nine serious findings were fixed in the same pass - see DECISIONS.md, "What
the milestone-5 review found". These were judged routine and left.

**The round counter counts, but the room cannot see who it is waiting for.**
The host gets "5 of 8 voted"; with eleven phones, knowing *which* three are
outstanding is what actually lets them chase it. The roster already carries
`votedRoundId`, so this is a display change, not a data one.

**A player who joined mid-harvest and submitted nothing still votes.** Correct
per DESIGN (they are in the room), but they have no stake in the round; nobody
has decided whether that is worth distinguishing.

**Round ids are derived from the round's position** (`{gameId}-r{n}`), which is
what makes two host devices collide on one document instead of opening two
rounds. It also makes them guessable - harmless today, since a round holds no
secret (its votes and its item's author are protected separately), but worth
remembering before anything secret is ever keyed by a round id.

**`sessions.scores` is unconstrained for the host**, who is also a scoring
player, and `players` update is unconstrained for its owner, so a player could
set `votedRoundId` without voting. Both are inherent to a client-only app with
no server to arbitrate: the host can already end the gathering, and the second
only skews an advisory counter. Worth revisiting only if the app ever gets a
server.

**The Harvest screen has no slow-connection notice.** `Rounds.tsx` grew one (a
Firestore write on a phone that has quietly lost its connection never settles,
so the button sits disabled forever); `Harvest.tsx` has the same shape and did
not get the same treatment in this pass.

## From the milestone-6 four-lens review

The eight serious findings were fixed in the same pass - see DECISIONS.md,
"What the milestone-6 review found". These were left.

**The same item can come up in both games, and the second game's question can
repeat.** A gathering uses two prompts, so up to ten "most likely to" rounds
share two question sentences. It is not wrong - the item quoted each time is
different - but a room may notice the repetition before the ten rounds are up.
Worth revisiting when there are more prompts per gathering, or a third game.

**The second game reuses the first game's ten-round cap.** Nobody has decided
whether a second game should be shorter; ten plus ten plus a harvest may be
longer than the 10-40 minutes DESIGN targets. The host can end either game
early, so this is a default, not a limit.

**`rounds` create does not check that the round's item belongs to the round's
game.** A host could point a second-game round at an unrevealed first-game
item. No leak follows (item text was always readable to players, and
`itemAuthors` still requires the item to be revealed), and the client never
does it - but the rule says less than the client assumes.

**`Finale` is terminal with no way out.** Correct - the session phase is
monotonic by design - but a player who lands there mid-evening because the
host ended early has no route back to anything, including a new gathering.

**The scoreboard sits below a long reveal on a phone.** After a vote breakdown
for eight people plus the awards, the standings are off-screen at the moment
the room most wants them.
