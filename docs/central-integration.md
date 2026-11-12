# Central registry and result ingestion (event-results/1)

The booth can verify official players against the **main application's
participant registry** and send every completed attempt to it as **raw
points**. This sits alongside the LAN score feed (`danceoff.scorefeed` v1),
which keeps working unchanged.

It is **off by default**. Nothing is sent and no player is looked up until an
operator switches it on and enters a server, a source credential and a scope.

## What happens at the booth

1. Before a game, the operator types each player's **player number** in the
   operator console under **Central registry → Players for the next game**.
2. The booth asks the registry who that is and shows the **display name and
   participant id**. The operator checks with the person in front of them and
   presses **Confirm** (or **Not them**). Only confirmed players are official.
   Each slot is resolved on its own; one participant cannot be Player 1 and
   Player 2 at once unless the manifest's `config.allowSameParticipantMultipleSlots`
   is `true`.
3. The participant screen pre-fills the confirmed names on the name screen.
   It never sees participant ids, codes or anything else from the registry.
   **A typed name never creates or chooses a central identity.**
4. When the song ends with judged moves on the live camera, the booth creates
   **one result per player** (new UUID `resultId`, `revision` 1, integer
   `points`, the configured competition, round, game and scoring version) and
   puts the outgoing message in a durable queue **in the same write**.
5. **Play again** keeps the confirmed players for the next attempt.
   **Next player** (finishing at the results screen, returning to attract)
   clears them.

Attempts by players who were not confirmed are kept on the booth as
**unresolved** and are never sent. An operator can later press **Assign
player…** on the result and enter the right code; it is then sent as
revision 1. Demo/replay sessions and sessions with no judged moves are never
recorded, the same as for the leaderboard.

## Points, never percentages

`points` is the integer total the scoring engine produced
(`scoringVersion` `danceoff-points-v3`: per judged move, 10 for a match, 4
for a close match, 0 otherwise, with no points for just moving; see
[decision 0007](decisions/0007-fair-scoring.md)). The main application must
list `danceoff-points-v3` among the game's approved scoring versions; v2
results (which gave 5 for close and 2 for moving) must not be mixed with v3 in
one round. The booth warns when the
selected scoring version is not the one it scores with. The booth no longer shows percentages anywhere on
screen either; the leaderboard ranks by points (ties: earliest wins).

## Setting it up

All settings are in the operator console, panel **Central registry (main
application)**.

