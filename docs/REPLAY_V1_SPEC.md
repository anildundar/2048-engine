# Replay Schema V1 Specification — 2048: Championship Edition

**Date:** 2026-09-09  
**Version:** 1  
**Status:** CANONICAL REPLAY FOUNDATION GATE 1 (FINAL SEMANTIC INTEGRITY LOCKED)

---

## 1. Overview & Principles

Championship Replay V1 records lightweight, deterministic gameplay action and state progression data rather than raw screen video.

Key Principles:
1. **Deterministic Action + Explicit Spawn Model (Contract B):** Replay events record the player input direction and the explicit resulting tile spawn (`index + value`). Spawns captured in events are authoritative for playback. The replay payload does NOT require or assume deterministic client PRNG reconstruction during playback.
2. **Periodic Checkpoints & Seeking (Option 1: Replay From Start):** Every 50 state-changing moves (`DEFAULT_CHECKPOINT_CADENCE = 50`), a compact snapshot (board array, score, highestTile, competitiveClass, and SHA-256 board hash) is captured. When seeking to an arbitrary move index, the canonical player simulates from start (`SEEK_STRATEGY = 'REPLAY_FROM_START'`), guaranteeing 100% semantic fidelity across Undos, branched paths, and timer stages.
3. **Full-State Undo Restoration:** Replay Undo restores the exact prior snapshot (board, score, moveIndex, timer, highestTile, and competitiveClass). Checkpoints recorded after the restored point are pruned from the active timeline to preserve monotonic ordering.
4. **Adaptive Per-Move Timer Parity (10s → 3s):** Replay playback mirrors mobile runtime's adaptive timer:
   - Initial base: 10,000ms (10s)
   - Highest tile stage:
     - 2–64: 10,000ms (10s)
     - 128: 9,000ms (9s)
     - 256: 8,000ms (8s)
     - 512: 7,000ms (7s)
     - 1024: 6,000ms (6s)
     - 2048: 5,000ms (5s)
     - 4096: 4,000ms (4s)
     - 8192+: 3,000ms (3s floor)
   - `highestTileEver` is strictly monotonic (cannot decrease even on Undo).
   - Valid moves reset remaining time to the active stage base. No-op moves do NOT reset remaining time.
5. **Canonical Time Boost Semantics:**
   - Adds canonical `+5 seconds` (5,000ms).
   - Hard cap: `min(stageBase + 5,000ms, currentRemaining + 5,000ms)`.
   - Never resurrects an expired timer (`remainingMs <= 0` cannot be boosted).
   - Transitions competitive class to `ASSISTED`.
6. **Pause / Resume Timing:**
   - Pause freezes timer progression.
   - Resume records pause duration and resumes timer countdown from frozen value.
7. **Single Canonical Pure Reducer:** All playback execution paths (both offline verification via `playReplayV1` and interactive scrubbing via `createReplayPlayerV1`) evaluate state exclusively through `applyReplayEventV1(current, event, history)`.
8. **Failure Domain Separation:** Replay capture, serialization, or storage failure must NEVER impede active gameplay, run finalization, progression, or ranked score submission.
9. **Rank Authority Invariant:** Replay is an observational and presentation record, NOT a cryptographic client anti-cheat proof (`REPLAY_HASH_IS_CRYPTOGRAPHIC_RANK_PROOF = NO`).

---

## 2. Replay V1 Contract Structure

```typescript
export interface ReplayV1 {
  replaySchemaVersion: 1;
  engineVersion: string; // "1.0.0"
  rulesetVersion: string; // "classic-v1"
  runId: string;
  seed: number;
  mode: string;
  competitiveClassAtStart: 'PURE' | 'ASSISTED';
  startedAt: number;
  initialBoard: number[]; // 16 elements
  events: ReplayEventV1[];
  checkpoints: ReplayCheckpointV1[];
  finalSummary: ReplayFinalSummaryV1;
}
```

---

## 3. Fail-Closed Version & Payload Validation Policy

