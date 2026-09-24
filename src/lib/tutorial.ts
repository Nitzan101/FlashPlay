/**
 * The two halves of the in-app help (asked for 2026-09-23): "how to play", a
 * few rule cards with a small demo each, and a per-screen tour that spotlights
 * the real controls one by one. Both open on their own the first time, and
 * again from the "?" button.
 *
 * "Already seen" is remembered per device in localStorage - a convenience, not
 * data anyone else needs, and a guest's anonymous account is new every
 * gathering anyway. Every access is wrapped: private browsing or blocked
 * storage must mean "show it again", never a crash.
 */

export type TourId = 'welcome' | 'home' | 'group' | 'person' | 'lobbyHost' | 'lobbyGuest'

/** One stop: the element carrying `data-tour={target}`, and the key of its
 *  title/body under `tour.<tourId>.<key>` in i18n. A stop whose element is not
 *  on screen when the tour starts is left out (a group's details button when
 *  there are no groups yet), rather than pointing at nothing. */
export interface TourStep {
  target: string
  key: string
}

export const TOURS: Record<TourId, TourStep[]> = {
  welcome: [
    { target: 'sign-in', key: 'signIn' },
    { target: 'join-code', key: 'joinCode' },
  ],
  home: [
    { target: 'room-picker', key: 'roomPicker' },
    { target: 'group-details', key: 'groupDetails' },
    { target: 'add-group', key: 'addGroup' },
    { target: 'open-room', key: 'openRoom' },
    { target: 'edit-profile', key: 'editProfile' },
    { target: 'edit-questions', key: 'editQuestions' },
    { target: 'join-code', key: 'joinCode' },
  ],
  group: [
    { target: 'rename-group', key: 'rename' },
    { target: 'group-open-room', key: 'openRoom' },
    { target: 'member-row', key: 'members' },
    { target: 'add-member', key: 'addMember' },
    { target: 'group-facts', key: 'groupFacts' },
    { target: 'share-group', key: 'share' },
    { target: 'wipe-info', key: 'wipe' },
  ],
  person: [
    { target: 'person-facts', key: 'facts' },
    { target: 'person-questions', key: 'questions' },
    { target: 'back-to-group', key: 'back' },
  ],
  lobbyHost: [
    { target: 'room-code', key: 'roomCode' },
    { target: 'share-link', key: 'shareLink' },
    { target: 'roster', key: 'roster' },
    { target: 'link-players', key: 'linkPlayers' },
    { target: 'guided-questions', key: 'guided' },
    { target: 'start-game', key: 'startGame' },
    { target: 'leave-room', key: 'leave' },
  ],
  lobbyGuest: [
    { target: 'roster', key: 'roster' },
    { target: 'guided-questions', key: 'guided' },
    { target: 'leave-room', key: 'leave' },
  ],
}

const PREFIX = 'flashplay.tutorial.'
export const HOW_TO_PLAY_KEY = `${PREFIX}howToPlay`
export const tourSeenKey = (id: TourId) => `${PREFIX}tour.${id}`

/** Every key this file writes - for a test setup that wants none of it to
 *  open on its own. */
export const ALL_TUTORIAL_KEYS = [
  HOW_TO_PLAY_KEY,
  ...(Object.keys(TOURS) as TourId[]).map(tourSeenKey),
]

export function hasSeen(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'seen'
  } catch {
    return false
  }
}

export function markSeen(key: string): void {
  try {
    localStorage.setItem(key, 'seen')
  } catch {
    // Storage blocked: it simply opens again next time.
  }
}
