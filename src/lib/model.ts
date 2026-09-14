/**
 * The Firestore data model.
 *
 * These types and the path helpers below are the single source of truth for
 * document shapes on the client. `firestore.rules` enforces the same layout in
 * its own language and cannot import from here, so the two are kept in step by
 * the emulator tests in `firestore-rules.test.ts` rather than by the compiler -
 * if a path changes here and not there, those tests fail.
 *
 * The layout is driven by one requirement above all others (see DESIGN.md,
 * "Anonymity leaks through the client"): this app is serverless, so the client
 * reads Firestore directly and security rules are the only enforcement
 * boundary. Anything a player must not know yet has to live in a document they
 * cannot read yet - not in a field the client is merely trusted to ignore.
 */

// --- Facts, contacts and groups: the host's private store -------------------
//
// These live under the owning user and are never readable by session guests.
// A gathering copies in only the items actually in play; the store itself
// stays private, or a guest could siphon a family's accumulated memory.

/** Which drawer a fact lives in. Set by the wording of the harvest prompt that
 *  collected it, fixed when the game is written - never inferred at runtime.
 *  See DESIGN.md, "The memory model". */
export type FactDrawer = 'personal' | 'group'

export interface UserDoc {
  displayName: string
  createdAt: number
}

/** A person the owning user knows. Per-user by design: two hosts who know the
 *  same person hold separate records, which is what stops this becoming a
 *  global social graph. */
export interface ContactDoc {
  name: string
  /** Set once that person registers and claims this record. */
  claimedByUid: string | null
  createdAt: number
}

export interface GroupDoc {
  name: string
  memberContactIds: string[]
  createdAt: number
}

export interface FactDoc {
  text: string
  /** Which harvest prompt produced it - this is what determined the drawer. */
  promptId: string
  /** Kept even when display is anonymous, or a personal fact could never
   *  travel with its person. */
  authorContactId: string
  /** Selection prefers unused facts and never repeats one within a gathering. */
  useCount: number
  /** The gathering it came from, for provenance. */
  sessionId: string
  createdAt: number
}

// --- The live gathering -----------------------------------------------------

export type SessionPhase = 'lobby' | 'playing' | 'finished'

export interface SessionDoc {
  /**
   * The document id is a random, unguessable string (`crypto.randomUUID()`),
   * never typed or shown to a human. This field is the short human-facing
   * code, kept here only for display - the code's actual lookup lives in a
   * separate `RoomCodeDoc`, which is what a guest resolves to get here.
   *
   * **Why split from the id, milestone 3:** the id used to be the code
   * itself, but that meant a code could never be released - a permanently
   * squatted code denies a real host forever (BACKLOG, "Room-code lifecycle
   * and squatting"). An unguessable id removes the enumeration risk that
   * originally forced code-as-id, which frees the code to expire and be
   * reclaimed on its own - see `RoomCodeDoc` and `ROOM_CODE_WINDOW_MS`.
   */
  roomCode: string
  hostUid: string
  /** Null at a first gathering, before the group has been saved. */
  groupId: string | null
  phase: SessionPhase
  currentGameId: string | null
  /** Cumulative across the whole gathering, not per game - this is what turns
   *  three games into one evening with an arc. */
  scores: Record<string, number>
  createdAt: number
  /** Carried over from the room code's own `expiresAt` at creation, for
   *  display only. Not enforced by rules - the session document itself is
   *  never deleted (see firestore.rules); only the code can expire. */
  expiresAt: number
}

/**
 * The join-time lookup for a gathering: maps the short human-facing code to
 * the session's real (unguessable) id. Same-shape problem as `sessions` used
 * to have - see the comment on `SessionDoc.roomCode`.
 *
 * **Lifecycle, not a convenience.** `create` requires a fresh `expiresAt`
 * within `ROOM_CODE_WINDOW_MS` of now; `update` is how an expired code is
 * reclaimed for a new gathering, since Firestore evaluates a write to an
 * existing document id as `update` regardless of which client call produced
 * it. The session document a reclaimed code used to point at is never
 * deleted - it becomes unreachable, not gone. See firestore.rules,
 * `match /roomCodes/{code}`.
 */
