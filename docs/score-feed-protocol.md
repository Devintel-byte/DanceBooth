# Score feed (danceoff.scorefeed v1) and the main leaderboard

The booth serves a small, **read-only score feed** on the local network. The
event's **main leaderboard** (LeaderboardHQ) connects *to* the booth and
receives every completed session; it also sends down the event's **player
list**, so the booth recognises player numbers. The booth never needs to know the
main leaderboard's address. Other scoreboards can use the same feed.

> The booth can also send results to a central registry (contract
> event-results/1). That is a separate channel; see
> [central-integration.md](central-integration.md).

## Setting it up (operator)

Operator console → **Main leaderboard connection**.

1. **Enable feed** is on by default. **Port** `8787` and **Booth id** `booth-1`
   for DanceHall (B-Quick uses `booth-2` / `8788`). Each booth needs its own id.
2. In the box **Enter this on the main leaderboard**:
   * **Address**: `IP:port`, one line per network address of this PC, each with
     **Copy**. Type it into the main leaderboard's **Admin → Booths → Add a booth**.
   * **Shared key**: hidden; **Show** displays it, **Copy** puts it on the
     clipboard, **New key** creates a new one (the main leaderboard must then be
     updated with it).
3. If the main leaderboard cannot connect, open **Allow the port through Windows
   Firewall**, copy the command and run it once in an **Administrator
   PowerShell**:

   ```text
   netsh advfirewall firewall add rule name="Booth score feed" dir=in action=allow protocol=TCP localport=8787 profile=private
   ```

   The Wi-Fi or cable network must be set to **Private** in Windows (Settings →
   Network & internet → your network → Private network).

