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

**The room code is the session's document id.** Listing the sessions collection
is denied, because granting it let anyone enumerate every gathering on the
project - room codes, hosts, scores - with no join link at all. That leaves only
`get` by a known id, so there is no query that can turn a typed room code into a
session. Making the code the id removes the need for one. Consequence for
milestone 3: room codes must be generated collision-safe at creation, because a
collision is now an id collision rather than a duplicate field.

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
