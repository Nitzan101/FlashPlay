# Real-evening test checklist

Prepared 2026-10-07. Everything below has passed in tests and in a laptop browser
only. This evening is the first run of the whole app with real people and
phones since the first play session on 2026-09-16. Milestone gates it covers:
3 (timed multi-device run), 4 (a device killed mid-harvest), 5-6 (a full
evening), and the unverified items in `open-items.md`.

Share the canonical link only: `https://flashplay-50bde.firebaseapp.com`.

## Before people arrive

- 5 or more people if possible (the third game needs at least 3 who answered
  the lobby choice questions, `MIN_LOBBY_ANSWERERS`).
- A mix of devices: at least one iPhone, one Android, and one guest who opens
  the link from inside WhatsApp (the in-app browser) and one from a normal
  browser.
- The host signs in with Google on their own phone. iOS host sign-in is
  confirmed; Android host sign-in is not, so if anyone hosts from Android, that
  is a test in itself.
- One person writes things down (below) or takes screenshots. Errors on screen
  show a technical code under the friendly message: photograph it.

## Run, in this order

1. Host signs in, opens a room, shares the link to the WhatsApp group.
2. Each guest joins from the link. Note: does the name hint make sense? Does
   anyone type a nickname nobody recognises?
3. Lobby: everyone answers some guided questions, including the choice ones
   (the third game feeds on those). Ask two guests to try "sign in to be
   remembered" (one iPhone, one Android). Note whether it completes and whether
   the person is still shown as themselves afterwards.
4. Game 1 ("who said that"): the answer round, then voting and reveals. During
   the answer window, lock one phone's screen for about 20 seconds and unlock
   it. Kill one phone's browser mid-round, reopen the link, and see whether the
   person returns to the same screen.
5. Game 2 ("most likely to"): rounds run, question reads naturally.
6. Between games: the choice screen shows whether "who answered what" is
   available. Pick it.
7. Game 3 ("who answered what"): answering, guessing, reveal. Note the host
   screen's "not decided yet" names if anyone is slow.
8. Finale: scoreboard, feedback, saving the group.
9. Afterwards, the host opens the saved group: the facts from tonight are there.

## What to record

| Question | Where it comes from |
|---|---|
| Did every guest get in from the link, on every device type? | step 2 |
| Any error text on screen (with its code)? | any step |
| Guest sign-in: completed? still recognised? | step 3 |
| Did the killed or locked phone come back correctly? | step 4 |
| Total time for the evening, and per game | all |
| Game 3: how many rounds were played, how many felt dead (nearly everyone answered the same, or nearly no one)? | step 7 |
| Game 3: did anyone get left out of a round because their phone was asleep? | step 7 |
| Did the points feel balanced across the three games? (8 per correct guess, 4 per majority vote, 1 per classified person) | finale |
| Where did people ask "what do I do now?" | all |
| What did people laugh at, and what did they skip? | all |

## What the results decide

- Dead rounds or lopsided picks in game 3: the selection policy
  (`selectWhoAnsweredWhatRound`, 1-in-5 lopsided) is the place to tune.
- A phone that dropped out of game 3: the host-sees-who-is-undecided line is
  not enough, and the markers need a different answer.
- Guest sign-in not completing in an embedded browser: the "open in a browser"
  note needs a real test and possibly a different offer.
- Identical answers hurting game 1: that is the parked "pick up to two" change.
- Nothing broke and people liked it: choose the next game from what they asked
  for, not from the backlog.
