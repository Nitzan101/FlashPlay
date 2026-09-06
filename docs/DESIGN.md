# FlashPlay — Design

A party app for a group that is already together in one room. Three to
twenty-five people, ten to forty minutes, everyone on their own phone, joining
through a link pasted into the group's own WhatsApp chat. No install, no
equipment, no preparation.

This document is the product and architecture. The reasoning behind each choice
lives in [DECISIONS.md](./DECISIONS.md); everything deliberately deferred lives
in [BACKLOG.md](./BACKLOG.md).

---

## The problem

Host stress: the cognitive load on whoever has to produce entertainment for a
gathering. They want it to be fun and specific to this group, they have no time,
and the alternatives are trawling Google or paying an external entertainer.

A competitor survey found that two thirds of the original idea was already
taken. The recommendation engine exists in Pocket Party Games. The "instant
game, no equipment" layer is crowded — Pass the Phone, Bluffin, Tomanji, Picolo,
CrowdParty, Jackbox. The organisational side has SessionLab, Kahoot, Klaxoon,
Slido.

**The gap none of them fills: personalisation around the real, named people in
the room, plus accumulated memory of that specific group over time.** They all
serve generic content from a fixed library. None of them knows that Yossi hates
coffee, and none of them remembers that this game died with this family last
year.

---

## The thesis

**The unit is the gathering, not the game.** Competitors sell individual games
from a catalogue. FlashPlay runs a sequence that gets more personal as it goes:
the first format harvests material from the people in the room, and the ones
after it are built out of that material. Preparation becomes part of the
entertainment, which is why the up-front preparation requirement drops to zero.

**Variety through generation, not through cataloguing.** This is the central
distinction. Variety-by-catalogue — a hundred and fifty separate games, each
with its own menu entry — is precisely what forces a competitor into search,
categories and filtering, and that clutter is a structural, durable weakness
rather than a defect they will fix. Variety-by-generation — a few formats filled
from the group — gives a different experience every time with no browsing screen
at all.

---

## Architecture: three layers

### Layer 1 — Formats

Interaction patterns. Each format is a state machine in code, and this is where
the real engineering investment sits. Seven cover almost everything:

| Format | The pattern |
|---|---|
| Collect and guess | Everyone types text, the app shuffles, the group guesses who wrote it |
| Vote on a person | A question is read out, everyone votes for someone, results shown |
| Asymmetric secret info | Each player holds different information on their phone, discussion happens in the room, vote at the end |
| Describe against the clock | One person describes or acts, the others guess, timer running |
| Perform in the room | Someone performs a physical task, the others judge or vote |
| Mutual quiz | One person answers on behalf of another, answers are compared, familiarity is measured. The small-group format |
| Rank and order | The group arranges items or people along an axis |

**Priority order by the threshold test** (dependence on co-creation, not
perceived fun): collect-and-guess first — it is the format where the room's input
*is* the content. Then asymmetric secret info and describe-against-the-clock,
both strong when fed harvested facts. Vote-on-a-person and rank-and-order are
cheap to build and pass the threshold once the questions are built from
harvested facts. Perform-in-the-room is last: it is the most fun and the most
generic, works fine with total strangers, and therefore does not require this
product at all.

### The threshold test, applied to every game

**How far could this game not exist unless the app built it together with the
people in this room?** This is the threshold, and it precedes every other
consideration.

If the game can be played with a deck of cards or a generic app, it does not
belong here, however fun it is. If the content simply does not exist without
what these people typed in the last few minutes, it is exactly the product.

A methodological note worth keeping: in a taste test across nineteen games,
intuitive ranking favoured the *generic* ones — the games that work beautifully
with total strangers and need no app at all. **Ranking by "how good a party game
is this" leads straight into the red ocean where Jackbox and Bluffin already
sit.** Hence a threshold of co-creation dependence rather than perceived fun.
Improving structure and tension is work you can do on a game that has passed the
threshold; the reverse — taking a successful generic game and sprinkling facts on
it — produces an imitation with a gimmick.

### Layer 2 — Games

A game is a format plus content plus pacing. **A new game is a definition and
content, not new code.**

**Every game declares its requirements as data, and the assembly layer filters on
them.** This is what turns "it depends on the game" from something the host
manages into something that happens by itself:

| Field | What it determines |
|---|---|
| Min and max players | Which size buckets the game is offered in |
| Needs a private screen per player | Whether a participant without a phone can be included |
| Guest-of-honour role | Ordinary player / excluded from the harvest / given a parallel task |
| Harvest drawer | Personal or group — see the memory model |
| Needs familiarity | Whether it works with strangers |