`validateReplayV1()` strictly validates versions and payload safety:
- `replaySchemaVersion`: must equal `1` (`UNSUPPORTED_SCHEMA_VERSION`).
- `engineVersion`: must match supported engine versions, currently `'1.0.0'` (`UNSUPPORTED_ENGINE_VERSION`).
- `rulesetVersion`: must match supported rulesets, currently `'classic-v1'` (`UNSUPPORTED_RULESET_VERSION`).
- Board hashes in checkpoints and final summary must strictly match 64-character lowercase/uppercase hex format (`/^[0-9a-fA-F]{64}$/`).
- `TIME_BOOST` and `RESCUE_TIMEOUT` must specify canonical `addedSeconds === 5`.
- Time deltas `dt >= 0` and pause durations `pauseDurationMs >= 0`.
- Payload sizes are capped by centralized limits:
  - `MAX_REPLAY_EVENTS_LIMIT = 50_000`
  - `MAX_REPLAY_CHECKPOINTS_LIMIT = 2_000`
  - `MAX_REPLAY_SERIALIZED_BYTES_LIMIT = 1_500_000` (1.5MB)

Future rulesets or engine versions must provide explicit adapters before playback rather than silently running unknown semantics.

---

## 4. Event Vocabulary & Semantics

| Event Type | Purpose | Semantics & Payload Fields |
| :--- | :--- | :--- |
| `RUN_START` | Identifies run start relative origin | `t: 0` |
| `MOVE` | Directional swipe & resulting spawn | `t, dt, direction, spawn: { index, value } \| null, scoreDelta` |
| `PAUSE` | Game pause marker | `t`, sets playback `isPaused = true` |
| `RESUME` | Game resume marker | `t, pauseDurationMs`, sets playback `isPaused = false` |
| `TIME_BOOST` | Time extension boost applied | `t, addedSeconds` (canonical 5s), caps at `min(stageBase + 5s, cur + 5s)`, transitions to `ASSISTED` |
| `ASSISTED_TRANSITION` | Explicit transition to Assisted | `t, reason`, transitions playback `competitiveClass` to `ASSISTED` |
| `RESCUE_TIMEOUT` | Continuation upon timer expiration | `t, addedSeconds` (5s), restores active timer, increments `timeBoostsUsed`, transitions to `ASSISTED` |
| `RESCUE_UNDO` | Continuation upon no-moves state | `t`, restores prior snapshot, increments `undosUsed`, transitions to `ASSISTED` |
| `UNDO` | Undo boost executed | `t, restoredMoveIndex, restoredScore, restoredBoard?`, restores full snapshot |
| `RUN_TERMINAL` | Final run completion | `t, reason, finalScore, finalHighestTile, totalMoves`, sets terminal status |

---

## 5. Checkpoint & Hash Strategy

- **Algorithm Source Truth:** Pure TypeScript standard FIPS 180-4 SHA-256 (`src/hash.ts` -> `sha256`).
- **Board Hash:** `computeBoardHash(board, score, moveIndex, highestTile)` produces a 64-character lowercase hexadecimal hash.
- **Desync Detection:** Validates periodic checkpoints and final summary integrity. Any divergence produces a typed mismatch error (`CHECKPOINT_MISMATCH`, `FINAL_BOARD_MISMATCH`, `FINAL_BOARD_HASH_MISMATCH`, `FINAL_SCORE_MISMATCH`, `FINAL_MOVE_COUNT_MISMATCH`, `FINAL_COMPETITIVE_CLASS_MISMATCH`, `FINAL_TERMINAL_REASON_MISMATCH`).

---

## 6. Gate 2 Handoff (Core Storage & Upload API)

Gate 2 will ingest `ReplayV1` payloads from the mobile durable local store:
- Centralized limits: `MAX_REPLAY_EVENTS_LIMIT = 50_000`, `MAX_REPLAY_CHECKPOINTS_LIMIT = 2_000`, `MAX_REPLAY_SERIALIZED_BYTES_LIMIT = 1_500_000`.
- Gate 1 provides local bounded FIFO persistence (`MAX_LOCAL_REPLAYS = 100`) without network uploader.
- Gate 2 will introduce remote upload queue, object storage (Cloudflare R2), and Core Postgres metadata table.
