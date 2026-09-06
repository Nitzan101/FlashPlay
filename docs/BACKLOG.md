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

**Room-code lifecycle and squatting — milestone 3.** The room code is now the
session's document id (forced by denying collection listing), and session
deletion is denied (a deleted id would let the next creator inherit the previous
gathering's subcollections). Two consequences neither of those fixes addressed:
codes are never released, and any signed-in client can create a session on any
unused code, permanently denying it to a real host. **This wants deciding when
joining is built:** most likely a long random session id with the short code as
a separate `get`-only lookup document, plus a code-expiry story. `SessionDoc.expiresAt`
currently has no enforcement behind it at all.

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
