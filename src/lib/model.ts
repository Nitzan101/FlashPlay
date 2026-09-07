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
}

export type GameType = 'who-said-that' | 'most-likely-to'
export type GamePhase = 'harvesting' | 'rounds' | 'done'

export interface GameDoc {
  type: GameType
  phase: GamePhase
  /** Everyone answers the same prompts, or the room cannot tell which question
   *  the item being read out is answering. Two per gathering. */
  promptIds: string[]
  /** Position in the gathering's sequence. */
  order: number
  startedAt: number
}

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
 */
export interface ItemAuthorDoc {
  authorPlayerId: string
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
 * **Ids must be unguessable, and a retry must use a fresh one.** Both are
 * security requirements created by this ordering, not conveniences. A
 * predictable id lets another player pre-claim it and permanently block that
 * submission (claims cannot be updated, and only the host can delete one). And
 * a client that dies between the two writes leaves an orphan claim: retrying
 * with the same id can never succeed, so generate a new one.
 */
export const ITEM_WRITE_ORDER = 'itemAuthors before items, sequential, fresh id per attempt' as const

export type RoundPhase = 'preview' | 'voting' | 'revealed'

export interface RoundDoc {
  gameId: string
  itemId: string
  /** `preview` is host-only: they see the item before anyone else so the skip
   *  button has something to act on. Voting opens after. */
  phase: RoundPhase
  order: number
  startedAt: number
}

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
