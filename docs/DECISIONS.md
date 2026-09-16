# FlashPlay — Decisions

Why each choice was made. [DESIGN.md](./DESIGN.md) states what the product is;
this file holds the reasoning, so that a decision does not get re-litigated
three weeks later, and so the "why" is available when explaining the project to
someone else.

Decisions are grouped by what they are about, not by date.

---

## Product and scope

**Audience is consumer and family, not organisational.** This is an independent
project rather than a Ti-Space venture, so Ti-Space's process rules do not bind
here. The goal is a portfolio piece; the success measure is real use — how many
groups and how many gatherings actually ran — not revenue. There are no payments
and no paid tiers in the first version, and at no point is a gathering blocked
mid-flow over money.

**Rank candidates by dependence on the differentiator, not by perceived
quality.** A taste test over nineteen games ranked by "how good a party game is
this" put the most *generic* games on top — the ones that work with a deck of
cards and total strangers. Generic quality is exactly what every competitor has
already optimised, so ranking by it steers into the crowded end of the market.
The threshold test in DESIGN.md replaced it.

**A wizard is wanted; a catalogue is not.** These are not the same thing, and
conflating them was a repeated error during planning. Guided selection and wide
variety both survive; only the browsable list of everything is cut.

**Few state machines is not the same as few games.** Formats are code and
expensive; games are configuration and cheap. The plan is deliberately few
formats and many games.

**The first slice is two games, both with zero AI.** Proving that the second game
is built from the first one's material is the whole differentiation, and doing it
without the generator means a failure in testing is unambiguous: the loop or the
content, not "maybe the model had a bad day". The AI game comes next, against
stable infrastructure.

**"Most likely to" was chosen for the first slice on engineering grounds, and it
is the least exciting game on the list.** Recording that explicitly so nobody
later mistakes it for the product's high point. It reuses the first game's voting
component and needs no AI.

---

## Memory and privacy

**A fact's scope is set by the wording of the question that collected it, not by
a classifier.** A classifier is wrong sometimes, and when it is wrong an intimate
family fact appears at a gathering with colleagues. No accuracy threshold makes
that acceptable, so the failure mode is removed rather than tuned.

**Group facts never leave their group; personal facts travel with the person.** A
personal fact is context-free by definition. A group fact is not, and a fact from
a night out surfacing at a family dinner is a severe product failure rather than
an inconvenience.

**Facts are written at the end of each game, not at the end of the gathering.** An
abandoned session then keeps whatever was already played.

**Facts are attributed to their author in storage even when display is
anonymous.** Otherwise a personal fact cannot travel with the person. The
anonymity is a display and access-rules property, not a storage property.

**Selection prefers unused facts and never repeats one within a gathering.** A
simple counter carries most of the quality gain with no machine learning.

**The "what we remember about this group" screen is open to the group owner
only.** Otherwise the transparency feature is itself the hole through which a
guest siphons a family's memory.

**Contacts are per-user, and two hosts who know the same person hold separate
records.** Slightly wasteful, and it is what prevents the system becoming a global
social graph.

**Rejected: a learned relationship graph, and cross-group identification of
unregistered users.** The first is a large machine with no consumer — no game
needs it. The second is fingerprinting people: technically shaky and hostile on
privacy. Reconsider only if a concrete game demands them.

---

## Interaction and hosting

**Push per-case variation into declared data, not into a decision the host
manages.** "It depends on the game" is the right answer and the wrong
implementation. Each game declaring its own requirements, with one layer
filtering on them, means the host never sees a half-working option and never
learns the mechanism exists.

**The host is always a player, and the host's screen never contains the answer.**
One host model rather than six that drift apart. If a game needs a neutral judge,
the app is the judge.

**A manual skip button, not automatic content filtering.** Filtering misses family
teasing, which is most of the fun, and blocks legitimate content, and has no
correct threshold. A human deciding one item at a time does not have that problem.
The skip button requires a host-only preview stage, or the damage is already done
by the time the button is available.

**Text is shown on all phones, always.** Originally the host was to read aloud with
other screens blank. Walking through a real evening broke that: anyone who did not
hear, in a noisy room or because they are hard of hearing, is excluded from the
round entirely. Accessibility beat the aesthetic of "the app is not the centre of
attention", which is preserved by the voting being social instead.

**Joining is allowed during the submission phase, blocked only inside the round
loop.** "Only between games" sounded reasonable until the evening was walked
through: the first game is the harvest and runs a quarter of an hour, so someone
two minutes late gets a fifteen-minute waiting screen as their first impression.

**A link into WhatsApp, with QR as fallback.** A QR code means passing one phone
between eleven people — slow, awkward, and exactly where the under-two-minutes
promise breaks. The family already has the channel.

**Split a flow by urgency, not by topic.** What blocks other people goes first;
what is patient waits. Carried over from Imposter Game, where letting the host
share a link in one tap and tune settings afterwards removed the whole "everyone
is waiting on me" moment.

**Registration is an offer, not a toll.** The ask appears at the moment its value
is visible, as a sentence rather than a gate.

---

## Architecture and stack

**A new repository, not an extension of Imposter Game.** That project is live with
real users and there is no reason to destabilise it, and two portfolio projects
beat one.

**The same stack — React, TypeScript, Vite, Tailwind, Firebase/Firestore — chosen
for being proven rather than for being new to learn.** Start from the problem, not
from "it would be good to know this technology".

**The room layer is copied from Imposter Game rather than rebuilt** — presence
heartbeat, session resume, host migration. **The conscious cost:** copying instead
of sharing a library means the two copies will drift and a fix in one will not
reach the other. Acceptable at one-person scale.

**Session state lives on the server, not the host's browser.** Disconnections
across twenty phones are a certainty, not an edge case.

**A separate Firebase project from the live Imposter Game one.** Otherwise testing
hits real users. Created as `flashplay-50bde` on 2026-09-06.