The **status bar** at the top of the console always shows one of: **Off**,
**Waiting for the main leaderboard** (amber), **Connected to the main
leaderboard (IP)** (green) or **Problem: …** (red, for example "Port 8787 is
already in use"), plus when the last session was sent. Short notices pop up
when the main leaderboard connects or disconnects, when a connection with a
wrong key is refused (with its IP), when the feed cannot start, and when a new
key is created. The **Connection log** keeps the last 100 entries (also in the
app's log file); **Copy log** copies them.

The key stays in the booth's main process. The console receives it only when
the operator clicks **Show**; **Copy** copies it without showing it. It is
never logged. Traffic is plain `ws://` / `http://` without TLS, so use a
private event network.

## Endpoints

| Method | Path | Auth | Returns |
| --- | --- | --- | --- |
| WebSocket | `/v1/stream?key=<sharedKey>` (also `Authorization: Bearer <key>`) | key | the event stream |
| GET | `/v1/snapshot` | `Authorization: Bearer <key>` | one `snapshot` envelope |
| GET | `/v1/health` | none | `{ "ok": true, "protocol": "danceoff.scorefeed", "version": 1, "boothId": "booth-1" }` |

* A wrong or missing key gets HTTP **401** (WebSocket: the upgrade is refused
  with 401). Keys are compared in constant time.
* At most 8 simultaneous connections; beyond that **503**.
* The main leaderboard adds `client=leaderboardhq` to its stream URL; it is
  then shown as "Main leaderboard", other clients as "scoreboard".
* Inbound messages are capped at 4 KB, except on the main leaderboard's
  connection, which carries the full player list (2 MB cap).

## Messages

Every message is an envelope:

```json
{ "protocol": "danceoff.scorefeed", "version": 1, "type": "session.completed",
  "boothId": "booth-1", "eventId": "maltina", "seq": 42,
  "sentAt": "2026-11-04T18:00:02.120Z", "data": { } }
```

`seq` increases by 1 for every message the booth sends (it restarts when the
app restarts).

| type | When | data |
| --- | --- | --- |
| `hello` | right after a client connects | `{ "protocol": "danceoff.scorefeed", "version": 1, "capabilities": ["registry"] }` |
| `snapshot` | right after `hello`, after `{"type":"resync"}`, and for `GET /v1/snapshot` | `{ "records": [record, …] }`: every completed session of the current event and day, oldest first. Other scoreboards also get `leaderboard` (the booth's own board). |
| `session.completed` | the moment a session finishes | one record |
| `heartbeat` | every 15 s | `{ "clients": <n> }` |
| `pong` | reply to `{"type":"ping"}` | `{}` |
| `error` | reply to anything else | `{ "message": "…" }` |
| `leaderboard.updated` | other scoreboards only, after each session | the booth's own board |

Clients may send only `{"type":"resync"}`, `{"type":"ping"}` and
`{"type":"registry", …}` (below). The feed is read-only.

### Record

```json
{
  "recordId": "1b6f0d1e-6a1f-4bd7-9d1c-2a8e9b2d3c4f",
  "at": "2026-11-04T18:00:01.000Z",
  "sessionId": 12,
  "players": [
    { "uid": "booth-1:maltina:player-014", "playerId": "player-014",
      "name": "Tolu Adeyemi", "code": "0377", "slot": 1, "points": 2060 },
    { "uid": "booth-1:maltina:player-015", "playerId": "player-015",
      "name": "Femi", "slot": 2, "points": 1840 }
  ]
}
```

* `points`: whole, non-negative integer (scoring `danceoff-points-v3`: 10 per
  matched move, 4 per close match); higher is better.
* `code`: the player's 4-digit **player number** as text (`"0377"`: leading
  zeros kept), only for players who typed one, also when it was not in the
  booth's player list. Players without a number are guests.
* `name`: the registered name for a recognised number, otherwise the name as
  entered. If names are cleared at the booth (**Clear leaderboard names**),
  `name` is left out but `uid` and `recordId` stay the same.
* `uid`: `<boothId>:<eventId>:<playerId>`, stable for that player.
* `recordId`: created once when the session is stored; identical every time
  the session is re-sent (live, snapshot, resync, after a restart).
* Only completed live (camera) sessions are sent: never demo/replay, aborted,
  errored or unreadable runs. A player nothing could be judged for is left out.
* Extra fields (`matchPercent`, `judgedMoves`, `unreadableMoves`, `routineId`,
  `routineTitle`, `mode`, `difficulty`, `durationSec`) are informational.

### Player list (main leaderboard → booth)

Because `hello` lists the `registry` capability, the main leaderboard sends the
event's registered players on the same connection, right after connecting and
again within a few seconds of any change at the registration desk:

```json
{ "type": "registry", "data": {
    "competitionId": "maltina_2026", "title": "Maltina Arcade Night", "revision": "…",
    "sentAt": "2026-11-04T17:58:00Z",
    "players": [ { "code": "0377", "name": "Tolu Adeyemi" } ] } }
```

`code` is the 4-digit player number; entries that are not exactly 4 digits
are skipped, and `ref` is ignored. Each message is the full list and replaces
the booth's copy, which is saved to disk (`feed/player-list.json` in the app's
data folder) so numbers still work after a restart or while the network is
down. The booth does not answer it. Numbers are never logged, and the list
never leaves the main process: the participant screen can only look up the
one number that was typed.

## Player entry at the booth

Each player types an optional **player number** (4 digits, printed on their
card by the registration desk), then a name. There is no QR code, camera or
scanner.

* One short field, **Player number (optional)**: digits only, at most 4
  (spaces and dashes ignored). The number is looked up as soon as 4 digits are
  typed.
* **Known number**: the registered name is filled in and locked, with
  "✓ Tolu Adeyemi · competing for the prize".
* **Unknown number**: "Number not recognised. Check it, or play as a guest."
  The player can fix it or continue with a typed name; the number is still
  sent (the main leaderboard may know it).
* **No number**: the player types a name and plays as a guest.

A 4-digit number is easy to mistype, so the operator console shows the number
and the matching name while it is entered ("Player 1 · number 0377 is Tolu
Adeyemi. Check the name with the player before starting.").

Player numbers are **never shown on the public screen or the leaderboard**:
the participant screen shows the digits as dots, and the boards show names
only (with a small **Guest** tag for players without a number). The player's
number is stored with their sessions, so a snapshot re-sends it.

The operator console shows the list's state under **Player list**:
"214 registered players (Maltina Arcade Night), updated 12:03", or "No player
list yet; player numbers will be checked by the main leaderboard."

## Checks

Automated (`pnpm test`, `apps/desktop/src/main/score-feed.test.ts` and
`player-list.test.ts`; `pnpm test:e2e`): 401 on a wrong key (HTTP and
WebSocket), bearer key on the stream, `hello` with `capabilities` and
`snapshot` on connect, `session.completed`, `seq` +1 per message, `resync`,
`ping`/`pong`, `error` for non-JSON and unknown messages, a `registry` message
replacing and persisting the list (over 4 KB), 4 KB cap for other clients, 503
over the limit, health without the key, record shape (`code` the 4-digit
number as text with leading zeros, only for numbered players; integer
`points`; `recordId`/`uid` stable after a restart; demo, aborted and
unreadable runs never sent), player numbers (0377 ≠ 377, letters ignored, at
most 4 digits; known → registered name locked, unknown → warning and still
sent, none → guest; never shown as text on the public screen; shown to the
operator), the operator status bar, and the key never reaching a renderer
unless shown.

Manual, at the event:

1. On the main leaderboard PC: **Admin → Booths → Test connection** with this
   booth's `IP:port` and key. It must say *Connected. Booth "booth-1" has N
   session(s) ready to import*. Then **Add booth**; this booth's status bar
   turns green: **Connected to the main leaderboard**.
2. Register a test player at the main leaderboard's desk. Within about 3 s
   their player number works at the booth and shows their name (Player list
   count goes up). Play a session with it: on the main board they appear
   ranked; a name-only player appears under "Playing for fun".
3. Pull the network cable or turn off Wi-Fi for 30 s, then reconnect. Both
   sides show the disconnect and recover by themselves; no session is counted
   twice (the main leaderboard keys on `recordId`).
