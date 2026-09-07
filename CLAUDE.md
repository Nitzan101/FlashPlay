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
restate it here. Short version: milestone 1 is done, milestone 2 (data model,
then security rules) is next.

**The app's canonical URL is `https://flashplay-50bde.firebaseapp.com`** - this is
the link to share, and it is not interchangeable with the `.web.app` one. See
Known pitfalls.

## Commands
All verified by execution on 2026-09-04.

- Build: `npm run build` (runs `tsc -b` then `vite build`)
- Run: `npm run dev`
- Test: `npm test` (Vitest, single run) / `npm run test:watch`
- Security rules test: `npm run test:rules` - starts the Firestore emulator and
  runs the rules suite against it. Needs Java (present: OpenJDK 21). Excluded
  from `npm test` so the everyday loop stays fast and emulator-free.
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

Two kinds of change are not covered by that and need more:
- **Anything touching anonymity, ownership or read access** — the client reads
  Firestore directly, so security rules are the only enforcement boundary.
  Evidence is emulator assertions, plus opening devtools on a player device and
  confirming the hidden value is genuinely absent from the payload.
- **Anything touching the live session on phones** — screen lock, foreground
  resync, the WhatsApp in-app browser, redirect auth. These do not reproduce on
  a laptop. Evidence is a real multi-device run.

## Structure
- `src/main.tsx` — entry; mounts App, imports i18n and Tailwind.
- `src/i18n.ts` — i18next setup. Hebrew is the only shipped locale.
- `src/App.tsx` — app shell and the room flow's state machine: host sign-in and
  room creation, guest join-by-link, resuming a stored session on refresh.
- `src/Lobby.tsx` — the live member list + room code, shown once in a room.
- `src/lib/firebase.ts` — reads config from `VITE_FIREBASE_*` env vars, exports
  `firebaseApp`, `auth` and `db`. Throws on load if a var is missing.
- `src/lib/auth.ts` — `signInWithGoogle` (redirect, not popup — see comment),
  `signOutUser`, `signInAsGuest` (anonymous), and the `useAuthUser()` hook
  (`{ user, loading, redirectError }`).
- `src/lib/model.ts` — the Firestore data model: types and `paths` helpers.
  Single source of truth for document shapes; `firestore.rules` mirrors it by
  hand and the two are kept in step by the emulator tests.
- `src/lib/room.ts` — room creation, joining, presence: `createRoom`,
  `resolveRoomCode`, `joinRoom`, `useRoster`, `usePresenceHeartbeat`.
- `src/lib/canonicalHost.ts` — bounces the `.web.app` twin to the auth domain.
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

## Where this lives
`C:\Users\nitza\Dev\FlashPlay` — a plain folder, deliberately **not** inside the
OneDrive-synced Career Vault. It was briefly scaffolded in the vault on
2026-09-04 and moved out the same day; see the vault's
`08_DECISIONS/Working Setup - Code & Vault Stay Separate.md` for what that cost
and why. Do not move it back. The vault keeps only the career-facing note at
`04_PROJECTS/FlashPlay/FlashPlay.md`; one session can read both paths at once,
so there is no reason to co-locate them.

## Known pitfalls
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