**The rule this produces, replacing case-by-case judgement: a game that requires
secret per-player information cannot include a participant without a phone;
every other game can.** Grandma cannot be the imposter without a screen, but she
can vote, guess, describe and perform. The host adds her once as a player
without a device, and from that moment the app simply never offers a game that
cannot include her — no error, no half-working game, and no need for the host to
know the mechanism exists.

Seven formats yield twenty to thirty games cheaply — "charades about Yossi" and
"describe a secret word" are the same format with different content. This is
where the breadth lives.

#### The approved game list

Built through a game-by-game review. Only games that passed the threshold test
and were explicitly approved.

| Game | Format | Decision |
|---|---|---|
| Who said that | Collect and guess | Approved, **with an app-supplied prompt rather than a free field** — a blank field paralyses people and produces weak material that then feeds every game after it. The prompt also determines which memory drawer the fact lands in |
| One lie | Collect and guess | Approved. **The liar scores too** — without an incentive to deceive, people write a random lie and the game falls apart |
| The headline — AI version | Collect and guess | Approved. The app invents fake headlines about the group from harvested facts. The only game where the AI is a player rather than a content pipe |
| The headline — player version | Collect and guess | Approved as a separate game. Everyone writes one true and one invented. Zero AI, same format, different definition |
| The expert | Mutual quiz | Approved. **Everyone answers in parallel** about the same person rather than one player against the group — works at any size with nobody waiting, and produces a "who knows Yossi best" ranking |
| My version | Describe against the clock | Approved. **Three people narrate** a real fact from the room in first person; only one lived it. The direct confrontation between the three is most of the fun |
| The script | Describe against the clock | Approved. Everyone writes a line for a different character from the room, and two people cold-read it. **The generator orders the lines** into a scene with a beginning and a peak — without that, some scenes come out confusing rather than funny |
| Yossi cards — about the guest of honour | Rank and order | Approved. Apples-to-apples structure over a deck the group builds in three minutes. **Requires a private hand, so it excludes a participant without a phone** |
| Yossi cards — about the whole room | Rank and order | Approved as a separate game. Same format, different harvest prompt ("three things about someone in the room") — a change in definition, not in code |
| Imposter | Asymmetric secret info | Approved, **but the secret word comes from harvested facts** — a place, an event or an inside joke of the group — rather than from a fixed list. A fixed list is exactly the existing Imposter Game, and there is no reason to duplicate it |
| Impression | Perform in the room | Approved **with a harvested fact**: not just who to imitate but in what situation — "Grandma discovering the milk has run out". Without that the game works without the app and fails the threshold |
| Awards ceremony | Vote on a person | Approved **as a five-minute closing sketch, not a standalone game**. The categories are built from everything that happened during the gathering, which gives the evening a close rather than an abrupt end |
| Most likely to | Vote on a person | Approved **as a short filler game**. Half-minute rounds, zero rules explanation, works up to twenty-five. Warms up and connects longer games; cannot carry a gathering alone |
| What would Yossi pick | Rank and order | Approved. The group orders items by what they think he would prefer, and he reveals at the end |
| Charades on a scene | Describe against the clock | Approved. The generator builds an absurd situation from a real fact. **Two mandatory limits:** the scene is restricted to a person plus one physical action so that it is actually actable, and if the timer expires with no correct guess the app shows four options to vote on **at reduced points** — no round dies in awkward silence, and the lower score preserves the incentive to actually guess rather than wait for the multiple choice. The distractors are real facts about other people, so they are funny too |
| Completion | Collect and guess | **Merged into "Who said that" as a second prompt pool**, not a separate game. The same experience in practice |
| Forecast | Collect and guess | **Merged into "Who said that" as a third prompt pool** ("where will Yossi be in ten years"). Same mechanism; the only difference is that the prompt is about one person rather than about the writer |
| The manifesto | — | **Rejected.** Pleasant, but it has no tension and no resolution, and it competes for the same slot as the awards ceremony, which is stronger |

**Deferred, not deleted:** describe without the word, pairs challenge, draw it,
who in the room, the ladder, secret ranking, the group task, the covert task. All
fail the threshold test — they work fine with a deck of cards and with total
strangers. They will be considered as filler only once a critical mass of games
that pass the threshold exists.

#### Distribution across formats

| Format | Games |
|---|---|
| Collect and guess | 4 — Who said that, One lie, The headline ×2 |
| Describe against the clock | 3 — My version, The script, Charades |
| Rank and order | 3 — Yossi cards ×2, What would Yossi pick |
| Vote on a person | 2 — Awards ceremony, Most likely to |
| Mutual quiz | 1 — The expert |
| Asymmetric secret info | 1 — Imposter |
| Perform in the room | 1 — Impression |