**The generator is a runtime language model with automatic fallback to
pre-written templates.** A slow or failed generation must never stall a live
gathering; it continues from a template with nobody in the room noticing.

**The generator is not built in the first slice.** The two chosen games do not need
it, which is the entire point of choosing them.

**Repository language: code and documentation in English, product content in
Hebrew.** `CLAUDE.md` loads every session and Hebrew costs two to three times the
tokens for the same content; mixing Hebrew prose with English identifiers produces
exactly the bidirectional-text mess there is no reason to take on outside the
product itself; and whoever opens the repository in an interview needs to read it.

**i18n infrastructure from day one, Hebrew-only content at release.** In Imposter
Game what got translated were word lists, which translate cleanly. Here the content
*is* the product, and a prompt like "something Mum would say when she is annoyed"
is a rewrite in another culture rather than a translation. Expanding to English
will be a content decision, not a code refactor.

---

## Build order and verification

**Milestone boundaries are set by risk, not by architectural layer.** Each
milestone ends where the riskiest remaining assumption actually gets tested.
Splitting by code layer is convenient to build but pushes the real risk to the
end, and the biggest risk here is not engineering.

**Security rules are milestone 2, not the last step.** The hidden-author mechanism
depends on them, and without it the first game is broken.

**The data model and the security rules were split.** The data model must precede
the room, or document shapes get guessed and then rewritten. The rules only become
load-bearing at the harvest and round loop. Splitting them is what allows "a room
that works and can be shown" to arrive earlier without endangering the critical
part.

**The paper test was proposed and declined.** The proposal was to test the riskiest
assumption — that people write boring material — with sticky notes in twenty minutes
before any code. Nitzan chose to build something working first. The assumption his
decision rested on was corrected: a single round of "Who said that" requires
milestones 1 through 5, including both of the only two milestones marked large, so
there is no smaller working version to test it on. **The recorded consequence:** the
first signal on content quality now arrives at milestone 5 rather than before
milestone 1. **The mitigating factor that makes the decision reasonable:** that
infrastructure is built in every scenario anyway, and the fix for flat prompts is
content rather than architecture — so the risk is wasted time, not discarded code.

**A milestone closes on a two-part gate.** Independent subagent review for
everything that can be read or run, and a run with real people for everything that
cannot — whether the material is funny and whether the evening flowed are not
verifiable by review at any level of thoroughness.

**The review is a fixed number of passes, each through a different lens, with a
severity bar — not a loop until it comes back clean.** A reviewer asked again always
produces something, so an unbounded loop closes on a tired reviewer rather than on
clean work. Only a finding that would break something or block progress holds the
gate; routine ones go to the backlog.

---

## Findings from building (milestone 1)

**The app must be served from `flashplay-50bde.firebaseapp.com`, not the
`.web.app` twin.** Firebase gives one Hosting site two domains, and only
`firebaseapp.com` is the `authDomain` and the OAuth redirect URI registered with
Google. Served from `.web.app`, redirect sign-in fails *silently*: Google accepts
the login, the browser returns, and the app is still signed out with no error
anywhere. Since the product's entry point is a link pasted into a WhatsApp group,
the wrong one of two near-identical URLs getting shared is a matter of time, so
`src/lib/canonicalHost.ts` redirects it rather than relying on anyone remembering.

**Pointing `authDomain` at `.web.app` is not the fix.** Tried; Google rejects it
with `redirect_uri_mismatch`, because only the `firebaseapp.com` handler URI is
registered. The direction that works is moving the app to the auth domain, not the
auth domain to the app.

**On iOS, WhatsApp's in-app browser shares storage with Safari.** DESIGN flagged as
a real risk that someone who signs in from WhatsApp and later opens the link in
their real browser becomes a different player. Tested on 2026-09-06: it does not
happen on iOS — identity survives the move to Safari. Opening in Chrome does start
signed out, which is ordinary browser behaviour rather than a defect. **The
mechanism is inference from the observed behaviour, not verified directly.**

**Android is untested and the exposure is narrow.** WhatsApp on Android has
historically used an isolated WebView, and Google refuses OAuth from embedded
WebViews, so it may behave completely differently. But only the *host* signs in
with Google — guests join with a name and never touch OAuth — so the exposure is an
Android host. That does not block the first target and does block anyone else
hosting.

**The repository lives outside the OneDrive-synced vault.** Building it inside the
vault was tried and reverted the same day: `node_modules` was 13,388 files and
272 MB of continuously churning, fully regenerable content syncing to the cloud,
and OneDrive holding write locks during a build is a source of intermittent,
hard-to-diagnose failures. The mitigation attempted — a directory junction pointing
outside OneDrive — does not survive `npm install`, which deletes it. The argument
that settled it: one session reads and writes both the vault and the code folder
freely, so co-locating them bought nothing.

---

## Open, not yet decided

**The name.** FlashPlay describes the direction better than the original
EventFlow. Not finally settled.

**Formats and games beyond the first version.** The first target is closed. After
it, the fifteen approved games in an order determined by what the testing teaches.

---

## Findings from building (milestone 2)

**Guests sign in anonymously.** DESIGN says a guest enters with a name only and
is never blocked. That is about friction, not about identity: security rules
need a subject to authorise against, so every player - guests included - gets a
Firebase anonymous uid. It costs the guest nothing (no screen, no decision) and
it is what makes every other rule in the file enforceable. A player document's
id *is* that uid, which makes "write someone else's vote" and "rename another
player" structurally impossible rather than merely checked.

**The host's fact store is not readable by people in their own gathering.**
Contacts, groups and facts live under `users/{uid}` and stay there. A gathering
copies in only the items actually in play. The join link is a bearer token that
can be forwarded out of the WhatsApp group, so "is in the room" cannot be
allowed to mean "can read this family's accumulated memory".

