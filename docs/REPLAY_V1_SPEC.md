# Replay Schema V1 Specification — 2048: Championship Edition

**Date:** 2026-09-09  
**Version:** 1  
**Status:** CANONICAL REPLAY FOUNDATION GATE 1 (POST-ACCEPTANCE CORRECTNESS CLOSED)

---

## 1. Overview & Principles

Championship Replay V1 records lightweight, deterministic gameplay action and state progression data rather than raw screen video.

Key Principles:
1. **Deterministic Action + Explicit Spawn Model:** Replay preserves player input direction and explicit resulting tile spawns (`cell index + value`). This guarantees that even if engine PRNG internals or configurations adjust in the future, historical runs remain 100% deterministically replayable.
2. **Periodic Checkpoints & Seeking:** Every 50 state-changing moves (`DEFAULT_CHECKPOINT_CADENCE = 50`), a compact snapshot (board array, score, highestTile, competitiveClass, and SHA-256 board hash) is captured. Playback builds a canonical playback timeline index (Option B) that ensures seeking across no-ops, Undos, and alternate branches lands on authentic state.
3. **Full-State Undo Restoration:** Replay Undo reconstructs the full game snapshot (board, score, moveIndex, timer, rngState, highestTile, and competitiveClass).
4. **Canonical Time Boost Semantics:** Time Boost applies the canonical product rule of `+5 seconds` (5,000ms), requires an active run, carries no resurrection, and transitions the competitive class to `ASSISTED`.
5. **Failure Domain Separation:** Replay capture, serialization, or storage failure must NEVER impede active gameplay, run finalization, progression, or ranked score submission.
6. **Rank Authority Invariant:** Replay is an observational and presentation record, NOT a cryptographic client anti-cheat proof (`REPLAY_HASH_IS_CRYPTOGRAPHIC_RANK_PROOF = NO`).

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

## 3. Fail-Closed Version Compatibility Policy

`validateReplayV1()` strictly validates versions against supported values:
- `replaySchemaVersion`: must equal `1` (`UNSUPPORTED_SCHEMA_VERSION`).
- `engineVersion`: must match supported engine versions, currently `'1.0.0'` (`UNSUPPORTED_ENGINE_VERSION`).
- `rulesetVersion`: must match supported rulesets, currently `'classic-v1'` (`UNSUPPORTED_RULESET_VERSION`).

Future rulesets or engine versions must provide explicit adapters before playback rather than silently running unknown semantics.

---

## 4. Event Vocabulary & Semantics

| Event Type | Purpose | Semantics & Payload Fields |
| :--- | :--- | :--- |
| `RUN_START` | Identifies run start relative origin | `t: 0` |
| `MOVE` | Directional swipe & resulting spawn | `t, dt, direction, spawn: { index, value } \| null, scoreDelta` |
| `PAUSE` | Game pause marker | `t`, sets playback `isPaused = true` |
| `RESUME` | Game resume marker | `t, pauseDurationMs`, sets playback `isPaused = false` |
| `TIME_BOOST` | Time extension boost applied | `t, addedSeconds` (canonical 5s), adds 5000ms to timer, increments `timeBoostsUsed`, transitions to `ASSISTED` |
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
