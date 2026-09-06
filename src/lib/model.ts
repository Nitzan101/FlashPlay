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
  /** The short code that joins a phone to this gathering. */
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
  /** An abandoned gathering must not hold its room code forever. */
  expiresAt: number
}

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
