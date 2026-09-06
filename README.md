# FlashPlay

A party app for a group that is already together in one room. Three to
twenty-five people, ten to forty minutes, everyone on their own phone, joining
through a link pasted into the group's own WhatsApp chat. No install, no
equipment, no preparation.

**Live:** https://flashplay-50bde.firebaseapp.com
**Language:** the product is Hebrew and right-to-left; the code and documentation
are English.

> **Status: early.** Milestone 1 of 9 is complete — the app shell, a Firebase
> project, and Google sign-in working end to end on desktop and on a phone
> opened from WhatsApp. The games themselves are not built yet.
> [`docs/MILESTONES.md`](./docs/MILESTONES.md) tracks what is done and what is
> next, honestly.

---

## The idea

Existing party apps serve generic content from a fixed library. None of them
knows that Yossi hates coffee, and none of them remembers that this particular
game died with this particular family last year.

FlashPlay's bet is that **the unit is the gathering, not the game**. The first
format harvests material from the people in the room — a prompt everyone answers
in ninety seconds — and the games after it are built out of that material. So
preparation stops being a cost the host pays before the evening and becomes part
of the entertainment itself.

That produces the design constraint the whole project is organised around:

> **How far could this game not exist unless the app built it together with the
> people in this room?**

Games that work fine with a deck of cards and total strangers fail that test,
however fun they are, because they do not need this product. Nineteen candidate
games were ranked against it; the intuitive ranking by "how good a party game is
this" turned out to select almost exactly the wrong ones.

The full reasoning is in [`docs/DESIGN.md`](./docs/DESIGN.md).

---

## What is interesting here technically

**Anonymity has to survive a client that reads the database directly.** The
architecture is serverless, so if a fact document carries its author's id and the
client fetches it to render text, devtools reveal the answer and the core game is
broken. Public round data therefore carries text only, and the author mapping
lives in a separate document that security rules withhold until the round's phase
flips to revealed. Hiding the author and hiding the votes turn out to be the same
problem, so one rule shape covers both.

**Per-game variation is data, not a decision the host manages.** Every game
declares its own requirements — player range, whether it needs a private screen,
which memory drawer its harvest fills — and one assembly layer filters on them.
A participant without a phone is added once by name and is simply never offered a
game that cannot include them. No error, no half-working game, and the host never
learns the mechanism exists.

**A fact's scope is set by the wording of the question that collected it, not by
a classifier.** "Write something about yourself" yields a fact that travels with
that person; "write something that happened to this group" yields one that never
leaves it. A classifier is wrong sometimes, and when it is wrong an intimate
family fact surfaces at a gathering with colleagues — no accuracy threshold makes
that acceptable, so the classifier is removed rather than tuned.

**Mobile reality is designed for rather than discovered.** Phone screens lock
after about thirty seconds, so in a ninety-second harvest everyone who typed early
is locked out before the phase ends — every round, all evening, on eleven devices.
Every phase needs a timeout or a host override, because one phone dying quietly is
the most likely way a real gathering dies.

[`docs/DECISIONS.md`](./docs/DECISIONS.md) records why each choice was made,
including the ones that turned out to be wrong and what replaced them.

---

## Running it

```bash
npm install
cp .env.example .env.local   # then fill in from your own Firebase project
npm run dev
```

| | |
|---|---|
| Build | `npm run build` |
| Test | `npm test` |
| Lint | `npm run lint` |

The app needs its own Firebase project with Google sign-in enabled. Note that it
must be served from the project's `firebaseapp.com` domain rather than the
`web.app` twin — see the pitfalls section of [`CLAUDE.md`](./CLAUDE.md) for why
that is not interchangeable.

**Stack:** React, TypeScript, Vite, Tailwind, Firebase (Auth, Firestore,
Hosting), i18next, Vitest.

---

## Documentation

| | |
|---|---|
| [`docs/DESIGN.md`](./docs/DESIGN.md) | The product and architecture |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md) | Why each choice was made |
| [`docs/MILESTONES.md`](./docs/MILESTONES.md) | Build plan and current status |
| [`docs/BACKLOG.md`](./docs/BACKLOG.md) | What was deferred, and why |
| [`CLAUDE.md`](./CLAUDE.md) | Operational notes and known pitfalls |

---

## Related

[Imposter Game](https://github.com/Nitzan101/AmongUs) — a real-time social
deduction game, live in production. FlashPlay is deliberately a separate
repository rather than an extension of it, and borrows its room layer (presence
heartbeats, session resume, host migration) rather than rebuilding it.

Built with AI assistance.
