# FlashPlay

## What this is
A party/gathering web app for a group already together in one room (3–25 people,
10–40 minutes), each on their own phone, joining by a link shared into the
group's WhatsApp chat. Its differentiator is personalisation around the real
named people present, plus accumulated memory of that specific group. Hebrew
content, RTL, no install.

Concept, architecture, reasoning and build plan live in `docs/`, in English:

- `docs/DESIGN.md` - the product and architecture.
- `docs/DECISIONS.md` - why each choice was made, including findings from building.
- `docs/MILESTONES.md` - the nine milestones and what each gate tests.
- `docs/BACKLOG.md` - what was deferred and why.

**Read `docs/DESIGN.md` before making design decisions** - most are already settled
there with reasoning, and re-deciding them wastes time and produces drift.

The original Hebrew planning document under `~/.claude/plans/` is **frozen and
superseded**. It is kept only as an archive of the planning phase; where it and
`docs/` disagree, `docs/` wins.

Milestone status lives in `docs/MILESTONES.md` - that is its only home; do not
restate it here. Short version: milestones 0-7 are done or implemented - both
games, the scoring, the ending and what the evening leaves behind are all
built, each with a section below - check `docs/MILESTONES.md` for which gates
have actually run. Milestone 8 is the family session itself, not code.

**The app's canonical URL is `https://flashplay-50bde.firebaseapp.com`** - this is
the link to share, and it is not interchangeable with the `.web.app` one. See
Known pitfalls.

## Commands
All verified by execution on 2026-09-04.

- Build: `npm run build` (runs `tsc -b` then `vite build`)
- Run: `npm run dev`
- Test: `npm test` (Vitest, single run) / `npm run test:watch`
- Security rules test: `npm run test:rules` - starts the Firestore emulator and
  runs the rules suite against it (`firestore-rules.test.ts`, `room.test.ts`,
  `harvest.test.ts`, `rounds.test.ts`, `secondGame.test.ts`,
  `memory.test.ts`, `evening.test.ts`, `profile.test.ts`,
  `profileQuestions.test.ts`). Needs Java
  (present: OpenJDK 21). Excluded from `npm
  test` so the everyday loop stays fast and emulator-free. **Also needs
  `.env.local` to exist**, even though these files never touch the real
  project - they import `room.ts`/`harvest.ts`, which import `firebase.ts`,
  which throws on missing `VITE_FIREBASE_*` vars at module load. A fresh clone
  without `.env.local` gets a suite failure that looks like a rules problem.
- Deploy rules: `npm run deploy:rules`
- Deploy app: `npm run build` then `firebase deploy --only hosting --project flashplay-50bde`
- Lint: `npm run lint` (oxlint)

## How we verify a change here
`npm run build && npm test` is the default evidence, and a change to behaviour
needs a test that demonstrably fails without it — flip the thing under test and
watch the test go red before claiming it guards anything.

`npm run test:rules` is required on top of that for anything touching
`firestore.rules` or the data model, and a rules change is only proven when the
rule has been deleted and the matching assertion watched to go red.

**The independent review is where the defects actually come from, not the
suite.** Across milestones 4-7 the four-lens review found 2, 9, 8 and 10
serious defects respectively - every single one of them while `npm test` and
`npm run test:rules` were fully green. Two were features that were implemented,
unit-tested and complete no-ops in production. Budget for the review as part of
building a milestone, not as a formality after it, and give each lens its own
pass: the overlap between what the correctness reader and the scenario reader
notice is small.

**Any number or file name written into these docs comes from the run, not from
the previous milestone's text.** Three times now a coverage claim here has been
right in total and wrong in detail - a per-file split carried forward after the
file changed, and a comment pointing at a test file that did not exist yet.
Count with `grep -cE "^\s+it\(" <file>` per file (no `it.each` in this repo, so
that is exact) and check the referenced file exists before writing the sentence.

Two kinds of change are not covered by that and need more:
- **Anything touching anonymity, ownership or read access** — the client reads
  Firestore directly, so security rules are the only enforcement boundary.
  Evidence is emulator assertions, plus opening devtools on a player device and
  confirming the hidden value is genuinely absent from the payload.
- **Anything touching the live session on phones** — screen lock, foreground
  resync, the WhatsApp in-app browser, redirect auth. These do not reproduce on
  a laptop. Evidence is a real multi-device run.

**Screenshotting a screen that only renders for a real signed-in registered
host** (a browser-driving tool has no way to complete real Google OAuth): mock
the Firestore-touching hooks the same way the component's own test file does
(`vi.mock('./lib/memory', ...)`), render it with React Testing Library in a
throwaway `.test.tsx`, dump `container.innerHTML` to a file, and load that
HTML in a plain page alongside the real built CSS (`dist/assets/index-*.css`)
served from a local static server - a real browser then paints the actual
Tailwind classes correctly, which a components-in-isolation storybook would
not need but this project has none of. Delete the scratch test and HTML
files afterwards; nothing here belongs in the repo. Used 2026-09-17 to verify
`RoomPicker`/`GroupDetails`/`EmojiPicker`, none of which a signed-out session
can reach.

## Structure
- `src/main.tsx` — entry; mounts App, imports i18n and Tailwind.
- `src/i18n.ts` — i18next setup. Hebrew is the only shipped locale.
- `src/App.tsx` — app shell and the room flow's state machine: host sign-in and
  room creation, guest join-by-link or by typed code (`resolveJoinScreen`,
  shared by both), leaving a room (two-step confirm), resuming a stored
  session on refresh.
- `src/Lobby.tsx` — the live member list + room code, shown once in a room.
  Labels the host (`hostUid` prop) and a player who has explicitly left
  (`PlayerDoc.leftAt`), and excludes a left player from the "N in the room"
  count.
- `src/lib/firebase.ts` — reads config from `VITE_FIREBASE_*` env vars, exports
  `firebaseApp`, `auth` and `db`. Throws on load if a var is missing.
- `src/lib/auth.ts` — `signInWithGoogle` (redirect, not popup — see comment),
  `signOutUser`, `signInAsGuest` (anonymous), and the `useAuthUser()` hook
  (`{ user, loading, redirectError }`).