**Item author documents are unreadable even by their own author before the
reveal.** The author already knows who they are, so allowing it buys nothing -
and a rule carrying an "unless it is yours" exception has a second path through
it, which is where a leak eventually appears. One condition, no exceptions.

**A vote's document id is the voting player's uid.** Double voting is then
impossible by construction rather than by a check that could be forgotten.

**Firestore's location is chosen permanently, and `firebase deploy` will choose
it for you.** Deploying rules to a project with no database silently created
one in `nam5` (United States) - for an app whose users are all in one room in
Israel, with real-time listeners firing on every vote. Caught immediately and
corrected to `me-west1` (Tel Aviv) while the database was still empty; after any
real data exists this becomes a migration rather than a one-minute fix. **The
general lesson: a deploy command that finds missing infrastructure may create it
with defaults nobody chose. Check what exists before deploying into it.**

## Decisions forced by the milestone-2 security review

These are not bug fixes; they are design commitments the fixes made necessary,
and later milestones have to build on them.

**The room code was the session's document id, until milestone 3.** Listing the
sessions collection is denied, because granting it let anyone enumerate every
gathering on the project - room codes, hosts, scores - with no join link at
all. That leaves only `get` by a known id, so there is no query that can turn a
typed room code into a session. Making the code the id removed the need for
one. **Superseded below** - the "decisions made in milestone 3" section
explains why this could not stay, and what replaced it. The `get`-only
constraint itself did not change; only what a client resolves by `get` did.

**The author claim is written before the item, and the rules enforce it.** With
the item written first, its id appeared in a listable collection while its
authorship was still unclaimed, and any other player could claim it - not as a
microsecond race but for as long as the real author had not got round to it.
Inverting the order closes it structurally: claims are unlistable and
first-write-wins, so a claim made before the item exists cannot be observed or
raced. Client code must write both in one batch, claim first. See
`ITEM_WRITE_ORDER` in `src/lib/model.ts`.

**Item documents are never deleted.** The host's skip button was assumed to
delete an item; it does not need to, and deletion is what opened the reveal
guard. Skipping is the host declining to create a round for that item, which is
a client-side decision requiring no write at all. Items are therefore immutable
after creation except for the one-way `revealed` flip.

**The host can read unrevealed authorship once the gathering is finished.** This
is a deliberate second path through a rule that otherwise has one condition, and
it is worth naming as such because "a rule with an exception has a second path"
is elsewhere in this file as a warning. The justification: DESIGN keeps the items
that never got a round as facts *attributed to their author*, there is no server
to do that attribution, and the alternative is data that no participant can ever
read. It is host-only and post-gathering, so it cannot help a player during play,
and it is `get`-only, so it cannot be used to sweep the collection.

**A guard must not read state its subjects can write.** The generalisation of S1,
recorded here because it is the one most likely to recur: the reveal guard read a
flag from a document the locked-out players were allowed to create. Whenever a
rule's condition depends on stored state, the question is who can write that
state.

## Decisions made in milestone 0 (the prompt pool)

**The second game must quote the item, not re-tell it — a Hebrew constraint
that English hid.** DESIGN requires an item's text to pass from "Who said
that" into "Most likely to" *as it is*, wrapped only in a different question,
because there is no AI in the first slice to splice free text into a template.
In English that is invisible: "left his phone on the car roof" reads the same
whoever is saying it. Hebrew conjugates for person, so an answer written as
`שכחתי את המפתחות` cannot be re-read as David's without becoming `שכח`, and
nothing in the first slice can do that transformation. This much held up.

**The first proposed wrapper - `{name} כתב: «...»` - was itself wrong, and
the pool's own gate review found it.** Two bugs, not one: `כתב` is masculine,
ungrammatical for a female player, and `PlayerDoc` carries no gender field to
fix it with - there is nothing to inflect the verb from. Separately, and
worse, most prompts here open with `משהו ש...`, whose natural answer under
time pressure is a bare noun (`גבינה צהובה`, `מכונת אספרסו`) - quoted after
any verb, "who is most likely to do **that**" has no antecedent and reads as
nonsense for roughly three-quarters of the pool.

**The actual fix: every prompt carries its own second-game question.**
`HarvestPrompt.secondGameQuestion` (`src/content/prompts.ts`) is a
genderless, infinitive-form question - Hebrew's infinitive has no person and
no gender - that already contains the verb the bare-noun answer is missing:

    התשובה של דוד: «גבינה צהובה». מי מכם הכי עלול לאכול את זה
    בעמידה מול המקרר?

`התשובה של {name}`, never `{name} כתב`. **This is a constraint on milestone
6's wording, not just a content note** - the render function that builds this
sentence must use `secondGameQuestion`, never construct its own question from
the prompt text, or every fix above is silently undone.

