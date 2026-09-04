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
- `src/App.tsx` — app shell.
- `src/test/setup.ts` — Vitest setup (jest-dom matchers).
- `index.html` — declares `lang="he" dir="rtl"`.

## Conventions
- **All repo files in English** — code, comments, docs, commit messages — even
  when the conversation that produced them was in Hebrew. Product-facing strings
  are Hebrew and live in `src/i18n.ts`, never inline in components.
- **No hardcoded UI strings.** i18n infrastructure exists from day one even
  though only Hebrew ships, so adding a language stays a content decision.
- Tailwind v4 via `@tailwindcss/vite`; no `tailwind.config.js`.

## Known pitfalls
- **This repo lives inside the OneDrive-synced Career_Vault**, at
  `04_PROJECTS/FlashPlay/app/`, by explicit decision (see the vault's
  `08_DECISIONS/Working Setup - Code & Vault Stay Separate.md`). Consequences:
  - `.git` is a *file*, not a directory — the real git dir is at
    `C:\Users\nitza\Dev\FlashPlay-git`, deliberately outside OneDrive, because
    git lock files in a synced folder corrupted this vault once before. Do not
    "fix" the `.git` file. Cloning or moving the repo means re-pointing it.
  - The vault's own `.gitignore` excludes `04_PROJECTS/FlashPlay/app/`, so the
    two git histories stay separate.
  - `node_modules` **does** sync to OneDrive (13,388 files, 272 MB as of
    2026-09-04). A directory junction was tried as a mitigation and **npm
    destroys it on every `npm install`** — verified twice. There is no working
    mitigation short of moving the repo out of OneDrive.
- `import.meta.url` is not a `file:` URL under Vitest — reading a project file
  from a test needs `resolve(process.cwd(), ...)`, not `new URL(...)`.
- `tsconfig.app.json` needs `"node"` and `"vitest/globals"` in `types`, or
  `npm run build` fails on the test files.