- `src/lib/model.ts` — the Firestore data model: types and `paths` helpers.
  Single source of truth for document shapes; `firestore.rules` mirrors it by
  hand and the two are kept in step by the emulator tests.
- `src/lib/room.ts` — room creation, joining, presence: `createRoom`,
  `resolveRoomCode`, `joinRoom` (now also claims a `PlayerNameDoc` slot via the
  internal `reserveName`, so two different uids cannot hold the same display
  name in one session - see model.ts), `leaveRoom` (records `PlayerDoc.leftAt`;
  cleared again by `joinRoom` on a fresh join), `renamePlayer` (self-service
  rename/re-emoji - re-claims the `playerNames` slot, does not just overwrite
  the field), `setPlayerEmoji` (join-time emoji application, no slot involved),
  `useRoster`, `usePresenceHeartbeat`, `useSession` (live session-document
  listener - milestone 4's screens are driven by this, not by App.tsx's
  one-off getDoc calls), `transferHost` (moves `hostUid` only, never
  `originalHostUid` - see both fields in model.ts).
- `src/lib/profile.ts` — a registered host's own default name/emoji, at
  `users/{uid}` itself (`UserDoc`, unused since milestone 2 until this).
  `useUserProfile`, `saveUserProfile` (preserves the original `createdAt`
  across edits).
- `src/EmojiPicker.tsx` — the fixed `EMOJI_PALETTE` (model.ts) grid, shared by
  the host's profile editor, the join form, and the lobby's self-edit.
- `src/content/profileQuestions.ts` — milestone 8: the built-in guided-question
  bank (`ProfileQuestion[]`), content only, same convention as
  `content/prompts.ts`.
- `src/lib/profileQuestions.ts` — milestone 8. A host's own persisted question
  bank (`useCustomQuestions`, `addCustomQuestion`, `deleteCustomQuestion`, at
  `users/{uid}/customQuestions`, reused across every gathering they open) and
  a player's own answers within one gathering (`saveProfileAnswer`,
  `useMyProfileAnswers`, at `players/{uid}/profileAnswers/{questionId}` -
  private, never readable by another player). `readCustomQuestions` is the
  one-off read `createRoom`'s snapshot uses - see the comment on its
  `customQuestions` parameter for why `room.ts` never imports this file
  directly (it would cycle back, the same reasoning `nameSlotId`'s
  duplication already documents).
- `src/GuidedQuestions.tsx` — "ספרו לנו על עצמכם", shown in the lobby while
  waiting: every built-in plus this gathering's own custom questions, each
  with its own independent save button and saved-state, never one shared
  form-wide save (asked for directly - a half-typed or regretted answer must
  never be swept up by someone else's save tap).
- `src/QuestionRow.tsx` — one guided question (chips for choice questions,
  a real toggling "אחר", its own save and a fading "נשמר ✓"), shared by the
  lobby and GroupDetails' per-person editor so the two never drift apart.
  The answer is always derived from the selection, never stored beside it.
- `src/lib/harvest.ts` — milestone 4: the session state machine and the
  harvest phase. `startHarvestGame`, `submitHarvestItem` (the three-write
  contract - see `ITEM_WRITE_ORDER` in `model.ts`), `getMySubmission`,
  `advanceGamePhase`, `extendGamePhase`, `pickHarvestPromptIds`, plus the
  `useGame`/`useHarvestProgress` hooks.
- `src/lib/rounds.ts` — milestone 5: the "who said that" round loop and
  scoring. `openNextRound`, `openVoting`, `skipRound`, `castVote`,
  `revealRound` (the reveal sequence - see `ROUND_REVEAL_ORDER` in
  `model.ts`), `finishGame`, plus the `useRounds`/`useItems`/`useVotes`/
  `useAuthor` hooks.
- `src/Rounds.tsx` — the round screen: host preview and skip, voting on every
  phone, the reveal with who-voted-for-whom, and the running scoreboard.
- `src/lib/secondGame.ts` — milestone 6: "most likely to". `startSecondGame`,
  `openNextSecondRound` (revealed items only), `scoreMajority`,
  `mostVotedPlayers`, `endGathering`, `useRevealedItems`. The round mechanics
  themselves are rounds.ts's, reused.
- `src/SecondGame.tsx` / `src/BetweenGames.tsx` / `src/Finale.tsx` — the second
  game, the pause between games, and the evening's last screen.
- `src/lib/memory.ts` — milestone 7: what the evening leaves behind, all of it
  in the host's own private store. `ensureContacts`, `createGroup` (a group
  made before any gathering, from the room picker - starts with no members),
  `writeFactsForGame`, `writeRemainingFacts`, `writeProfileFacts` (milestone
  8's collector - upserts rather than write-once, since a profile answer is
  editable up to the moment the evening ends, unlike a harvest fact),
  `addManualFact`/`addManualGroupFact` (the host's own free-form note, no
  question or game behind it - milestone 8), `nameGroup`, `recordFeedback`,
  `linkPlayerToContact` (the host's manual override for a returning person
  name-matching cannot recognise - `ensureContacts` resolves these first and
  never overwrites one), `shareGroup`/`importSharedGroup` (a one-time copy of
  a whole group into another host's account, staged through
  `groupShares/{id}` - see GroupShareDoc), the deletion cascade
  (`deleteFact`/`deleteContact`/`deleteGroup`), and the
  `useGroupMemory` (returns `members: RememberedMember[]`, each with their own
  `facts`, plus a separate `groupFacts` array - grouped by person, not one flat
  list; takes an optional `refreshToken` to force a re-read after a manual add,
  since it has no live listener), `useSavedGroups`/`useGroupName` hooks.
- `src/RoomPicker.tsx` — the landing screen's room chooser: "a new room" or one
  of the host's saved groups, as a visible selection separate from the "open
  a room" tap itself, plus creating a new (empty) group.