**Two prompts were removed for social risk, not content quality, with no
skip button built yet to catch them otherwise - and the first fix for both
was itself re-reviewed and found insufficient.** `nobody-looking` invited a
literal private confession, read aloud with the author's name attached, to a
room that could include a nine-year-old. Its first replacement,
`checked-if-seen` ("did something, then looked around to check if anyone
saw"), was caught by a second review re-judging the fix fresh: it reproduced
the identical social-risk shape under different words, and duplicated
`hid-something` in spirit besides. Replaced again with `sing-when-alone`
("a song you sing when you're home alone"), deliberately outside the
secrecy/deception theme rather than another variation inside it - this is
also what actually reduces that theme's over-representation in the pool,
which swapping one confession prompt for another cannot do.

`small-lie` (as originally written, with no time bound) read as an
accusation delivered in front of whoever was lied to. The first reframe -
to childhood - only half-worked: a childhood lie's target is very often the
parent still sitting at the same table decades later, and "when you were
children" is not a distancing frame for players who currently are children.
Reframed again to a lie told to *yourself* (`שקר קטן ומצחיק ששיקרתם
לעצמכם`) - this removes the present-victim problem structurally, since the
liar and the "victim" are the same person, rather than by degree, and it
works identically for a nine-year-old and a grandmother.

**The general point, worth carrying past this file:** re-reviewing a fix
found a second-order version of the same defect on both of the first
review's social-risk findings. A fix that changes the words but not the
shape of a problem is not a fix, and the way to catch that is asking the
second review to judge the replacement fresh rather than checking whether
the reviewer's own suggestion was applied correctly.

**All first-slice prompts collect personal facts, not group facts.** The
model supports both drawers, but both chosen games need an item attributable
to one named person - "something that happened to us" cannot be re-asked as
"who is most likely to do that". Group-drawer prompts arrive with a game that
wants them. Asserted in `prompts.test.ts` so that adding one is a deliberate
decision rather than a slip.

## Decisions made in milestone 3

**The room code stopped being the session's document id.** Making the code the
id (above) closed enumeration, but it meant a code could never be released -
BACKLOG's "Room-code lifecycle and squatting" recorded the consequence: any
signed-in client could open a session on any unused code, permanently denying
it to a real host, and an abandoned gathering held its code forever since
sessions cannot be deleted. Fixing this required decoupling two things that
milestone 2 had fused: the address of a gathering's data, and the human-facing
code that finds it.

The session id is now `crypto.randomUUID()` - unguessable, so nothing is lost
by it never appearing in a listable collection. The code lives in its own
`roomCodes/{code}` document (`RoomCodeDoc` in `src/lib/model.ts`), `get`-only
for the same enumeration reason as sessions, mapping the code to the session id
it currently points at. Its `create` is bounded on both ends by
`ROOM_CODE_WINDOW_MS` (12 hours: generous headroom over a 10-40 minute
gathering, chosen because there is nothing to calibrate against yet - not a
measurement) so a code cannot be reserved indefinitely, and its `update` is how
an expired code returns to circulation: Firestore evaluates any write to an
existing document id as `update` regardless of which client call produced it,
so reclaiming is a plain overwrite once `resource.data.expiresAt` has passed.
No Cloud Function needed - the emulator suite proved this by deleting the
`resource.data.expiresAt < request.time.toMillis()` clause and watching the
"refuses to overwrite a code that has not expired yet" assertion go red.

**The session document itself is still never deleted**, and that is now
actually safe rather than merely enforced: an unguessable id cannot be
re-targeted by anyone, so a reclaimed code's old session just becomes
unreachable garbage, not a re-creation risk. Real deletion (freeing the
storage, not just the code) would need something to walk and delete every
subcollection, which is a server this app deliberately does not have -
recorded in BACKLOG if that cost is ever worth paying.

**Opening a gathering now requires a registered host, enforced in rules.**
DESIGN always said "a registered host (Google, one tap) is required to open a
gathering," but nothing before milestone 3 checked it server-side - a guest's
anonymous token could create a session like anyone else. `isRegistered()`
reads `request.auth.token.firebase.sign_in_provider`, the standard Firebase
Auth claim every real Firebase Auth token carries - `'anonymous'` for a guest,
a real provider id (`'google.com'`) for a host. Mutation-checked: neutering
the function to `isSignedIn()` turned two assertions red (a guest opening a
session, a guest claiming a room code).

### An independent review of the first version, and what it found

The same discipline as milestone 2: re-reviewing the fix is not ceremony.

**A room-code claim was never checked against the session it claimed to point
at.** The first version of the `roomCodes` rules bounded `expiresAt` and
required `isRegistered()`, but nothing verified that `sessionId` and `hostUid`
in the write actually corresponded to a real session the caller hosts - a
client could name any sessionId and any hostUid it liked. This was structural,
not an oversight in the condition: at the time the code was claimed, the
session didn't exist yet for the rule to `get()`. Fixed by reordering
`createRoom` (`src/lib/room.ts`) to create the session first, then claim the
code, then patch the session's display-only `roomCode` field once the code is
known - which gives both the `create` and `update` rules something real to
check: `get(sessions/$(sessionId)).data.hostUid == request.auth.uid`.
Mutation-checked: removing that clause from `create` turned red both "refuses
to claim a code for a session hosted by someone else" and "...that does not
exist."

### A security review found a fourth hole: revealed items were not locked

**Constraining the `revealed` flag alone left every other field on that same
write open.** `items` update required `revealed` to flip false→true and
nothing else, so `updateDoc(item, { revealed: true, text: 'forged' })`
succeeded - the host could rewrite what a claimed author supposedly wrote at
the exact moment the room reads it. This is not cosmetic: milestone 0's
decision that an item's text passes into the second game *untouched* assumes
the text seen at reveal is the text that was actually submitted, and the host
is a scoring player with a documented history of needing exactly this kind of
guard (S1, F1). Fixed with
`request.resource.data.diff(resource.data).affectedKeys().hasOnly(['revealed'])`.
Mutation-checked: removing that clause turned red "refuses the host rewriting
text in the very update that reveals it."

Two more from the same review, real but not blocking: `sessions` create does
not constrain the initial `phase`/`scores` (a host can open a session already
`finished`, with fabricated scores - self-inflicted, no cross-user exposure),
and `sessions` update lets the host freely rewrite `roomCode`/`groupId`/
`currentGameId` (no security effect, since nothing gates on them, but a
coherence gap). Both in BACKLOG.

### A second independent review, on the coverage claims themselves

**One of this document's own mutation-check claims was false.** The line
above it - "isRegistered()... turned two assertions red" - was written after
mutating `isRegistered()` and watching the `sessions` and `roomCodes` "refuses
a guest's anonymous token" tests both go red. What was missed: the `roomCodes`
version of that test named a session hosted by someone else, so it was
**already failing the session cross-check regardless of registration** -
overdetermined, unable to say which guard actually did the denying. A second
independent review re-ran the exact mutation and caught it: neutering
`isRegistered()` alone flipped only the `sessions` test. Fixed by giving the
`roomCodes` test a session genuinely hosted by the guest, which isolates
`isRegistered()` as the only clause that can fail - re-verified, and the claim
above is now true. This is the same failure mode as "The 'registered host'
tests were passing for the wrong reason," above, recurring a second time
inside the very sentence written to record the first instance. The general
lesson - a coverage claim is unverified until someone re-derives it, including
the person who wrote it - is in the vault's Rules of Thumb rather than repeated
here again.

### The first live run: three bugs, one shape

Three separate failures on the first real use, each fixed with a test that
fails without the fix. They are worth reading together, because the reason all
three survived a green suite is the same reason, and it generalises:

**Every one of them hid behind a test double that could not produce the real
failure.** The emulator cannot skew a clock - its client and server are one
machine. A mocked `resolveRoomCode` returned success to an unauthenticated
caller, which real rules never do. A mocked `getDoc` answered "document does
not exist" where real rules answer "permission denied" - and the client
branched on which answer it got. In each case the double did not merely miss
the bug; it **manufactured a state the real system cannot produce, and the
test then certified that state as correct.**

The rule that follows: whenever correctness depends on an enforcement boundary
outside the code - security rules, a real clock, a real server - at least one
test must run against the real boundary. Where the boundary genuinely cannot
be reproduced, encode the hostile input in the data instead, which is how the
clock-skew fix is tested without owning a second clock.

**Bug 2: the guest read before it had an identity.** Anonymous sign-in ran
when the guest submitted their name, but the join screen reads the room code
before that - and every rule, including `roomCodes`, requires `isSignedIn()`.
Sign-in now happens the moment a join link is opened, before any read.

**Bug 3: membership was a question the guest was forbidden to ask.** The
client checked "have I already joined?" by reading its own player document.
`players` is `allow read: if isPlayer(sessionId)`, and `isPlayer` is only true
once that document exists - so a first-time guest is denied by the very rule
that protects the roster from outsiders. This is the milestone-2 protection
working exactly as designed, with client code walking straight into it.
Membership is now answered from `localStorage`, which also removes a network
round trip from the join path - the path the two-minute promise is measured
against.

### Bug 1: a 200ms clock broke everything

Every automated check was green — 67 emulator assertions, three
mutation-checked guards, an independent review — and the very first click of
"open a room" against real Firestore failed, deterministically, every time.

**Cause: the room-code rule compared a client-computed timestamp against
server time with zero margin.** The ceiling was `expiresAt <=
request.time.toMillis() + ROOM_CODE_WINDOW_MS`, evaluated on Firestore's
clock, while the client sent `Date.now() + ROOM_CODE_WINDOW_MS` from its own.
That inequality holds only if the client is not ahead of the server *at all*.
The laptop ran roughly 200ms fast, so every claim was denied — all eight
retries, every attempt, forever.

**Why nothing caught it.** The emulator runs client and server on one machine
with one clock, so the client's timestamp is never ahead of the server's.
**This class of bug is invisible to the emulator by construction**, which is
worth stating plainly: a green rules suite says nothing about any rule whose
truth depends on the relationship between two clocks. Session creation kept
working throughout, because its rule contains no timestamp comparison — which
made the failure look like it was in the newly-added `get()` cross-check, the
one clause that was entirely innocent.

**Two process failures made it worse than it needed to be**, and both are
recorded in CLAUDE.md as pitfalls because both will recur:

*The diagnosis was blocked by our own error handling.* The claim-retry loop
and the UI handler each swallowed the Firebase error, so the browser console
was completely empty during a total failure. Nothing could be learned without
first shipping instrumentation. Errors are now reported with the failing step
and the Firebase error code, and surfaced in the UI — a phone has no console,
so an error that does not say what failed cannot be diagnosed at all.

*A measurement at the wrong resolution actively misled.* The clock was checked
early and reported "skew = 0" — but that check compared against an HTTP `Date`
header, which has one-second resolution, against an effect of 200ms. The
correct hypothesis was dismissed on that evidence and the investigation went
looking at the `get()` clause instead. Sub-second offset needs round-trip
bracketing, which then bounded the skew to +101..+302ms and settled it
immediately. **A measurement can only rule out effects larger than its own
resolution.**

**The fix** is `ROOM_CODE_CLOCK_SKEW_MARGIN_MS` (30 minutes): the client asks
for less than the ceiling, so the ceiling still bounds squatting at 12 hours
while any realistically-synced device passes. The emulator *can* prove this
even though it cannot reproduce the cause — by computing `expiresAt` the way a
fast client would, from a simulated clock. Two assertions do exactly that: one
confirms the un-margined write is denied (the outage), one confirms the
margined write succeeds (the fix). Removing the skew from the model entirely
is in BACKLOG.

**The "registered host" tests were passing for the wrong reason.** The
emulator's default mock token (`authenticatedContext(uid)` with no
`tokenOptions`) omits the `firebase.sign_in_provider` claim entirely, rather
than setting it to a real provider id. Since `isRegistered()` only checks for
the *absence of the anonymous value*, every "registered host" assertion in the
suite was passing on a token shaped like nothing a real Firebase sign-in ever
produces - it proved isRegistered() doesn't reject an absent claim, not that
it accepts a real one. Both `firestore-rules.test.ts` and `room.test.ts` now
give their host contexts an explicit `{firebase: {sign_in_provider:
'google.com'}}` claim, matching what Google sign-in actually issues.

