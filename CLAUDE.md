# FlashPlay

## What this is
A party/gathering web app for a group already together in one room (3–25 people,
10–40 minutes), each on their own phone, joining by a link shared into the
group's WhatsApp chat. Its differentiator is personalisation around the real
named people present, plus accumulated memory of that specific group. Hebrew
content, RTL, no install.

Concept, architecture and milestones live in the plan document at
`C:\Users\nitza\.claude\plans\flickering-sleeping-adleman.md` (Hebrew). It is to
be rewritten here as `docs/DESIGN.md` in English, not translated. Read it before
making design decisions — most of them are already settled there with reasoning.

Current milestone: **1 — skeleton, separate Firebase project, redirect auth.**
Firebase project `flashplay-50bde` created 2026-09-06, separate from the live
`imposter-12401` project. Redirect sign-in works end to end on desktop.

**The app's canonical URL is `https://flashplay-50bde.firebaseapp.com`** —
this is the link to share, and it is not interchangeable with the
`.web.app` one. See Known pitfalls.

## Commands
All verified by execution on 2026-09-04.

- Build: `npm run build` (runs `tsc -b` then `vite build`)
- Run: `npm run dev`
- Test: `npm test` (Vitest, single run) / `npm run test:watch`
- Lint: `npm run lint` (oxlint)

## How we verify a change here
`npm run build && npm test` is the default evidence, and a change to behaviour
needs a test that demonstrably fails without it — flip the thing under test and
watch the test go red before claiming it guards anything.

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
- `src/App.tsx` — app shell: sign-in button, loading state, signed-in greeting.
- `src/lib/firebase.ts` — reads config from `VITE_FIREBASE_*` env vars, exports
  `firebaseApp` and `auth`. Throws on load if a var is missing.
- `src/lib/auth.ts` — `signInWithGoogle` (redirect, not popup — see comment),
  `signOutUser`, and the `useAuthUser()` hook (`{ user, loading, redirectError }`).
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
  Verify a deploy with a cache-buster (`curl ".../?nocache=$(date +%s)"`)
  and compare the asset hash against `dist/index.html`, or you will
  "confirm" a deploy that has not landed.

## Open items — milestone 1
- [x] **Enable the Google sign-in provider** in the `flashplay-50bde` Firebase
      console. Done and verified 2026-09-06: clicked the real sign-in button
      and traced the navigation — `localhost` → `flashplay-50bde.firebaseapp.com`
      (Firebase's auth handler) → `accounts.google.com` (Google's real sign-in
      page). No more `auth/configuration-not-found`. Stopped there deliberately
      rather than entering Nitzan's Google password.
- [x] **Redirect sign-in works end to end.** Verified 2026-09-06 on desktop
      Chrome: signed in with Google and the app showed the signed-in greeting
      with the account's real name. The fix was serving the app from
      `flashplay-50bde.firebaseapp.com` - see pitfalls above.
- [ ] **Re-test on a real phone via WhatsApp**, using the canonical URL
      `https://flashplay-50bde.firebaseapp.com`. The earlier phone test used
      the broken `.web.app` domain, so it proved nothing about the in-app
      browser specifically - that question is still open.
- [ ] Deploy to Firebase Hosting and validate the actual milestone-1 gate: open
      the hosted link from a real phone via a link shared into WhatsApp, sign
      in, and observe what happens to identity if the same person later opens
      the link in the phone's real browser instead of WhatsApp's in-app one.
      Nothing here has been run on a real device yet — everything above is
      laptop/browser-automation evidence only.