- `src/GroupDetails.tsx` — a saved group's details, owner only: per-person
  facts (including "nothing recorded yet"), group-wide facts, inline renaming,
  per-fact deletion, adding/removing a person (`addGroupMember` - refuses a
  name already in that group - / `deleteContact`), two separate destructive actions (`wipeGroupFacts` keeps
  the group and its people; `deleteGroup` removes everything), adding a
  free-form fact directly to a person or the group, and each person's full
  guided-question list, editable by the host (`setContactQuestionAnswer` -
  writes the same `profile_{questionId}` document `writeProfileFacts` does, so
  the two converge). Named `GroupDetails` rather than the milestone-7 original
  `GroupMemory` once it stopped being read-only.
- **An unnamed group cannot be found from any screen** - `useSavedGroups`
  lists named groups only, yet that evening's facts are still written. Nitzan
  decided (2026-09-23) that an explicit "לא לשמור קבוצה" leaves straight
  away with no follow-up screen - only a named save gets the "view and edit
  now?" stage (`LeaveRoomControl`'s 'group-saved'). An earlier pass showed
  that stage after a decline too, and he rejected it; do not reintroduce it
  as a "safety net" without asking. See DECISIONS.md, "third pass".
- `src/lib/useAction.ts` — one host tap: busy, the error with its code, and the
  "still trying" notice a write that never settles needs.
- `src/HostButton.tsx`, `src/Scoreboard.tsx`, `src/LoadFailure.tsx` — the
  pieces every screen shares.
- `src/Gathering.tsx` — routes an in-room screen off the live session/game
  documents (lobby, harvest, either game, between games, or the finale), and
  hosts the presence heartbeat for the whole gathering, not just the lobby.
  **Computes `isHost` live from `session.hostUid`, and never takes it as a
  prop** - App.tsx used to decide it once at screen-resolution time, which
  made a host transfer invisible to the new host's own client. Distinguishes
  the *active* host (runs the controls) from the *original* one (owns the
  memory) - see `SessionDoc.hostUid`/`originalHostUid`.
- `src/LinkPlayers.tsx` — host-only, lobby-only: links a player whose typed
  name matches nothing the group knows to whoever they actually are
  (`linkPlayerToContact`). The manual override for the one case `matchName`
  structurally cannot handle.
- `src/Harvest.tsx` — the harvest phase UI: one answer per prompt, the
  advisory countdown, and the host's "give another minute" / "continue"
  controls.
- `src/lib/canonicalHost.ts` — bounces the `.web.app` twin to the auth domain.
  Read its comment before touching anything about domains.
- **Leaving a room** lives in `App.tsx`'s own `LeaveRoomControl`: an ordinary
  player just confirms, while the *active* host chooses between closing the
  room for everyone (which runs the full end-of-evening collection first, so
  an early close keeps everything) and handing it to another participant
  (`transferHost`). A transfer moves control only - see the two host fields on
  `SessionDoc`, and DECISIONS.md, "Handing a room over".
  Read its comment before touching anything about domains.
- `src/test/setup.ts` — Vitest setup (jest-dom matchers).
- `index.html` — declares `lang="he" dir="rtl"`.

## Conventions
- **Firebase config lives in `.env.local` (gitignored), never in source.**
  Copy `.env.example` and fill it in from Firebase console → Project settings
  → General → Your apps → flashplay (web) → SDK setup and configuration. None
  of it is secret (it ships in the client bundle) — the point is making it
  structurally hard to accidentally point a build at the wrong project.
- **All repo files in English** — code, comments, docs, commit messages — even
  when the conversation that produced them was in Hebrew. Product-facing strings
  are Hebrew and live in `src/i18n.ts`, never inline in components.
- **No hardcoded UI strings.** i18n infrastructure exists from day one even
  though only Hebrew ships, so adding a language stays a content decision.
- Tailwind v4 via `@tailwindcss/vite`; no `tailwind.config.js`.
- **Visual identity is "neon night" (chosen 2026-09-17, see DECISIONS.md) - a
  small `@theme` token set in `src/index.css`, not a component library.**
  Colour utilities always go through the tokens (`bg-accent`, `text-muted`,
  `border-line`, `bg-surface`, `text-danger`, `text-accent-2`/`accent-3`) -
  never a stock Tailwind colour like `blue-600` or `neutral-500` directly, or
  a screen quietly drifts from the rest of the app. One committed dark theme,
  not a light/dark toggle - deliberately deferred, see BACKLOG.md, "a
  light/colourful second theme".

## Where this lives
`C:\Users\nitza\Dev\FlashPlay` — a plain folder, deliberately **not** inside the
OneDrive-synced Career Vault. It was briefly scaffolded in the vault on
2026-09-04 and moved out the same day; see the vault's
`08_DECISIONS/Working Setup - Code & Vault Stay Separate.md` for what that cost
and why. Do not move it back. The vault keeps only the career-facing note at
`04_PROJECTS/FlashPlay/FlashPlay.md`; one session can read both paths at once,
so there is no reason to co-locate them.

## Known pitfalls
- **A new emulator-backed test file must be registered in two separate config
  files, not one.** `vite.config.ts`'s `exclude` keeps it out of plain
  `npm test` (which has no emulator); `vitest.rules.config.ts`'s `include`
  is what actually runs it under `npm run test:rules`. Adding only one half
  either makes `npm test` fail with `ECONNREFUSED` (ran, no emulator) or makes
  the new tests silently never run at all (present, but not in either list).
  Check both whenever a new `src/lib/*.test.ts` needs the emulator. Found
  2026-09-17 adding `profile.test.ts`.
- **Gating a client read on document A's state to satisfy a rule that checks
  document B is a race the emulator cannot show you.** `revealRound()` writes
  a round's `phase` and its item's `revealed` flag as two separate awaited
  writes; `Rounds.tsx` gated its own read of `itemAuthors` on the ROUND's
  phase, but the rule that read actually has to satisfy (`itemRevealed()`)
  checks the ITEM's flag - a different document, written second. The
  emulator's client and server round-trip in under a millisecond, so the two
  writes always land close enough together that the gap never showed up in
  eighteen months of tests; a real network's round-trip is wide enough to
  fall through it reliably; every live reveal failed with a
  permission-denied. Found 2026-09-16, in Nitzan's first real play session -
  see DECISIONS.md, "the first real play session". When a screen's `enabled`
  flag for a rule-gated read is derived from phase X of document A, check
  which document the rule itself actually reads before assuming X is the
  right signal.