Fifteen games across seven formats, the defined minimum at which the wizard
genuinely distinguishes between combinations. **Collect-and-guess carries the
most games and is also the harvest engine, so it is the format built first.**

### Layer 3 — The wizard and assembly

A short wizard: four questions, three options each, ending in two or three
precise game suggestions. The host picks one, and the app generates it from the
group's facts.

**A wizard is not a catalogue.** A catalogue is a screen with a hundred and fifty
games, search, categories and scrolling — the source of the competitor's clutter.
A wizard is five screens with three buttons, the classic way to cover a wide
space without a complicated interface. This distinction is the whole thing.

**Wizard rule: a question that does not change the output gets deleted.** Five
size buckets times three-by-three options is a hundred and thirty-five
combinations against fifteen games. If most combinations return the same
suggestions, the user works out within two gatherings that the wizard is theatre,
skips it, and both the wizard and the trust are gone.

| Question | Options | What it controls |
|---|---|---|
| How many are you | 3–4 / 5–7 / 8–12 / 13–18 / 19–25 | Format structure. Every boundary matches a real structural break |
| How well do you know each other | Strangers / a little / well | Whether personalisation is possible at all, and how deep and how sharp it may get. **Warning:** the "strangers" option currently has almost no games — see BACKLOG |
| Is there a guest of honour | Birthday / farewell / just a gathering | Whether there is a person at the centre for the content to orbit. The cheapest question with the biggest differentiation |
| Who is in the room | Adults / family with children / mixed | Tone and register — what may be asked |

The time question is deliberately omitted from the wizard and set as a default
that can be changed mid-session, because a host usually does not know in advance
how long they have.

After the first game, the next suggestion also leans on what has already been
harvested during the gathering. This is how the arc is built, where each game is
more personal than the one before it.

### The five size buckets

| Bucket | What works and what breaks |
|---|---|
| 3–4 | Only describe-against-the-clock, perform-in-the-room, and mutual quiz. Hidden roles degenerate, guessing "who said it" is a coin flip, voting on a person is meaningless |
| 5–7 | Hidden roles become possible, guessing starts to work. All formats available |
| 8–12 | The sweet spot. Everything works, including turn-based formats |
| 13–18 | Turns start to choke — fifteen people times half a minute is seven minutes per round. Sub-groups or shortened rounds required |
| 19–25 | Parallel only. Turns die completely; scoring and pacing need different handling |

This is why a seventh format built for small groups is needed — the mutual quiz,
where one person answers questions on another's behalf and the answers are then
compared. It works well with three and falls apart at scale, which is exactly the
complementary shape.

Two reasons the low end helps. **Personalisation is stronger** in a small group —
harvesting facts from three people takes thirty seconds rather than three
minutes, and the app can go deeper on each of them. And **testing becomes far
cheaper** — a run with three friends any evening, instead of organising fifteen
people. Given that the entire validation plan rests on running with real groups,
this accelerates everything.

### Three axes of adaptation

**Content** — questions and tasks are built from the facts of the people in the
room.

**Form** — the format changes shape by size and time. You do not run twelve rounds
where everyone guesses with twenty-five people; with eight you do. With ten
minutes the format shortens.

**Tone** — how personal and how sharp is permitted. A family with children and a
grandmother does not get what a group of twenty-five-year-old friends gets.

---

## The memory model

**Two drawers, and the question decides.** A **personal** fact travels with the
person between groups; a **group** fact stays in that group forever.

What determines which drawer a fact lands in is **the wording of the harvest
question that collected it**, fixed once when the game is written — not a runtime
classifier. "Write something about yourself" → personal. "Write something that
happened to the group" or "something about Yossi" → group. The default in any
unclear case is group.

The reasoning: an AI classifier is sometimes wrong, and when it is wrong an
intimate family fact surfaces at a gathering with colleagues. No accuracy
threshold makes that acceptable, so the classifier is removed from the equation
rather than tuned.

**Lifecycle and selection.** Facts are written **at the end of each game** rather
than at the end of the gathering, so an abandoned session keeps whatever was
already played. Every fact is **attributed to its author in storage** even when
the display is anonymous — otherwise a personal fact cannot travel with the
person. Every fact carries a use counter, and selection **prefers unused facts
and never repeats a fact twice in the same gathering** — a simple rule, no machine
learning, carrying most of the quality gain.

**A group fact is confined to the group where it was said and never crosses
between groups.** A fact from a gathering with friends surfacing at a family
dinner is a severe product failure. A **personal** fact does travel with the
person, because it is context-free by definition.

