# Replay Schema V1 Specification — 2048: Championship Edition

**Date:** 2026-09-09  
**Version:** 1  
**Status:** CANONICAL REPLAY FOUNDATION GATE 1

---

## 1. Overview & Principles

Championship Replay V1 records lightweight, deterministic gameplay action and state progression data rather than raw screen video.

Key Principles:
1. **Deterministic Action + Explicit Spawn Model:** Replay preserves both the player input direction and the explicit resulting tile spawn (cell index + value). This guarantees that even if future engine versions adjust PRNG internals, historical runs remain 100% replayable.
2. **Periodic Checkpoints:** Every ~50 state-changing moves, a compact snapshot (board array, score, highestTile, and SHA-256 board hash) is stored to enable sub-second scrubbing/seeking and immediate desync detection.
3. **Failure Domain Separation:** Replay capture or storage failures must NEVER impede active gameplay, run finalization, or ranked score submission.
4. **Rank Authority Invariant:** Replay is an observational and presentation record, NOT a cryptographic client anti-cheat proof.

---

## 2. Replay V1 Contract Structure

```typescript
export interface ReplayV1 {
  replaySchemaVersion: 1;
  engineVersion: string; // e.g. "1.0.0"
  rulesetVersion: string; // e.g. "classic-v1"
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

## 3. Event Vocabulary

| Event Type | Purpose | Payload Fields |
| :--- | :--- | :--- |
| `RUN_START` | Identifies run start relative origin | `t: 0` |
| `MOVE` | Directional swipe & resulting spawn | `t, dt, direction, spawn: { index, value } \| null, scoreDelta` |
| `PAUSE` | Game pause marker | `t` |
| `RESUME` | Game resume marker | `t, pauseDurationMs` |
| `TIME_BOOST` | Time extension boost applied | `t, addedSeconds` |
| `UNDO` | Undo boost executed | `t, restoredMoveIndex, restoredScore, restoredBoard` |
| `RESCUE_TIMEOUT` | Assisted continuation upon timer expiration | `t, addedSeconds` |
| `RESCUE_UNDO` | Assisted continuation upon near-terminal state | `t` |
| `RUN_TERMINAL` | Final run completion | `t, reason, finalScore, finalHighestTile, totalMoves` |

---

## 4. Checkpoint & Hash Strategy

- Checkpoint Cadence: Default every 50 state-changing moves (`DEFAULT_CHECKPOINT_CADENCE = 50`).
- Hash Function: FIPS 180-4 SHA-256 (`computeBoardHash(board, score, moveIndex, highestTile)`).
- Desync Detection: Evaluator validates checkpoint hashes during playback. Any deviation produces a typed `CHECKPOINT_MISMATCH` or `FINAL_SCORE_MISMATCH`.

---

## 5. Next Gate Handoff (Gate 2: Core Storage & Object Store)

Gate 2 will ingest `ReplayV1` payloads from the mobile durable queue:
- Max serialized JSON size limit: 500 KB.
- Gzip compression on upload.
- Hybrid storage: Postgres relational metadata (`replays` table) + Cloudflare R2 object storage (`replays/{year}/{month}/{replayId}.json.gz`).