- **A truthy Firebase `user` does not mean "signed in" once anonymous auth is
  in play anywhere in the app.** `signInAsGuest()` mints a real, truthy `User`
  object with a real uid - it exists only so the rules have a subject to
  authorise a join against, not to mean the person made an account. Any UI
  gating on "is someone signed in" (a dashboard, a "sign out" button, a
  registered-only action) has to check `!user.isAnonymous` too, or an
  anonymous guest sees the same screen a real host does - and any action on it
  that requires `isRegistered()` in firestore.rules then fails as a raw
  permission-denied error instead of the plain "sign in first" the screen
  should have shown. Found on `App.tsx`'s host-landing screen, 2026-09-16 -
  see DECISIONS.md, "the same walkthrough, continued".
- `import.meta.url` is not a `file:` URL under Vitest — reading a project file
  from a test needs `resolve(process.cwd(), ...)`, not `new URL(...)`.
- `tsconfig.app.json` needs `"node"` and `"vitest/globals"` in `types`, or
  `npm run build` fails on the test files.
- Firebase must be a **separate project** from the live `Imposter Game` one, or
  test sessions hit real users.
- **Mocking `firebase/auth`'s `GoogleAuthProvider` with an arrow function
  fails** — `new GoogleAuthProvider()` needs a real constructor, and arrow
  functions cannot be called with `new`. `vi.fn()` on its own works (its
  default implementation returns `undefined`, which `new` treats as "use
  `this`"); `vi.fn().mockImplementation(() => ({}))` throws
  `TypeError: ... is not a constructor`.
- **`auth/configuration-not-found` on sign-in means the Google provider isn't
  enabled yet in that Firebase project's Authentication settings** — it is not
  a wrong-project or wrong-config error. Confirmed 2026-09-06 against
  `flashplay-50bde`: the redirect reached Firebase's real backend (config was
  correct) and failed only on this.
- **The app must be served from `flashplay-50bde.firebaseapp.com`, not the
  `flashplay-50bde.web.app` twin.** Firebase gives one Hosting site two
  domains; only `firebaseapp.com` is the `authDomain` and the OAuth redirect
  URI registered with Google. Served from `.web.app`, redirect sign-in
  **fails silently**: Google accepts the login, the browser comes back, and
  the app is still signed out with no error in the console and nothing in
  `getRedirectResult` - Chrome's third-party storage partitioning drops the
  handoff between the two origins. Root-caused 2026-09-06 after two wrong
  guesses; `src/lib/canonicalHost.ts` now redirects the `.web.app` twin to
  the canonical host so a link shared from the wrong domain still works.
- **Do not "fix" that by pointing `VITE_FIREBASE_AUTH_DOMAIN` at
  `.web.app`.** Tried on 2026-09-06; Google rejects it outright with
  `Error 400: redirect_uri_mismatch`, because only
  `https://flashplay-50bde.firebaseapp.com/__/auth/handler` is registered as
  an authorised redirect URI. The direction that works is moving the *app*
  to the auth domain, not the auth domain to the app.
- **Firebase Hosting caches `index.html` at the CDN edge**, so a `curl`
  straight after `firebase deploy` can still return the previous build.
  Compare the asset hash against `dist/index.html`, or you will "confirm" a
  deploy that has not landed.
- **The query-string cache-buster does not work on Firebase Hosting, and
  fails in the dangerous direction.** `curl ".../?nocache=$(date +%s)"` — the
  method this file recommended until 2026-09-07 — returned the *previous*
  build's hash minutes after a deploy that had in fact landed: the CDN keys
  on path and ignores the query string. That is a false negative, which is
  worse than no check, because it sends you redeploying after a phantom.
  What actually works is the request header:
  `curl -s -H 'Cache-Control: no-cache' https://flashplay-50bde.firebaseapp.com/`
  — confirm `X-Cache: MISS` in `curl -I` output, then compare hashes. Best
  evidence of all is grepping the served bundle for a string only the new
  code contains (e.g. `roomCodes` for milestone 3), since a matching hash
  proves delivery but not content.
- **A test double that cannot produce the real failure is not evidence — it
  invents impossible states and certifies them.** Three separate live bugs on
  2026-09-07, all of which the suite was green through, all the same shape:
  the emulator could not produce clock skew (one machine, one clock); a mocked
  `resolveRoomCode` returned success to an *unauthenticated* caller, which
  real rules never do; a mocked `getDoc` answered "document does not exist"
  where real rules answer "permission denied" — an answer that changed which
  branch the client took. **Whenever correctness depends on an enforcement
  boundary outside the code (security rules, a real clock, a real server),
  at least one test must run against the real boundary.** Where the boundary
  genuinely cannot be reproduced, encode the hostile input in the *data*
  instead — that is how the clock-skew fix is tested without a second clock.
- **A guest cannot read its own player document before joining, by design.**
  `players` is `allow read: if isPlayer(sessionId)`, and `isPlayer` is only
  true once that document exists — so "have I already joined?" is a question a
  first-time guest is structurally forbidden to ask Firestore. Every live
  first-time join failed on exactly this. Membership on the client is answered
  from `localStorage` (`flashplay.session`), never by probing Firestore. Any
  future rejoin/resume code will hit this again; `room.test.ts` pins it down
  with an `assertFails` against real rules.