| Setting | Meaning |
| --- | --- |
| Enable | Master switch. Off = no network calls, no recording. |
| Server URL | Base URL of the main application, e.g. `https://results.example.com`. Must be `https://`. |
| Trusted LAN (allow http://) | Allows `http://` for a server on a closed event network. Leave off on any shared network. |
| Source id | The id the main application issued to this booth (e.g. `booth-lagos-1`). |
| Game id | `danceoff` unless the main application says otherwise. |
| Source credential | Bearer credential for this source. Write-only: it is encrypted with Windows DPAPI (Electron `safeStorage`) in the main process and never shown again or sent to any screen. Paste a new one to replace it. |
| Test connection | Fetches the competition manifest with the credential and reports what it found. |
| Competition | The competition id. The manifest is fetched for it. |
| Round | Chosen from the manifest's rounds. Results are tied to the round that was set **when the attempt finished**; changing it later never moves queued results. |
| Scoring version | Chosen from the versions the manifest approves for the game. |
| When offline | **Accept players verified earlier** (default) or **Online verification only**. See below. |

Warnings appear in the panel when the round or scoring version is not in the
latest manifest, the game is not enabled, the credential was rejected, the
scope is not set (nothing is recorded then), or OS encryption is unavailable.
The booth never "fixes" scope by itself.

Advanced settings (edit `central/central-config.json` in the app's user-data
folder while the app is closed): `reconcilePath` (default
`/api/v1/sources/{sourceId}/reconciliation`), `reconcileEveryMin` (default 30,
0 = only on demand and on reconnect), `retentionDays` (default 180).

## Offline behaviour

* **Lookups:** if the registry cannot be reached and the policy allows it, a
  code that was **verified on this booth before** (same competition) is
  accepted from the local cache, marked "verified from offline cache" with
  the time it was retrieved. Unknown codes never work offline and never
  create an identity. With **Online verification only**, nothing is accepted
  offline.
* **Results:** completed attempts are queued on disk and sent when the
  server is back, oldest first, with exponential backoff (2 s doubling, at
  most 5 minutes, ±50 % jitter) and the server's `Retry-After` respected.
  A restart loses nothing; the `sourceSequence` counter is persisted and
  never reused.

## Delivery rules

| Server answer | What the booth does |
| --- | --- |
| 2xx with a matching acknowledgement, `outcome` `accepted`, `duplicate` or `stale` | Delivered. `duplicate` (already had it) and `stale` (a newer revision is already stored) are success. |
| 2xx whose acknowledgement does not match the message | Treated as not delivered; retried. |
| Network error, timeout, 408, 425, 429, 5xx | Retried later with backoff, **byte-identical** (same `messageId`, same body). |
| 401 / 403 | Sending pauses (no retry storm). Panel shows "Credential rejected". Resumes when a new credential is saved or **Retry blocked** is pressed. |
| Other 4xx (400, 404, 409, 422…) | The message is **blocked**: kept, shown in the panel with the server's reason, logged; the next messages continue. **Retry** (on the row, or **Retry blocked**) sends it again unchanged after the cause is fixed. A 409 is also listed under conflicts. |

## Corrections and voids

On a delivered or queued result, **Correct…** (new points) or **Void** create
a **new revision** of the same `resultId` with everything else unchanged
(participant, competition, round, game, session). Revisions are sent in
order. Identity on a queued result is never changed; an unresolved result
gets its participant only through **Assign player…**.

## Reconciliation

Runs every `reconcileEveryMin` minutes, when the connection comes back, and on
**Reconcile now**. The booth sends its inventory (the latest revision and
content hash of every result it has submitted) in pages of 200. For each
result the server reports as missing or older, the booth re-queues that
result's latest revision through the normal, idempotent ingestion endpoint.
Results where the server holds different content are listed under
**Conflicts** for a person to review. **Absence on the server never voids or
deletes anything on the booth.** A run only counts as complete when the server
confirms `complete: true` on the final page.

The contract leaves the reconciliation wire format to the integrator. The
booth uses this one; agree it with the main application team (or change
`reconcilePath`):

```http
POST {reconcilePath}            Authorization: Bearer <source credential>
{
  "protocol": "event-results", "version": 1,
  "sourceId": "booth-lagos-1",
  "runId": "<uuid, same for every page of a run>",
  "page": 0, "pageSize": 200, "final": false,
  "items": [ { "resultId": "<uuid>", "revision": 2, "contentHash": "<sha256 hex>" } ]
}

200
{
  "runId": "<same uuid>",
  "missing": ["<resultId>", …],
  "conflicts": [ { "resultId": "<uuid>", "centralRevision": 3, "centralContentHash": "<hex>" } ],
  "complete": true            // required on the final page
}
```

**Canonical JSON and content hash.** `contentHash` is the lowercase hex
SHA-256 of the UTF-8 canonical JSON of the `result` object: object keys
sorted by UTF-16 code unit order at every level, no whitespace, strings and
numbers exactly as `JSON.stringify` writes them, `undefined` members left out,
arrays kept in order (implementation: `apps/desktop/src/main/central/canonical.ts`).

## Messages sent

```json
{
  "protocol": "event-results", "version": 1,
  "messageId": "<uuid>", "sourceId": "booth-lagos-1", "sourceSequence": 42,
  "sentAt": "2026-11-03T10:15:02.120Z",
  "result": {
    "resultId": "<uuid>", "revision": 1,
    "competitionId": "comp-2026", "roundId": "heats", "gameId": "danceoff",
    "participantId": "p-123", "localPlayerId": "<booth player id>",
    "sessionId": "local-session-18-3f2a9c1b",
    "completedAt": "2026-11-03T10:15:01.000Z",
    "status": "valid", "points": 1234, "scoringVersion": "danceoff-points-v3",
    "metadata": { "routineId": "unlock-me", "mode": "duo", "slot": 1, "legacyRecordId": "<recordId>" }
  }
}
```

`sentAt` is when the message was created; retries resend the identical bytes,
so it does not change between attempts.

## Link with the LAN score feed

`danceoff.scorefeed` v1 is unchanged. Each central result stores the legacy
`recordId` and player `uid` it came from (also sent as
`metadata.legacyRecordId` and `localPlayerId`), so the main application can
match results it may have imported from the old feed.

## Where the data lives

In the app's user-data folder, `central/`:

| File | Content |
| --- | --- |
| `central-config.json` | The settings above (no credential). |
| `central-credential.bin` | The credential, encrypted with DPAPI. If encryption is unavailable it is stored readable only by the Windows account and a warning is shown. |
| `central-store.json` (+ `.bak`) | Result history and revisions, the outgoing queue, the sequence counter, the cached manifest, verified participants (id, display name, status, and a SHA-256 **hash** of their code, never the code itself), last acknowledgement and reconciliation, conflicts. Replaced atomically on every change (write, fsync, rename); the previous version is kept as `.bak`. |

`schemaVersion` in the store is migrated forward on start; a store written by
a newer app version is refused rather than damaged. Delivered results are
removed after `retentionDays`; pending, blocked and unresolved ones are never
pruned.

## Tests

`apps/desktop/src/main/central/service.test.ts` runs the service against an
in-process fake of the main application (`fake-server.ts`): player number
parsing, confirmation, unknown/inactive codes, duplicate slots, play again vs
next player, offline cache and policy, one result per participant with raw
integer points, atomic result + outbox, sequence persistence across
restarts, unresolved sessions, ordering, Bearer auth, ack validation,
byte-identical retries, backoff and `Retry-After`, 5-minute cap,
duplicate/stale acks, auth pause and resume, blocked messages, corrections and
voids, reconciliation (missing, conflicts, incomplete, paging), store
migration, backup recovery, pruning, credential never on disk in plain text
or in renderer status. Run with `pnpm test`.