A visible "what we remember about this group" screen with one-tap deletion, **open
to the group's owner only** — otherwise that screen is itself the hole through
which a guest siphons the family's memory. Text only, no images, no media.

---

## Identity and data

**Three identity layers.** A **registered** host (Google, one tap) is required to
open a gathering. A **guest** enters with a name only and is never blocked.
**Upgrade:** a guest can register during or after the gathering, and what they
contributed moves to their account. The registration button appears at the moment
its value is visible, not as a gate at the entrance.

**Entities.** A registered **user** holds a profile and **contacts**. A **contact**
is a record of a person the user knows, owned by them, holding that person's
personal facts and an optional manual entry screen; a person who registers
themselves can claim the record. A **group** is owned by the host, has a name
("family", "friends from the software course"), and holds a **member list** plus
the group facts; each slot in the list points at a contact. A **fact** belongs to
either a contact or a group.

**Contacts are per-user.** Two hosts who know the same person hold separate
records. Slightly wasteful, but it is the right answer for privacy and it is what
stops the system becoming a global social graph.

**List flow.** At a first gathering everyone types a name; at the end the app
offers to save the group, at which point each participant becomes a contact. At
the next gathering the host picks an existing group and participants **tap their
name** instead of typing — faster, and it loads their facts immediately. New
people type and join the list. The offer to save comes at the end, after the
value has been demonstrated.

**Explicitly rejected:** a learned relationship graph, and cross-group
identification of unregistered users. The first is a large machine with no
consumer — no game requires it. The second is in practice fingerprinting people:
technically shaky and hostile on privacy. Both to be reconsidered only when a
concrete game demands them.

---

## Session and platform behaviour

**Session state lives on the server, not in the host's browser.** The gathering
survives the host's phone locking, crashing or dropping off the network, and
returns to exactly where it was. Disconnections in a twenty-phone session are a
certainty rather than an edge case, so a player identity that survives a refresh
and full resync on demand are in from day one.

**Joining is a link sent to the WhatsApp group; QR is the fallback.** A QR code
means the host passes one phone between eleven people — slow, awkward, and
precisely where the under-two-minutes promise breaks. A link is one message,
everyone taps at once, and the family already has the channel.

**Joining is permitted between games and also during the submission phase**, and
blocked only inside the round loop. Someone arriving during the harvest simply
submits too; a blanket "only between games" rule would leave someone two minutes
late staring at a fifteen-minute waiting screen. Leaving is allowed at any moment,
an active round is never broken, and what a leaver already contributed stays in
the game.

**Every phase needs a timeout or a host override.** A phase that waits for
"everyone" hangs forever when one phone dies quietly — eleven people waiting on a
locked screen. This is the most likely way a real gathering dies, and it applies
to every phase, not just the harvest.

**The host is always a player.** A design rule that replaces per-game variants:
**the screen the host reads from never contains the answer.** The app holds the
solution and the host is as blind as everyone else. If a game needs a neutral
judge, the app is the judge. The host's screen is the player screen plus a control
strip (text to read, skip, continue) — one layout with a conditional strip, not
two separate modes.

**Skip button for the host.** Submissions are anonymous, which removes the social
brake on malicious content. The host sees each item a moment before reading it and
can skip it. This requires a preview stage visible to the host alone — if everyone
sees the item at the same time he does, the button is worthless because the damage
is done. **Automatic filtering is rejected:** it misses the family teasing that is
most of the fun, blocks legitimate content, and has no correct threshold.

**The text is displayed on all phones**, always, not as a changeable default. The
host reads aloud, and anyone who did not hear — in a noisy room, or because they
are hard of hearing — is otherwise excluded from the round. The principle that the
app is not the centre of attention is preserved by the voting and reactions being
social, not by hiding text in a way that creates an accessibility problem.

**Mobile reality.** The app opens in WhatsApp's in-app browser, so identity
handling must account for it. Google sign-in must use redirect, not popup, since
popups are blocked on mobile. Phone screens lock after about thirty seconds, so in
a ninety-second harvest window everyone who typed early is locked before the phase
ends — this happens every round, all evening, on every device, so resync on every
return to foreground is required, not just disconnection handling.

**Anonymity leaks through the client.** The architecture is serverless: the client
reads the data. If a fact document contains the author's id and the client fetches
it to display text, the author's id is in the payload, devtools reveal the answer,
and "Who said that" is completely broken. The fix: public round data contains text
only, and the mapping to the author sits in a separate document that security
rules block until the phase field flips to "revealed".