- **Never make a client-computed timestamp satisfy an exact-boundary
  comparison against server time.** The room-code rule's ceiling was
  `expiresAt <= request.time.toMillis() + WINDOW` (server clock) while the
  client sent `Date.now() + WINDOW` (its own clock). That passes only if the
  client is not ahead by even a millisecond. On 2026-09-07 this laptop ran
  **~200ms fast** and *every* room-code claim was denied, deterministically,
  in production — while all 67 emulator assertions stayed green, because the
  emulator's client and server are one machine with one clock. **This class
  of bug is invisible to the emulator by construction.** The fix is
  `ROOM_CODE_CLOCK_SKEW_MARGIN_MS`: the client asks for less than the
  ceiling. The principled fix, if this recurs elsewhere, is to keep expiry
  entirely in server time — write `createdAt` with `serverTimestamp()`,
  assert `request.resource.data.createdAt == request.time` in the rule, and
  derive expiry from it, so no client clock enters the comparison at all
  (recorded in BACKLOG.md).
- **A measurement at the wrong resolution is worse than no measurement.**
  The above was diagnosed, then *wrongly dismissed*, because the first clock
  check compared `date` against an HTTP `Date` header — one-second
  resolution, which reported "skew=0" for a 200ms error and sent the
  investigation chasing an innocent `get()` clause instead. Sub-second offset
  needs round-trip bracketing (record local time either side of a request;
  the server's second-granularity timestamp then bounds the offset from both
  ends). **Before believing a measurement rules something out, check its
  resolution is finer than the effect being ruled out.**
- **A `catch {}` that swallows a Firestore error makes a live failure
  undiagnosable.** The same outage produced a totally empty browser console,
  because both the claim-retry loop and the UI handler discarded the error.
  Every catch in `src/lib/room.ts` and `src/App.tsx` now reports the failing
  step and the Firebase error code, and the UI shows the technical detail
  under the friendly message — on a phone there is no console to open, so an
  error that does not say what failed cannot be diagnosed at all.
- **`@firebase/rules-unit-testing`'s `.firestore()` return type is not
  structurally assignable to the modular `Firestore` type**, even though it's
  runtime-interchangeable with modular SDK functions like `doc()`/`getDoc()`.
  A client-library function typed with `firestore: Firestore` (the pattern
  `src/lib/room.ts` uses so its logic can run against the emulator) rejects it
  at compile time with "missing `type`, `toJSON`". Fix at the test-helper
  boundary: `testEnv.authenticatedContext(uid).firestore() as unknown as
  Firestore`. Found while writing `room.test.ts` on 2026-09-07.
- **Mocking global `Math.random` to control which room code gets generated
  does not work once Firestore calls are involved** — the Firestore SDK
  itself calls `Math.random()` internally (connection setup, backoff jitter)
  before your own code's call, consuming the mocked sequence unpredictably.
  Inject a pluggable generator function instead (`nextCode` parameter on
  `createRoom`/`claimRoomCode`) rather than mocking the global.
- **`testEnv.authenticatedContext(uid)` with no `tokenOptions` omits the
  `firebase.sign_in_provider` claim entirely** rather than defaulting to a
  realistic value. A rule checking `!= 'anonymous'` (like `isRegistered()`)
  then passes on an *absent* claim, not because it correctly identified a
  registered user — so a "host" test using the bare default proves nothing
  about the real check. Any test standing in for a registered/Google user
  needs an explicit `{ firebase: { sign_in_provider: 'google.com' } }`, or
  it's a vacuous pass waiting to be found by the next review, the way it was
  in milestone 3's first version.