export interface RoomCodeDoc {
  sessionId: string
  hostUid: string
  createdAt: number
  expiresAt: number
}

/**
 * How long a room code reservation lives before it becomes reclaimable by a
 * new gathering. Gatherings run 10-40 minutes (DESIGN.md); twelve hours is
 * generous headroom for a late start or a paused evening without leaving a
 * squatted code unusable for days. Enforced in firestore.rules as a literal
 * (rules cannot import this) - keep the two in step, the way `ITEM_WRITE_ORDER`
 * documents its own client/rules pairing below.
 */
export const ROOM_CODE_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * How far short of the maximum window a client actually asks for, to absorb
 * the difference between its own clock and Firestore's.
 *
 * **This is not defensive padding, it is the fix for a real outage.** The
 * rule's ceiling is `expiresAt <= request.time.toMillis() +
 * ROOM_CODE_WINDOW_MS`, evaluated against the *server's* clock, while
 * `expiresAt` is computed from the *client's*. Asking for exactly the maximum
 * therefore only succeeds when the client's clock is at or behind the
 * server's - and on 2026-09-07 a laptop running 200ms fast had every single
 * room-code claim denied, deterministically, with no way to tell from the
 * error which of the rule's clauses had failed.
 *
 * The emulator cannot catch this class of bug: client and server are the same
 * machine, so the client's timestamp is never ahead of the server's.
 *
 * Thirty minutes is far more skew than any NTP-synced device has (a clock
 * that wrong would already be failing TLS and Firebase Auth token validation),
 * and it costs nothing - the window only shrinks from 12h to 11h30m, against
 * gatherings that last well under an hour.
 */
export const ROOM_CODE_CLOCK_SKEW_MARGIN_MS = 30 * 60 * 1000

export interface PlayerDoc {
  name: string
  /** Every player has a uid, guests included - guests sign in anonymously so
   *  that the rules have a subject to authorise against. "Never blocked" means
   *  no sign-in friction, not no identity. */
  uid: string
  /** A participant added by name who holds no phone. The host acts for them. */
  hasDevice: boolean
  /** Presence heartbeat. Disconnections across twenty phones are a certainty. */
  lastSeenAt: number
  joinedAt: number
  /**
   * The round this player has already voted in, or null. Milestone 5.
   *
   * Deliberately here, on a public document, rather than derived from the
   * votes themselves: votes are unreadable until the reveal (a live tally
   * would turn the round into a poll everyone follows), but the host still
   * has to know when the room has finished voting. This publishes only
   * *that* someone voted, which is already visible to anyone in the room, and
   * never who for.
   */
  votedRoundId: string | null
}

export type GameType = 'who-said-that' | 'most-likely-to'
export type GamePhase = 'harvesting' | 'rounds' | 'done'

export interface GameDoc {
  type: GameType
  /**
   * `who-said-that` opens in `harvesting`; `most-likely-to` opens straight in
   * `rounds` and has no prompts of its own, because it is built out of the
   * items the first game already revealed (DESIGN: an unrevealed item would
   * make "who is most likely to do this" the same question as "who wrote
   * this", collapsing the two games into one). firestore.rules enforces that
   * pairing on create.
   */
  phase: GamePhase
  /** Everyone answers the same prompts, or the room cannot tell which question
   *  the item being read out is answering. Two per gathering - enforced in
   *  firestore.rules on create (`promptIds.size() == 2`), not just here. */
  promptIds: string[]
  /** Position in the gathering's sequence. */
  order: number
  startedAt: number
  /**
   * Advisory only - purely a client-side countdown target, never compared
   * against anything in firestore.rules. DESIGN: "every phase needs a timeout
   * or a host override." A phase only ever actually ends on an explicit
   * host write (advancePhase in harvest.ts), so nothing security-relevant
   * depends on this number being accurate - unlike ROOM_CODE_WINDOW_MS, which
   * a rule enforces against the server's clock and which a 200ms skew broke
   * outright (see CLAUDE.md). A stale or skewed countdown here just displays
   * a few hundred ms off; the host's own tap is what moves the game forward.
   * Set on phase start to `now + HARVEST_WINDOW_MS`, and bumped by
   * `HARVEST_EXTEND_MS` on "give another minute" - see extendPhase().
   */
  phaseEndsAt: number
}

/** DESIGN: "Everyone submits two items to a prompt, ninety-second window." */
export const HARVEST_WINDOW_MS = 90_000

/** The host's "give it another minute" button adds this much to
 *  `GameDoc.phaseEndsAt`, any number of times - see extendPhase() in
 *  harvest.ts. Not a design measurement, just a round, guessable unit. */
export const HARVEST_EXTEND_MS = 60_000

/** Bounds an item's text, which is PUBLIC and rendered on every phone in the
 *  room the moment it is submitted - enforced both here (client maxLength)
 *  and in firestore.rules (a client is never trusted to enforce its own
 *  limit). Generous for a ninety-second answer, tight enough that one
 *  submission cannot dominate the round-loop screen. */
export const ITEM_TEXT_MAX_LENGTH = 300

/**
 * PUBLIC. Readable by everyone in the gathering, and therefore contains no
 * hint of who wrote it. The author lives in `ItemAuthorDoc`, in a sibling
 * collection the rules withhold until this item's `revealed` flips true.
 */
export interface ItemDoc {
  gameId: string
  text: string
  promptId: string
  /** Flipping this to true is what opens the matching ItemAuthorDoc for
   *  reading. Host-only write. */
  revealed: boolean
  createdAt: number
}

/**
 * PRIVATE until the matching item is revealed. Same document id as the item.
 *
 * This is the whole game: if the author's id travelled in the public item, a
 * player with devtools open would simply read the answer.
 *
 * `gameId`/`promptId` are carried here, not just on the item, because the
 * claim is written *before* the item exists (see ITEM_WRITE_ORDER) - the
 * rule enforcing the one-item-per-prompt cap (PromptSubmissionDoc, below)
 * needs somewhere to find them at that point.
 */
export interface ItemAuthorDoc {
  authorPlayerId: string
  gameId: string
  promptId: string
}

/**
 * **Write order matters, and the rules enforce it: the author claim comes
 * first.**
 *
 * To submit an item, generate one id and write `itemAuthors/{id}` naming
 * yourself, *then* write `items/{id}`. An item cannot be created unless a
 * matching author claim already exists and belongs to the caller.
 *
 * The reason is a hole the milestone-2 review demonstrated: with the item
 * written first, its id became publicly visible in a listable collection while
 * its authorship was still unclaimed, and any other player could claim it.
 * Claims are unlistable and first-write-wins, so a claim made before the item
 * exists cannot be observed or raced.
 *
 * **Two sequential writes, not a batch.** Firestore's `get()` in security
 * rules does not see a batch's own pending writes, so an item-create inside
 * the same batch as its claim is evaluated against a claim that does not yet
 * exist and is rejected. Verified against the emulator.
 *
 * **Ids must be unguessable, and must stay unpublished.** This is a security
 * requirement created by the ordering, not a convenience: a predictable - or
 * merely readable - id lets another player pre-claim it and permanently block
 * that submission, since claims cannot be updated and only the host can
 * delete one. Milestone 4 briefly broke this by storing the id in a
 * player-readable document (see PromptSubmissionDoc), which is why the slot
 * is now `get`-able by its own owner alone.
 *
 * **A retry continues the existing slot; only a first attempt mints an id.**
 * Before milestone 4 the rule was the opposite - a client that died between
 * the two writes left an orphan claim, and a retry had to generate a new id
 * because the old one could never be completed. The uid-keyed slot changed
 * that: it cannot be re-created, so a retry that minted a fresh id was denied
 * at the first write and the player was locked out of that prompt for good.
 * submitHarvestItem() therefore resumes from the slot's recorded item id.
 *
 * **Milestone 4 prepends a third write, for the same structural reason.**
 * Before either of the above, the client writes a PromptSubmissionDoc at
 * `sessions/{sessionId}/games/{gameId}/prompts/{promptId}/submissions/{uid}`.
 * That path's last segment is the caller's own uid, not a generated id - see
 * PromptSubmissionDoc for why that's what makes it safe against the
 * pre-claim-and-block attack ITEM_WRITE_ORDER's ids exist to prevent, in a
 * way a shared, first-write-wins slot could not be.
 */
export const ITEM_WRITE_ORDER =
  'promptSubmission, then itemAuthors, then items - sequential; a retry resumes the slot it already reserved' as const

/**
 * One player's reservation of one prompt slot within one game - this is what
 * "duplicate blocking" (MILESTONES.md, milestone 4) actually means: a player
 * may submit at most one item per prompt per game, structurally rather than
 * by a count a client could get wrong.
 *
 * **Document id is the player's own uid**, the same trick `PlayerDoc` uses:
 * firestore.rules requires the id to equal `request.auth.uid`, so - unlike
 * `itemAuthors`, where a random id makes first-write-wins the safe primitive
 * - nobody else can ever attempt to write this specific document at all.
 * A random or first-write-wins id here would reopen exactly the pre-claim
 * attack ITEM_WRITE_ORDER's ids were made unguessable to prevent: another
 * player could compute this deterministic path from a victim's public uid and
 * front-run it, permanently blocking that person's submission.
 *
 * `itemId` is chosen by the client and written here FIRST, before either of
 * the writes ITEM_WRITE_ORDER describes - see submitHarvestItem() in
 * harvest.ts. The rules cross-check it at both later steps, which is what
 * stops a slot being reserved once and then spent on a different item.
 *
 * **This document is the author mapping in a second form, so only its owner
 * may read it.** It pairs a uid with an item id, and `items` is readable by
 * every player - so a rule letting players list these slots hands out exactly
 * the answer key `itemAuthors` exists to withhold until the reveal, and
 * publishes the item id an attacker needs to pre-claim someone's submission.
 * The first version of the rule did precisely that; an independent review
 * found it on 2026-09-08. Anything added later that pairs a player with one
 * of their items has the same property and needs the same treatment.
 */
export interface PromptSubmissionDoc {
  itemId: string
  submittedAt: number
}

/** `skipped` is terminal, and only reachable from `preview` in practice - the
 *  host looked at the item and decided the room should not hear it. It is a
 *  phase rather than a deletion so the item is not drawn again. */
export type RoundPhase = 'preview' | 'voting' | 'revealed' | 'skipped'

export interface RoundDoc {
  gameId: string
  itemId: string
  /** `preview` is host-only: they see the item before anyone else so the skip
   *  button has something to act on. Voting opens after. */
  phase: RoundPhase
  order: number
  startedAt: number
  /**
   * What this round paid out, by player id - written once, after the reveal.
   *
   * The gathering's running total is the sum of these across every round
   * rather than a counter the host increments, which is what makes scoring
   * survive a half-finished reveal: re-running it recomputes the same totals
   * instead of paying twice. The rules allow this key to be written exactly
   * once (see firestore.rules, rounds update).
   */
  awarded?: Record<string, number>
}

/**
 * Ten rounds maximum, DESIGN's own number: "eleven people times two is
 * twenty-two items, which drags." The items that never get a round are not
 * wasted - they are kept as facts for future gatherings (milestone 7).
 */
export const MAX_ROUNDS = 10

/**
 * "Who said that" scoring, from DESIGN: "two points for each correct guess and
 * one point to the writer for everyone they fooled." Cumulative across the
 * gathering rather than per game, which is what gives the evening an arc.
 *
 * The author votes too, for someone else, so as not to give themselves away -
 * their own vote is simply never scored, in either direction.
 */
export const POINTS_FOR_CORRECT_GUESS = 2
export const POINTS_PER_FOOLED_VOTER = 1

/**
 * "Most likely to" has no correct answer, so DESIGN scores reading the room:
 * "whoever voted with the majority gets a point, which is on-thesis because
 * the game rewards familiarity with the group."
 *
 * Ties count as majorities. With eight people and three names splitting the
 * vote, declaring nobody right would make the most interesting rounds - the
 * ones the room genuinely disagrees about - the only unscored ones.
 */
export const POINTS_FOR_MAJORITY_VOTE = 1

/**
 * **Reveal order matters, and getting it backwards is exploitable.**
 *
 * Close the round first (`rounds/{roundId}.phase = 'revealed'`), and only then
 * open the author (`items/{itemId}.revealed = true`). Then read the votes and
 * the author, write what the round paid out onto the round, and recompute the
 * gathering's totals.
 *
 * The first version of this did the two writes the other way round, because
 * revealing the item is what makes `itemAuthors` readable and that felt like
 * step one. An independent review on 2026-09-14 found what the gap between
 * the two writes allows: for as long as it lasts, the author is public while
 * voting is still open, so any player watching the items listener can read
 * who wrote it and change their vote to match. Sub-second normally - and
 * indefinite if the second write fails or the host's phone suspends between
 * them. Reversed, the intermediate state is "voting closed, author still
 * hidden", which gives nothing away. The rules also refuse a vote once the
 * round's item is revealed, so the ordering is enforced rather than merely
 * intended.
 *
 * **Every step is conditional on its own state, so a re-tap resumes.** A
 * partial reveal used to be terminal: the item update requires
 * `revealed == false`, so once it had landed, retrying failed forever and the
 * round could never leave `voting` - with the only host control on screen
 * being the retry that could not work. Same shape as milestone 4's stranded
 * submission slot, same fix (see submitHarvestItem).
 */
export const ROUND_REVEAL_ORDER =
  'rounds.phase, then items.revealed, then read votes + author, then rounds.awarded, then sessions.scores - each step skipped if already done' as const

/**
 * PRIVATE until the round is revealed - the same problem as ItemAuthorDoc, and
 * solved by the same rule shape. Document id is the voting player's id, so a
 * player structurally cannot cast two votes in one round.
 */
export interface VoteDoc {
  votedForPlayerId: string
  castAt: number
}

// --- Collection paths -------------------------------------------------------
//
// Every Firestore path used by the client is built here. Nothing else should
// contain a collection-name string literal; a typo in a path is otherwise a
// silent read of an empty collection rather than an error.

export const paths = {
  user: (uid: string) => `users/${uid}`,

  contacts: (uid: string) => `users/${uid}/contacts`,
  contact: (uid: string, contactId: string) => `users/${uid}/contacts/${contactId}`,
  contactFacts: (uid: string, contactId: string) =>
    `users/${uid}/contacts/${contactId}/facts`,

  groups: (uid: string) => `users/${uid}/groups`,
  group: (uid: string, groupId: string) => `users/${uid}/groups/${groupId}`,
  groupFacts: (uid: string, groupId: string) => `users/${uid}/groups/${groupId}/facts`,

  sessions: () => `sessions`,
  session: (sessionId: string) => `sessions/${sessionId}`,

  roomCodes: () => `roomCodes`,
  roomCode: (code: string) => `roomCodes/${code}`,

  players: (sessionId: string) => `sessions/${sessionId}/players`,
  player: (sessionId: string, playerId: string) =>
    `sessions/${sessionId}/players/${playerId}`,

  games: (sessionId: string) => `sessions/${sessionId}/games`,
  game: (sessionId: string, gameId: string) => `sessions/${sessionId}/games/${gameId}`,

  // No collection-level helper on purpose: these slots are `get`-only to
  // their own owner, so a path meant for listing them is a path nothing may
  // legally use.
  promptSubmission: (sessionId: string, gameId: string, promptId: string, uid: string) =>
    `sessions/${sessionId}/games/${gameId}/prompts/${promptId}/submissions/${uid}`,

  items: (sessionId: string) => `sessions/${sessionId}/items`,
  item: (sessionId: string, itemId: string) => `sessions/${sessionId}/items/${itemId}`,

  itemAuthors: (sessionId: string) => `sessions/${sessionId}/itemAuthors`,
  itemAuthor: (sessionId: string, itemId: string) =>
    `sessions/${sessionId}/itemAuthors/${itemId}`,

  rounds: (sessionId: string) => `sessions/${sessionId}/rounds`,
  round: (sessionId: string, roundId: string) =>
    `sessions/${sessionId}/rounds/${roundId}`,

  votes: (sessionId: string, roundId: string) =>
    `sessions/${sessionId}/rounds/${roundId}/votes`,
  vote: (sessionId: string, roundId: string, playerId: string) =>
    `sessions/${sessionId}/rounds/${roundId}/votes/${playerId}`,
} as const