**One pattern for the security rules.** Hiding the author until reveal and hiding
the votes until reveal are the same problem: writes permitted to the owner only,
reads permitted only after the phase has passed. One rule shape covers both.

---

## The first target

**One session that works well with a real family group.** Two games, a harvest
followed by a game built out of what that harvest collected. A live product and a
full portfolio write-up come after.

**The two games: "Who said that" followed by "Most likely to" — both with zero
AI.** This proves the central loop, that the second game is built from the first
one's material, without the generator being in the equation. If something fails in
the family test, it will be obvious whether the problem is the loop or the
content. The AI headline game comes immediately after, against infrastructure that
is already stable. This is the minimum at which the differentiation is actually
visible — that the second game is made of what the group typed ten minutes ago. A
single game does not demonstrate it at all.

**In the first slice there is no wizard** — the two-game sequence is fixed in
advance.

### The three harvest prompt rules

**Rule 1 — the prompt asks for a behaviour, not a fact and not an opinion.** Only a
behaviour can be asked about again as "who is most likely to do that". "Something
embarrassing you did" rolls perfectly into the second game; "something nobody
knows about you" breaks there, because the tenses do not work.

**Rule 2 — answerable in thirty seconds, including by a nine-year-old.** A prompt
that requires thought stops the harvest.

**Rule 3 — no common answer.** "What is your favourite colour" dies immediately:
everyone answers the same thing and guessing is impossible.

**Everyone gets the same prompt**, not different ones — otherwise the group does
not know which question the item being read out answers. Since each person submits
two items, there are **two prompts per gathering**, and each round opens by
announcing which prompt the item comes from.

**A pool of 15–20 prompts is required** so that a group's first few gatherings feel
fresh. Writing them in Hebrew so they work for both a child and a grandmother
while satisfying all three rules is **a content task of several hours including
testing** — not a line of code.

**A content constraint that follows from the loop:** the first game's texts pass
into the second game **as they are**, wrapped only in a different question. With
zero AI there is no way to splice free text into a template.

### Who said that

Everyone submits two items to a prompt, ninety-second window. The app shuffles and
picks items for rounds, **capped at ten rounds** — eleven people times two is
twenty-two items, which drags. Each round: the host reads it out, everyone votes on
who wrote it, and the writer votes too, for someone else, so as not to give
themselves away. Reveal, then two points for each correct guess and one point to
the writer for everyone they fooled.

The round cap is a pacing decision only. The twelve items that were never revealed
are **kept as facts for future gatherings** and are not used by the second game —
see the reasoning below.

### Most likely to

No harvest phase; it uses **items already revealed** in the first game, meaning ones
where the room knows who wrote them. **This is critical:** an unrevealed item makes
"who is most likely to do this" exactly the same question as "who wrote this", and
the two games collapse into one. When it is known that David wrote it, the host
reads "David left his phone on the car roof — which of you is most likely to do
that?", which is a completely new question, and also a laugh at David's expense.

Everyone votes on a person. There is no correct answer, so **scoring is for voting
with the majority** — whoever read the room correctly gets a point, which is
on-thesis because the game rewards familiarity with the group. **After each vote,
whoever got the most votes gets one sentence to defend themselves** — the social
moment is the point, not the scoring, and without it the game is a survey.

**Stated plainly:** this is the least exciting game on the approved list, and it was
chosen for the first slice on engineering grounds — zero AI, and reuse of the first
game's voting component. The choice is right for proving the loop cheaply, and
should not be mistaken for the impressive part of the product.

### Scoring

**Cumulative across the gathering**, not separate per game. This is what turns
three games into one gathering with an arc and an ending, and it is also what
gives the awards ceremony something to stand on.

---

## Out of scope

A **catalogue** stays out — a list screen with dozens of games, search, categories
and scrolling. The short wizard with suggestions at the end is **in**; the
distinction between the two is the central interface decision, not a nuance.

Payments, content packs and commissions stay out. User-submitted game ideas stay
out of the first version. A native app stays out. Remote play, where participants
are not in the same room, stays out — the entire value depends on physical presence.

---

## How this is validated

Validation is behavioural rather than technical.

**Test 1** — run a full session with a small group of friends, three to five people,
and measure the seconds from opening the room to everyone being in and playing.
Over two minutes means failure on the central promise.

**Test 2** — run against a real family gathering, a group mixed in age and less
technologically forgiving. This is the real test.

**Test 3** — run a second gathering with the same group, and check whether the
material accumulated in the first improved the second. This is the moat test; if it
fails, the entire accumulated-memory thesis needs rethinking.

**Outcome feedback after a gathering** — did it work, did it die, how many were you —
is in the first version, because it is the asset no language model can generate.