- **Any document pairing a player's uid with one of their item ids IS the
  author mapping, whatever it is called, and must be readable by its owner
  alone.** Milestone 4's `submissions/{uid}` slot was written with `read: if
  isPlayer(sessionId)` because it looked like bookkeeping; since `items` is
  public to players, listing that one collection reconstructed the whole
  answer key the first game depends on hiding, and published the item id
  needed to pre-claim someone else's submission. Found by review on
  2026-09-08, now `get` + owner only. The question to ask of a new collection
  is not "is this secret?" but "does it let someone join two things that are
  each individually fine?"
- **An immutable, uid-keyed guard needs a resume path designed with it.** The
  same slot blocks duplicates by being un-updatable, which also meant a client
  that died mid-sequence could never retry - and it silently invalidated
  ITEM_WRITE_ORDER's two-milestone-old "generate a fresh id on retry" rule,
  which was then wrong in a comment nobody re-read. When a new write is
  prepended to an existing sequence, re-read the invariants the old sequence
  documented, not just the code.
- **A rules `get()` on a document that does not exist fails the whole
  evaluation** with `Property <field> is undefined on object`, rather than
  cleanly denying. So adding a `get()`-based cross-check to a rule breaks
  every existing test whose fixture omits that document, with an error that
  reads like a rules bug rather than a missing seed. Seed the full chain a new
  rule will traverse.
- **`vi.mock`'s factory must list every export its consumers import**, even
  transitively - adding one function to `room.ts`/`harvest.ts` makes
  `App.test.tsx` throw `No '<name>' export is defined on the mock` at render
  time, which looks like a component bug. This has now bitten twice in
  milestone 4 alone; check the mock factories when adding an export.
- **A `setState` call does not apply before the next render - reading the
  state it just set, later in the same synchronous call, reads the old
  value.** `LeaveRoomControl`'s close/transfer-and-leave flow called
  `setPendingAction('close')` and then, in that same click handler, invoked a
  `finish()` that read `pendingAction` from its own closure - still the
  *previous* render's value, since React had not re-rendered yet. For a group
  already named (the one path that runs `finish` immediately rather than via
  a later stage) this silently did nothing at all. Found before it shipped,
  2026-09-22 - pass the value as a plain argument to anything that needs it
  in the same call that just set it; only trust reading the state back once a
  later render has actually happened (e.g. a subsequent stage's own button).
- **A fix for a reported interaction bug is tested against the whole
  interaction, not just the symptom reported.** "אחר" on the guided
  questions took three versions: the first lost its text when toggled off;
  the fix made it one-way, which Nitzan then found could never be turned off
  (and a single-choice "אחר" could not be re-picked by tap). Each version's
  tests covered only the complaint just made. For any toggle or selection,
  test on / off / on-again and switch-away-and-back before shipping.
- **Before adding a UI element that treats one specific string as special
  (a synthetic "other" option, a sentinel label), grep the content it will
  sit alongside for that exact string.** `GuidedQuestions.tsx`'s new "אחר"
  chip, added to every choice question generically, collided with the
  `music` question's own pre-existing `'אחר'` option - both rendered, side by
  side, in the same row. The bug only showed up as a Testing Library "found
  two elements" error, not as a compile or logic error, because nothing about
  either code path was individually wrong.

## Milestone 3, implemented - what a fresh session needs to know

Room, joining, presence, player identity and the member list are built. Only
the gate itself (a real multi-device test, and the independent review) has not
run - see `docs/MILESTONES.md` for exactly what remains.

**The room code is no longer the session's document id.** That was true
through milestone 2 and is the single biggest thing to un-learn from reading
older code or docs by feel rather than checking them. The session id is now
`crypto.randomUUID()` (unguessable, never shown to a human); the short code a
person actually types or receives in a link lives in its own
`roomCodes/{code}` document (`RoomCodeDoc` in `src/lib/model.ts`) that resolves
to a session id, and can expire and be reclaimed by a new gathering
(`ROOM_CODE_WINDOW_MS`, currently twelve hours) instead of being squatted
forever. See `docs/DECISIONS.md`, "Decisions made in milestone 3", for why.

**Other constraints milestone 3 built on, still load-bearing:**

- **Sessions cannot be deleted, and phase only moves forward** (`lobby` →
  `playing` → `finished`). Both are security guards, not conveniences - see
  DECISIONS.md before relaxing either. Milestone 3 made session deletion
  actually *safe* (the id is unguessable, so nothing can retarget a deleted
  one) without changing the rule - real cleanup would still need a server this
  app doesn't have.
- **A player joins by creating `players/{their own uid}`.** That write is what
  makes `isPlayer` true and unlocks the roster; the roster is deliberately
  unreadable before it. Guests get a uid from anonymous sign-in
  (`signInAsGuest` in `src/lib/auth.ts`).
- **Opening a gathering requires a registered (non-anonymous) host, enforced
  in rules via `isRegistered()`**, not just a hidden button - see
  `src/lib/room.ts`'s `createRoom`.
- **A `roomCodes` write must name a session the caller actually hosts** -
  `firestore.rules` checks it with `get(sessions/$(sessionId))`, which only
  works because `createRoom` creates the session *before* claiming its code.
  Do not flip that order back for convenience; an independent review found
  this exact gap when the code was claimed first (DECISIONS.md).

**Client library:** `src/lib/room.ts` - `createRoom`, `resolveRoomCode`,
`joinRoom`, plus the `useRoster` and `usePresenceHeartbeat` hooks. Its
Firestore-touching functions take a `Firestore` instance as a parameter rather
than importing the app singleton, specifically so `room.test.ts` can run them
against the rules emulator and prove the claim/retry contract end to end, not
just what the rules allow in isolation.

**Anything touching `firestore.rules`** must run `npm run test:rules`, which
now also runs `src/lib/room.test.ts` (both are excluded from the default
`npm test` and need the emulator - see `vitest.config.ts` /
`vitest.rules.config.ts`). A new guard is not proven until it has been deleted
and its assertion watched to go red. The test file header records exactly
which guards have had that done.

## Milestone 4, implemented - what a fresh session needs to know

The session state machine and the harvest phase are built. The gate itself
(a multi-device run where one device is deliberately killed mid-phase) has
not run - see `docs/MILESTONES.md`.

**Every phase transition is an explicit host write, never a client-side
timer.** `GameDoc.phaseEndsAt` only drives the on-screen countdown - nothing
in the client or in `firestore.rules` ever compares it against anything, so a
skewed device clock (the exact bug that broke room codes on 2026-09-07) can
make the number on screen wrong but can never make the game do the wrong
thing. The host's own tap (`advanceGamePhase`) is what moves the gathering
forward, every time. This was a deliberate simplification agreed with Nitzan
on 2026-09-08, rather than porting the room-code approach (a rule comparing a
client timestamp to `request.time`) to a second place in the app.

**Three design parameters here have no answer in DESIGN.md or MILESTONES.md**
and were decided directly with Nitzan on 2026-09-08, not inferred:
- **No automatic minimum-submission threshold.** The host can always advance
  from harvesting to rounds, at any submission count. `useHarvestProgress`'s
  count is advisory display only, never a gate.
- **"Duplicate blocking" means one item per player per prompt per game** -
  see `PromptSubmissionDoc` below. (Not, e.g., blocking identical text from
  two different players - that is allowed.)
- **The harvest timer is a fixed 90s** (DESIGN's own number), plus a host
  "give it another minute" button (`extendGamePhase`) that adds
  `HARVEST_EXTEND_MS` any number of times, rather than a host-configurable
  duration set up front.

**"Duplicate blocking" is enforced by a new collection, not a count check.**
`sessions/{sessionId}/games/{gameId}/prompts/{promptId}/submissions/{uid}`
(`PromptSubmissionDoc` in `src/lib/model.ts`) is a slot whose document id is
the player's own uid - the same trick `PlayerDoc` uses. That is what makes it
safe against a front-running block, unlike `itemAuthors`' random ids: nobody
but `uid` can ever attempt to write this specific document, so there is
nothing for another player to race by pre-claiming it. `submitHarvestItem` in
`harvest.ts` writes this slot *before* either of the two writes
`ITEM_WRITE_ORDER` already documented - three sequential writes now, not two.
A second submission attempt for a prompt cannot produce a second item (the
slot already exists and is never updatable), which is what closes the BACKLOG
item "orphan claims are unbounded" as a side effect: a player can hold at
most one `itemAuthors` claim per prompt per game.

**Two things about that slot were wrong in the first version and are worth
not re-introducing.** It was readable by every player, which handed out the
answer key (see Known pitfalls - it pairs a uid with an item id, and `items`
is public); it is now `get`, owner only. And a retry minted a fresh item id,
so a device killed between the slot write and the item write locked that
player out of that prompt forever while the UI showed them a green tick;
`submitHarvestItem` now resumes the slot's recorded id, and the UI asks
`getSubmissionState` whether the *item* exists rather than trusting the slot.
Both were found by the milestone's own four-lens review, not by the suite.

**`ItemAuthorDoc` now carries `gameId`/`promptId`, not just `authorPlayerId`.**
The claim is written before the item exists, so at that point there is
nowhere else to find which submission slot it should be checked against - see
the comment on `ItemAuthorDoc` in `model.ts`. `items` create then cross-checks
its own declared `gameId`/`promptId` against the claim's, so a slot reserved
for one prompt cannot be spent on an item tagged as a different one.

**`items` create is also gated on the game's phase and the text's length.** A
submission after the host has advanced the game past `harvesting` is refused,
not silently accepted; `ITEM_TEXT_MAX_LENGTH` (300) bounds text that is
PUBLIC and rendered on every phone in the room the instant it lands, mirrored
in both `model.ts` and `firestore.rules`.

**Joining during submission needed no rules change.** `players` create was
already `isSignedIn()`-only with no phase check (milestone 3), so a player who
joins mid-harvest simply lands in `Gathering.tsx`'s harvest branch like anyone
else - DESIGN's requirement here was already satisfied by the room layer.

Automated evidence: `npm run build`, `npm test` (41 tests, including
`Harvest.test.tsx`, which drives every state of the harvest screen - notably
that a reserved-but-unwritten slot shows the input again rather than a green
tick), `npm run test:rules` (105 assertions: 81 in
`firestore-rules.test.ts`, 16 in
`harvest.test.ts`, which proves `submitHarvestItem`'s three-write contract,
the client-visible shape of duplicate blocking, and the resume-after-a-killed-
device path end to end rather than only what the rules allow in isolation, and
8 in `room.test.ts`). Six guards are mutation-checked: the submission-slot
non-updatability (duplicate blocking's headline claim), the harvesting-phase
gate on item creation, the slot/claim item-id cross-check, the owner-only read
on the slot (widening it back to `read: if isPlayer(sessionId)` reddens
exactly one assertion), the resume path itself (making the retry mint a fresh
id again reddens exactly four), and the screen's own reading of it (treating
any slot as "submitted" again reddens exactly one).

**The four-lens review has run** - correctness, data and security, mobile
reality, and the full scenario walkthrough, on 2026-09-08. It found two
serious defects, both fixed and both described above; everything else is in
BACKLOG.md, "From the milestone-4 four-lens review", and the shape-level
lessons are in DECISIONS.md, "What the milestone-4 review found".

**Not yet run: the gate itself.** A multi-device session where one device is
deliberately killed mid-harvest-phase, to prove the host override actually
recovers the gathering when a real phone genuinely stops responding rather
than merely being slow. Needs real people, the same as milestone 3's
still-outstanding timed run - both are candidates for a single combined
session rather than two separate ones.

## Milestone 5, implemented - what a fresh session needs to know

"Who said that" is built: the host opens a round, previews the item alone,
opens voting, every phone votes, the host reveals, points land, next round.
`src/lib/rounds.ts` and `src/Rounds.tsx`. The gate's other half - real people,
over a real network - has now run once, 2026-09-16, and found a live-only
race in exactly the reveal sequence this section describes: see "Known
pitfalls" above and DECISIONS.md, "the first real play session".

**The reveal is a sequence, and its order is a security boundary.** Close the
round first, then reveal the item, then read votes and author, then record what
the round paid, then recompute the totals - `ROUND_REVEAL_ORDER` in `model.ts`
states it and says why. The first version did the first two the other way
round: for the gap between them the author was public while voting was still
open, so any player watching the items listener could read who wrote it and
change their vote. The rules now also refuse a vote once the round's item is
revealed, so the ordering is enforced rather than merely intended.

**Every step of the reveal is conditional, so a re-tap resumes it.** The item
update requires `revealed == false`, so a dropped write used to make the round
unrecoverable - and the only host control in `voting` is the reveal that could
no longer succeed. Same shape as milestone 4's stranded submission slot. If a
reveal lands but never scores, the host gets a "complete the reveal" button.

**Scores are derived, not incremented.** Each round records what it paid in
`RoundDoc.awarded` (writable exactly once, enforced in rules), and
`sessions.scores` is the sum of those maps. That is what makes re-running a
half-finished reveal harmless. A score seeded by anything other than a round's
`awarded` will be erased by the next recompute.

**Votes stay unreadable until the reveal, so the host cannot see progress -
hence `PlayerDoc.votedRoundId`.** It publishes *that* a player voted, never who
for, which is information the room already has by looking up. A live tally of
the votes themselves would turn the round into a poll everyone follows.

**Joining is blocked inside the round loop** (`inRoundLoop` in
`firestore.rules`), which is DESIGN's rule and was half-implemented before:
milestone 4 allowed joining during the harvest and never closed the other
window. Between games is open again.

Automated evidence: `npm run build`, `npm test` (54 tests - `Rounds.test.tsx`
drives every state of the round screen), `npm run test:rules` (133 assertions:
85 in `firestore-rules.test.ts`, 24 in `rounds.test.ts`, 16 in
`harvest.test.ts`, 8 in `room.test.ts`). Nine of this milestone's guards are
mutation-checked, each turning exactly the named assertion red: round-phase
monotonicity, the round's item immutability, the self-vote refusal, the
vote-for-a-real-player check, the vote refusal once the author is exposed,
`awarded` being writable once, the join block inside the round loop, the
refusal to delete a round, and the client's own resume path.

**The four-lens review ran on 2026-09-14** and found nine serious defects
between them - all fixed, all described above or in DECISIONS.md, "What the
milestone-5 review found". Two are worth carrying forward as habits rather than
facts: a multi-write sequence needs its resume path designed with it, and a
gap between two writes is a state an attacker can sit in.

## Milestone 6, implemented - what a fresh session needs to know

"Most likely to", cumulative scoring and the ending are built. What has not
run is the gate: a full evening with three to five real friends, and the
listener fan-out check across browser profiles.

**The second game has no harvest and no prompts of its own.** It is built from
the items the first game **revealed**, which is the one thing that keeps it a
different game: an unrevealed item makes "who is most likely to do this" the
same question as "who wrote this". `openNextSecondRound` queries
`revealed == true` and nothing else; the rules pair each game type with the
only phase it may start in.

**Each prompt carries the question its answers get asked in the second game**
(`secondGameQuestion` in `src/content/prompts.ts`). A Hebrew answer is written
in the first person and cannot be re-conjugated without a generator, so the
question is written to fit a bare answer: "התשובה של דוד: «גבינה צהובה». מי
מכם הכי עלול לאכול את זה בעמידה מול המקרר?"

**Scoring differs, and is passed in rather than branched on.** `revealRound`
takes a `scorer`, so the delicate part - the resumable reveal sequence - has
exactly one implementation. "Who said that" pays for correct guesses; "most
likely to" pays everyone who voted with the majority, ties included.

**A self-vote is allowed in the second game and refused in the first**
(`selfVoteAllowed` in `firestore.rules`). In the first game, abstaining or
voting for yourself would mark the author out. In the second, "me" is an
honest answer - and the author of the item under discussion is the likeliest
majority pick, so barring them would exclude one named person from the scoring
every round.

**Narrowing a rule by a document field made that field part of the boundary.**
The vote guard keys off `game.type`, and `games` update was host-writable with
no shape check - so the host could flip the type, read an author while voting
was still open, and flip it back. `type` is now pinned immutable in the same
rule. Anything that narrows a security predicate by a field has to pin that
field in the same change.

Automated evidence: `npm run build`, `npm test` (80 tests: 9 in
`SecondGame.test.tsx`, 6 in `Ending.test.tsx`, 11 in `scoring.test.ts` for the
arithmetic of both games, plus the earlier screens' suites), `npm run
test:rules` (148 assertions: 85 in `firestore-rules.test.ts`, 24 in
`rounds.test.ts`, 16 in `harvest.test.ts`, 15 in `secondGame.test.ts`, 8 in
`room.test.ts`). Two of this milestone's guards are mutation-checked: the
game-type pin and the self-vote split, each turning exactly the named
assertion red.

**The four-lens review ran on 2026-09-14** and found eight serious defects -
all fixed. The one worth carrying as a habit: three of them were fixes that
already existed in `Rounds.tsx` and simply did not come across when this
screen was built from it. **A screen copied from a reviewed screen has to be
diffed against it, not read next to it** - which is why the slow-action
handling now lives in `useAction` rather than in whichever file wrote it
first.

## Milestone 7, implemented - what a fresh session needs to know

What the evening leaves behind is built: facts written into the host's private
store, the outcome feedback DESIGN asks for, a "what we remember" screen with
deletion, and a saved group that a later gathering continues.

**Everything here lives under `users/{hostUid}`, which nobody else can read.**
That rule predates this milestone (milestone 2 wrote it); milestone 7 is the
first code that puts anything real behind it. DESIGN calls a guest siphoning a
family's accumulated memory a severe product failure, so the private store is
the *only* place any of this goes - the gathering document holds nothing but a
map of player uid to contact id, which is useless without read access to the
store those ids point into.

**Contacts are created at the end of every game, not at the end of the
evening.** The first version tied them to the host's "save the group" tap,
which is where DESIGN puts the *offer* - and that quietly cost the thing DESIGN
asks for two paragraphs earlier: facts written per game so that an abandoned
session keeps what was played. With nothing to attribute to until the last
screen, every per-game write found an empty map and wrote nothing. Two
independent reviews found it. `ensureContacts` now runs from `BetweenGames`,
and the end-of-evening tap only *names* the group.

**Keeping the evening and keeping the group are different decisions.** The
evening is kept automatically (the items nobody played can only be attributed
once the session is `finished`, so the last screen is the last chance);
naming the group is what puts it on the shelf for next time, and
`useSavedGroups` lists only named ones. "Forget this group" deletes the lot,
which is what makes the automatic keeping consensual rather than presumptuous.

**A returning group is matched by name, not by uid.** A guest signs in
anonymously and gets a new uid every gathering, so the contact is the only
identity that survives - `matchName` normalises whitespace and case, and two
people in one room who type the same name still get two contacts. DESIGN's
"tap your name" is *not* built: it needs the member list readable before
joining, and the roster is deliberately closed until you are in the room
(Known pitfalls). What survived is that the host's store does the matching.

**Nothing reads a fact yet.** Both first-slice games generate their own
material, so the store accumulates and nothing consumes it. DESIGN's Test 3
(does the second gathering benefit from the first) therefore cannot pass yet -
that is a known gap, recorded in BACKLOG.md, not an oversight.

Automated evidence: `npm run build`, `npm test` (90 tests: 14 in
`Ending.test.tsx`, 18 in `App.test.tsx`, plus the earlier suites), `npm run
test:rules` (173 assertions: 85 in `firestore-rules.test.ts`, 25 in
`memory.test.ts`, 24 in `rounds.test.ts`, 16 in `harvest.test.ts`, 15 in
`secondGame.test.ts`, 8 in `room.test.ts`). Three of this milestone's fixes are
mutation-checked: the same-name contact split, the use-counter preservation,
and the returning-group id reaching the between-games write - each turning
exactly the named assertion red.

**The review found ten serious defects across three lenses**, and two are worth
carrying as habits. A feature can be "implemented" and still be a no-op if the
data it depends on is created later than it runs - the per-game writes were
green in tests that called them in the wrong order. And a library proven in
isolation says nothing about its wiring: the returning-group test passed the
group id explicitly while the screen never passed one at all.

## Open questions carried into later milestones
Full context in `docs/BACKLOG.md`; these two are here because they change what
gets built.

- **Android is untested.** WhatsApp there has historically used an isolated
  WebView and Google refuses OAuth from embedded WebViews, so sign-in may behave
  differently from the confirmed iOS result. Only a *host* signs in, so an Android
  guest is unaffected - this blocks other people hosting, not the first family
  session.
- **Listener fan-out is only realistic at the target itself.** Milestones 3 and 6
  run on three to five devices, so eleven-device behaviour is first exercised at
  the family session unless a browser-profile check is done in milestone 6.