## Decisions made in milestone 4

MILESTONES.md named four requirements for this milestone - timeout or host
override, a minimum submission threshold, duplicate blocking, joining during
submission - without specifying numbers or mechanisms for any of them. Three
were genuinely undecided rather than inferrable from DESIGN.md, and were put
to Nitzan directly on 2026-09-08 rather than guessed.

**No automatic minimum-submission gate.** The host can always advance from
harvesting to rounds, at any submission count. The advisory count shown on
screen (`useHarvestProgress`) is display only, never a block.

**"Duplicate blocking" means one item per player per prompt per game, not
identical-text detection.** Two different players submitting the same text is
allowed and unremarkable; one player submitting twice to the same prompt is
what the phrase in MILESTONES.md was naming, since it sits in a list that is
otherwise entirely about pacing against real people, not content moderation.

**A fixed 90s harvest timer (DESIGN's own number) plus a host "give it another
minute" button**, rather than a host-configurable duration set up front at
room creation. Nitzan's own framing: fixed, with "continue now" as the
override, plus an option for "another 30 seconds/minute" the host can add if
time runs out. Implemented as `extendGamePhase`, addable any number of times
via Firestore's `increment()` rather than a read-modify-write, so two rapid
taps cannot race each other.

**Architecture decision, not put to a vote but load-bearing: every phase
transition is an explicit host write, never a client-side timer firing
automatically.** `GameDoc.phaseEndsAt` only drives what the countdown
*displays* - nothing in `harvest.ts` or `firestore.rules` ever compares it
against anything. This is a deliberate choice not to repeat the room-code
approach (a rule comparing a client-computed timestamp against
`request.time`, which a 200ms clock skew broke outright in production on
2026-09-07) in a second place in the app. Since nothing security- or
correctness-relevant reads this timestamp, a skewed or stalled device clock
can only make the number on screen briefly wrong, never make the gathering do
the wrong thing - the host's own tap is what actually advances it, always.
The principled server-time fix BACKLOG.md proposes for room codes remains
undone and unnecessary here for the same reason it would be unnecessary
there if nothing ever compared the timestamp to anything.

**"Duplicate blocking" is structural, not a count check** - a new
`PromptSubmissionDoc` at
`sessions/{sessionId}/games/{gameId}/prompts/{promptId}/submissions/{uid}`,
document id the player's own uid. This was chosen over a random,
first-write-wins id (the `itemAuthors` pattern) specifically because a random
id here would reopen the exact pre-claim attack `itemAuthors` was made
unguessable to prevent: any player can see any other player's uid in the
roster, so a predictable-by-formula path keyed on a *victim's* uid would let
an attacker front-run and permanently occupy that slot. Keying the id on the
uid that must *write* it, not the uid it is *about*, means only that player
can ever attempt the write at all - there is nothing for anyone else to race,
the same reasoning `PlayerDoc`'s own id already relies on. This also closes
BACKLOG's "orphan claims are unbounded" as a side effect: a player can hold at
most one `itemAuthors` claim per prompt per game, since a second claim has no
slot left to point at.

`ItemAuthorDoc` gained `gameId`/`promptId` fields to make this checkable: the
claim is written before the item exists (`ITEM_WRITE_ORDER`), so at that point
there is nowhere else in the write sequence to learn which submission slot it
should be validated against. `items` create then cross-checks its own
declared `gameId`/`promptId` against the claim's, closing the gap where a slot
reserved for one prompt could otherwise be spent on an item tagged as a
different one. All three new guards (the slot's non-updatability, the
harvesting-phase gate on item creation, and the slot/claim cross-check) are
mutation-checked in `firestore-rules.test.ts`.

### What the milestone-4 review found

Four independent reviews ran against the built milestone - correctness, data
and security, mobile reality, and the full scenario walkthrough. Two serious
findings, both fixed in the same pass, and both worth keeping for their shape
rather than their detail.

**The new collection re-published the secret the whole game depends on
hiding.** `submissions/{uid}` was written with `allow read: if
isPlayer(sessionId)`, to let a player check their own slot. But that document
pairs a player's uid with their item id, and `items` is readable by every
player - so listing one collection handed any player with devtools the
complete author-to-item mapping, before any reveal. `itemAuthors` was locked
down across two milestones and three reviews for exactly this; a second
document invented in a third milestone gave it away in a different shape. The
rules file's own header says "anywhere else that needs to hide something until
a moment arrives should reuse [the one shape] rather than invent a second
mechanism" - the failure here was not skipping that advice but not noticing
the new collection fell under it at all, because it was conceived as a
bookkeeping slot rather than as authorship data. **Any document that pairs a
player with one of their items is the answer key, whatever it is called.** Now
`get`, owner only, mutation-checked.

**Making the slot immutable made a failed submission permanent.** The slot is
keyed by uid and can never be updated - that is what blocks duplicates - and
`submitHarvestItem` wrote it first, with a freshly generated item id. So a
client that died between that write and the item write could never submit that
prompt again: every retry minted a new id and was denied at the first write.
Worse, the UI read a slot alone as "submitted" and showed a green tick for an
answer that did not exist. This is precisely the scenario milestone 4's own
gate exists to test (a device deliberately killed mid-phase), which is why the
review found it and the suite did not. The fix is that a retry resumes the
slot's recorded item id instead of minting one, and that the UI asks whether
the *item* exists rather than whether the slot does.

**The general lesson, which is not about either bug:** both came from the same
place - a guard added for one property (duplicates) changed a property nobody
re-examined (recoverability, and who can read what). ITEM_WRITE_ORDER's
"generate a fresh id on retry" rule had been correct for two milestones and
was silently invalidated by prepending a write to it. A new constraint is also
a change to every invariant the old ones rested on, and the cheap check is to
re-read the comments the new code makes stale rather than only the code it
touches.

The other findings were routine and are in BACKLOG.md, "From the milestone-4
four-lens review", except three fixed in passing: a missing `.catch` on the
resume read (the room-code outage's lesson, applied again), error screens in
`Gathering.tsx` with no retry, and `continueToRounds` being the one
masculine-imperative label among a set of deliberately genderless ones. The
"rounds coming soon" placeholder also said "milestone" in Hebrew, on a screen
real people will see at the gate run.

## Decisions made in milestone 5

**Scores are derived from the rounds, not incremented on the session.** Each
round records what it paid out (`RoundDoc.awarded`, writable exactly once) and
the gathering's totals are the sum of those maps. The obvious alternative -
read the total, add this round's points, write it back - is a read-modify-write
that pays twice whenever a reveal is retried, and retrying a reveal is exactly
what the fix below made possible. The cost is that a score which did not come
from a round's `awarded` map does not survive the next recompute; nothing
writes one, and milestone 6's second game will record its own.

**The host's "how many have voted" counter reads the roster, not the votes.**
The votes are unreadable until the reveal, deliberately, so counting them was
never an option - but a host who cannot tell whether the room has finished is a
host who reveals too early. `PlayerDoc.votedRoundId` publishes that a player
voted, never who for, which is information anyone in the room already has by
looking up from their phone.

**A skipped round is a phase, not a deletion.** Deleting it would return the
item to the draw the host just rejected it from, and its votes subcollection
would outlive the parent document - so delete-and-recreate would be a way to
walk a round's phase backwards, which the monotonic rule exists to prevent. A
skip also does not spend one of DESIGN's ten rounds: the cap is about how long
the game runs, and a skip takes seconds.

### What the milestone-5 review found

Four lenses - correctness, data and security, mobile reality, the full scenario
walkthrough - on 2026-09-14, against a milestone whose own automated suite was
green. Nine serious findings, all fixed before the milestone closed. Three are
worth keeping for their shape.

**A gap between two writes is a state, and an attacker can sit in it.** The
reveal wrote `items.revealed = true` first, because that is what makes the
author readable, and `rounds.phase = 'revealed'` second. Between the two, the
author was public while voting was still open: any player - every device runs a
live listener on `items` - could read who wrote it and change their vote to
match, for two points. Normally a sub-second window; indefinite if the second
write failed or the host's phone suspended between them, which this project has
already documented as a real occurrence. The fix reverses the order (voting
closes first, and the intermediate state gives nothing away) and adds a rules
clause refusing any vote once the round's item is revealed, so the ordering is
enforced rather than trusted. **The general form: when a multi-write sequence
crosses a security boundary, ask what is true in between, not only at the end.**

**A guard that makes a step non-repeatable makes its whole sequence
non-resumable.** `items` update requires `revealed == false`, which is right -
it is what stops a revealed item being un-revealed. It also meant that once
that write had landed, every retry of the reveal died on it, leaving the round
in `voting` forever with the failed retry as the only control on the host's
screen. This is the second time in two milestones that the same shape has
appeared (milestone 4's stranded submission slot was the first), which is why
it is now in CLAUDE.md's pitfalls rather than only here: **when a write can
only happen once, the sequence containing it needs a resume path designed at
the same time.**

**A feature can be defeated by the phase you forgot to name.** The item text
was hidden while a round was in `preview` - the host's private look, which the
skip button exists to act on. `skipped` is not `preview`, so tapping skip
published the item to every phone in the room, which is precisely and only what
the preview exists to prevent. The fix is a positive rule (players see the item
in `voting` and `revealed`, nowhere else) rather than a list of phases to hide
it in; an exclusion list is one new enum value away from being wrong again.

The other six: the game had no ending (the scoreboard vanished at the exact
moment DESIGN wants an arc), no early exit for a room that has had enough
(against DESIGN's "every phase needs a timeout or a host override"), listener
errors that were never surfaced, error messages without the failing step or
Firebase code, a write sequence that reported a landed vote as failed, and
joining that was still open inside the round loop - DESIGN's sentence permits
joining during submission *and* blocks it inside the round loop, and milestone
4 had implemented only the first half. Routine findings are in BACKLOG.md.

## Decisions made in milestone 6

**The second game's scoring is passed into the first game's reveal, not
branched on inside it.** `revealRound` takes a `scorer`, so the resumable
reveal sequence - the part that took a review and two fixes to get right -
exists once. "Who said that" pays for correct guesses; "most likely to" pays
everyone who voted with the majority.

**A self-vote is allowed in the second game and refused in the first.** The
first game's rule exists so that abstaining or self-voting cannot mark the
author out; that reason does not survive into a game where the author is named
in the question. And the author is the likeliest majority answer of all -
"who is most likely to leave the keys on the roof" right after the room learned
David did exactly that - so barring them would exclude one named person from
the scoring in every round about them.

**Ties count as majorities, and a completely split vote invites nobody to
defend themselves.** The first follows from the alternative being worse: the
rounds the room disagrees about most would be the only unscored ones. The
second is where that stops - if every name ties, nobody was picked, and
putting eight people on trial at once is not the social moment DESIGN wants.

### What the milestone-6 review found

Four lenses on 2026-09-14, eight serious findings, all fixed. Three general
lessons came out of it, and they are worth more than the individual bugs.

**A screen copied from a reviewed screen has to be diffed against it, not read
next to it.** Three of the eight were fixes that already existed in
`Rounds.tsx` and silently did not come across when `SecondGame.tsx` was built
from it: the slow-connection notice, listener errors surfaced to the user, and
the "the host is reading, wait" message during preview. Reading the source
screen while writing the new one is exactly the check that misses this, because
the fixes are small and the structure is what the eye follows. The durable fix
was not another review pass but moving the shared behaviour into
`useAction`/`HostButton`/`LoadFailure`, so the next screen inherits it instead
of needing to remember it.

**Narrowing a security predicate by a document field makes that field part of
the boundary.** The vote guard was narrowed to apply only to `who-said-that`
rounds, correctly - in the second game every item is revealed by design, and
the first version of that clause silently forbade every vote there. But
`games` update was deliberately unconstrained ("the host can drive their own
gathering wherever they like"), so the host could flip `type` to
`most-likely-to`, reveal an item, read its author while voting was still open,
and flip it back with nothing recording that it happened. The fix pins `type`
in the same rule. The general form: the moment a rule reads a field to decide
what is allowed, that field stops being ordinary data.

**"Loading" and "empty" are different states, and a screen that conflates them
will eventually offer the wrong button.** `useRevealedItems` starts at `{}`,
which is also what "the first game revealed nothing" looks like - a state that
can genuinely happen. So on a slow first round-trip the second game told the
host there was no material and offered "end the game" as the only control.
Every listener hook now reports `loading` separately, and the screens gate on
it.

The other findings: the reveal reused the first game's wording ("X thought it
was Y") in a game with no right answer, and never repeated how scoring worked
on the screen where the points appear; the author's name - which *is* the
question here - could render as "מישהו" while its one-shot read was in flight
or after it failed; `useGame` kept the previous game's document for a round
trip after the host started the second one, which a second tap turned into a
third game document; the evening's only irreversible button had no
confirmation; and a missing author claim would have thrown inside the reveal
*after* the round had already closed, stranding exactly the state the resume
path exists to recover. Routine findings are in BACKLOG.md.

**One test was found to be a coin flip rather than a guard.** "only ever draws
an item the first game revealed" selected from a two-item pool with the real
`Math.random`, so deleting the filter it names failed it roughly half the
time. It now injects its randomness. Any test that picks from a pool has to.

## Decisions made in milestone 7

**Keeping the evening and keeping the group are two decisions, not one.** The
evening's answers are written into the host's store automatically, at the end
of every game and again when the gathering ends; naming the group is a separate
offer, and it is what puts the group on the shelf for the next gathering. The
first version made both depend on the same tap, which is what DESIGN's sentence
about the offer coming "at the end, after the value has been demonstrated"
seems to say - but two paragraphs earlier DESIGN also requires facts written at
the end of each game "so an abandoned session keeps whatever was already
played", and the two cannot both be true if the contacts to attribute them to
only exist after the final tap. Writing before consent is made honest by
"forget this group", which deletes the lot.

**A returning group is matched by typed name, not by a tapped one.** DESIGN's
list flow has returning people tap their name from the group's member list.
That list is in the host's private store, and putting it where a joiner could
read it before joining would hand every recipient of a WhatsApp link a family's
names - the exact exposure the roster rule was tightened for in milestone 2. So
the person types their name as before and the host's own store does the
matching (`matchName`). What is lost is a few seconds of typing; what is kept
is that holding the link reveals nothing. Recorded in BACKLOG.md as a real gap
rather than a closed question.

**Two people in one room who type the same name are two people.** The matcher
maps a name to a contact, so without a guard both would land on the same
record and one person's answers would be written as the other's. Within a
single gathering each contact is claimed once; across gatherings, a genuine
duplicate name still merges, which is the known cost of matching by name at
all (BACKLOG.md).

**A fact's document id is the item it came from.** That makes every write
idempotent without a transaction, which matters because there is no server to
deduplicate after a host whose phone dropped mid-write. The counter that
DESIGN's selection rule depends on (`useCount`) is preserved by skipping a
fact that already exists rather than merging over it.

### What the milestone-7 review found

Three lenses on 2026-09-14 and 2026-09-15, ten serious findings, all fixed. Two
are worth keeping as habits rather than as bug reports.

**A feature can be fully implemented, fully tested, and still be a no-op,
because the data it depends on is created later than it runs.** Facts were
written at the end of every game exactly as DESIGN asks - into a contact map
that was always empty at that point, because contacts were created by the
host's tap on the *last* screen. Both reviewers found it independently; the
suite did not, because every test called `saveGroup` before `writeFactsForGame`
and so inverted the production order. **When a test sets up its own
preconditions, check that the product sets them up in the same order.**

**A library proven in isolation says nothing about its wiring.** The
returning-group test passed the saved group id into `ensureContacts`
explicitly and asserted the contacts were reused. The screen that calls it in
production passed no id at all, so every return visit forked a new group and
overwrote the saved one on its way past. The library was right and the feature
was broken. The fix was a test at the wiring level - render the screen, tap the
button, assert what the call actually received.

The other findings: the end-of-evening screen assumed a return visit was
already saved and so recorded nothing; the landing page listed one unnamed
"group" per evening ever played, all labelled identically; the count of what
was kept reported only what the last write happened to add; the offer promised
that nobody would have to type their name again, which is precisely the half of
the list flow that did not survive; the memory screen could only be reached by
running and ending a gathering, though DESIGN calls it a visible screen; and
three `useAction` regressions (a slow delete greying every row, two missing
"still trying" notices, an error captured but never rendered). Routine findings
are in BACKLOG.md.

## Found in Nitzan's own manual walkthrough

**There was no way to leave a room, at all.** A stored session resumes
forever on refresh (`readStoredSession`/`storeSession` in `App.tsx`), and no
screen ever cleared it - not a bug in any single milestone, since every
milestone's review reads the code that exists rather than asking what screen
is missing entirely. Found immediately on the first manual walkthrough: a
browser still holding a session from an earlier test round could not get back
to the landing page by any means in the product itself. Fixed with a small
"leave the room" control that clears the stored session and nothing else -
DESIGN already permits this ("leaving is allowed at any moment, an active
round is never broken"), so no rule or player state needed to change, only a
way to trigger the client-side forgetting that already existed for a fresh
device. `App.test.tsx` pins it down and confirms the player document and the
roster are untouched.

**The general lesson:** four-lens review reads the screens that exist; it does
not by itself ask "what screen should exist and doesn't." A manual walkthrough
by someone who has never seen the product before is a fifth lens the others
cannot replace.
