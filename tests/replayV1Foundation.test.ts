import { describe, expect, it } from 'vitest';
import {
  computeBoardHash,
  createReplayPlayerV1,
  playReplayV1,
  validateReplayV1,
  RULESET_VERSION,
  ENGINE_VERSION,
  type ReplayV1,
} from '../src/index.js';

describe('Replay V1 Foundation Contract & Player', () => {
  const sampleInitialBoard = [
    2, 0, 0, 0,
    0, 2, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ];

  it('validates a well-formed Replay V1 object', () => {
    const finalBoard = [
      2, 2, 0, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ];
    const finalHash = computeBoardHash(finalBoard, 0, 1, 2);

    const replay: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-test-123',
      seed: 42,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 1700000000000,
      initialBoard: sampleInitialBoard,
      events: [
        { type: 'RUN_START', t: 0 },
        { type: 'MOVE', t: 500, dt: 500, direction: 'left', spawn: { index: 3, value: 2 }, scoreDelta: 0 },
        { type: 'RUN_TERMINAL', t: 1000, reason: 'RESIGNED', finalScore: 0, finalHighestTile: 2, totalMoves: 1 },
      ],
      checkpoints: [],
      finalSummary: {
        score: 0,
        highestTile: 2,
        totalMoves: 1,
        durationMs: 1000,
        competitiveClass: 'PURE',
        terminalReason: 'RESIGNED',
        finalBoard,
        finalBoardHash: finalHash,
      },
    };

    const val = validateReplayV1(replay);
    expect(val.valid).toBe(true);
  });

  describe('Fail-Closed Version Compatibility & Contract Validation', () => {
    it('fails closed when unsupported schema version is provided', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 2, // Unsupported future schema
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    });

    it('fails closed when unsupported engine version is provided', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: '9.9.9', // Unsupported future engine
        rulesetVersion: RULESET_VERSION,
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('UNSUPPORTED_ENGINE_VERSION');
    });

    it('fails closed when unsupported ruleset version is provided', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: 'unknown-ruleset-v2', // Unsupported ruleset
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('UNSUPPORTED_RULESET_VERSION');
    });

    it('fails closed on unknown event type', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [{ type: 'NON_EXISTENT_TYPE', t: 100 }],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('MALFORMED_EVENT');
    });

    it('fails closed on non-monotonic timestamps', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [
          { type: 'RUN_START', t: 200 },
          { type: 'MOVE', t: 100, direction: 'left' }, // Backward in time!
        ],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('MALFORMED_EVENT');
      expect(val.error).toContain('non-monotonic');
    });

    it('fails closed on corrupt or impossible spawn events', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-corrupt',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [
          {
            type: 'MOVE',
            t: 100,
            direction: 'left',
            // @ts-expect-error Testing invalid spawn value 8
            spawn: { index: 25, value: 8 }, // Out of bounds cell index and impossible initial spawn value
          },
        ],
        checkpoints: [],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('MALFORMED_EVENT');
    });

    it('fails closed when checkpoints have non-strictly increasing moveIndex', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'abc',
        seed: 1,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: new Array(16).fill(0),
        events: [],
        checkpoints: [
          {
            moveIndex: 10,
            board: new Array(16).fill(0),
            score: 100,
            highestTile: 16,
            competitiveClass: 'PURE',
            boardHash: 'a'.repeat(64),
          },
          {
            moveIndex: 5, // Backward moveIndex!
            board: new Array(16).fill(0),
            score: 50,
            highestTile: 8,
            competitiveClass: 'PURE',
            boardHash: 'b'.repeat(64),
          },
        ],
        finalSummary: {
          score: 0,
          highestTile: 0,
          totalMoves: 0,
          durationMs: 0,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard: new Array(16).fill(0),
          finalBoardHash: computeBoardHash(new Array(16).fill(0), 0, 0, 0),
        },
      });

      expect(val.valid).toBe(false);
      expect(val.code).toBe('MALFORMED_CHECKPOINT');
    });
  });

  describe('Full Event Playback Semantics', () => {
    it('applies Time Boost timer mutation (+5s), increments count and transitions to ASSISTED', () => {
      const finalBoard = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 1, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-boost',
        seed: 10,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          { type: 'MOVE', t: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          { type: 'TIME_BOOST', t: 200, addedSeconds: 5 },
          { type: 'RUN_TERMINAL', t: 300, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 1,
          durationMs: 300,
          competitiveClass: 'ASSISTED',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.timeBoostsUsed).toBe(1);
      expect(playback.finalState.competitiveClass).toBe('ASSISTED');
      // Default tier1 duration is 15_000ms. Added 5_000ms -> 20_000ms.
      expect(playback.finalState.timer.timeRemainingMs).toBe(20_000);
    });

    it('applies ASSISTED_TRANSITION event exactly at event boundary', () => {
      const finalBoard = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 1, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-assisted-transition',
        seed: 10,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          { type: 'MOVE', t: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          { type: 'ASSISTED_TRANSITION', t: 150, reason: 'TIME_BOOST_USED' },
          { type: 'RUN_TERMINAL', t: 300, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 1,
          durationMs: 300,
          competitiveClass: 'ASSISTED',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.competitiveClass).toBe('ASSISTED');
    });

    it('applies RESCUE_TIMEOUT restoring timer and setting ASSISTED state', () => {
      const finalBoard = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 1, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-rescue',
        seed: 10,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          { type: 'MOVE', t: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          { type: 'RESCUE_TIMEOUT', t: 200, addedSeconds: 5 },
          { type: 'RUN_TERMINAL', t: 300, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 1,
          durationMs: 300,
          competitiveClass: 'ASSISTED',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.timeBoostsUsed).toBe(1);
      expect(playback.finalState.competitiveClass).toBe('ASSISTED');
      expect(playback.finalState.status).toBe('ACTIVE');
      expect(playback.finalState.timer.timeRemainingMs).toBe(5_000);
    });

    it('tracks PAUSE and RESUME without altering board or score state', () => {
      const finalBoard = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 1, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-pause-resume',
        seed: 10,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          { type: 'MOVE', t: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          { type: 'PAUSE', t: 200 },
          { type: 'RESUME', t: 1200, pauseDurationMs: 1000 },
          { type: 'RUN_TERMINAL', t: 1300, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 1,
          durationMs: 1300,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.isPaused).toBe(false);
      expect(playback.finalState.score).toBe(4);
    });
  });

  describe('Undo Full-State Round-Trip & Branching', () => {
    it('faithfully restores board, score, moveIndex, timer, rngState, and preserves competitive state', () => {
      const finalBoard = [
        0, 0, 0, 4,
        0, 4, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 2, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-undo-full',
        seed: 123,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 2, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          // Move 1: left -> [4, 0, 0, 0], spawn at 15
          { type: 'MOVE', t: 200, dt: 200, direction: 'left', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          // Move 2: down -> spawn at 0
          { type: 'MOVE', t: 400, dt: 200, direction: 'down', spawn: { index: 0, value: 2 }, scoreDelta: 0 },
          // Undo move 2: restores state back to move 1
          { type: 'UNDO', t: 500, restoredMoveIndex: 1, restoredScore: 4 },
          // Alternate Move 2: right -> [0, 0, 0, 4] with spawn at 5
          { type: 'MOVE', t: 700, dt: 200, direction: 'right', spawn: { index: 5, value: 4 }, scoreDelta: 0 },
          { type: 'RUN_TERMINAL', t: 800, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 2 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 2,
          durationMs: 800,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.score).toBe(4);
      expect(playback.finalState.moveIndex).toBe(2);
      expect(playback.finalState.undosUsed).toBe(1);
      expect(playback.finalState.board[3]).toBe(4);
      expect(playback.finalState.board[5]).toBe(4);
      expect(playback.finalState.board[15]).toBe(2);
    });
  });

  describe('Comprehensive Final Summary Integrity Verification', () => {
    const baseReplay = (): ReplayV1 => {
      const finalBoard = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 2,
      ];
      return {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-integrity',
        seed: 10,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          { type: 'MOVE', t: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
          { type: 'RUN_TERMINAL', t: 300, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
        ],
        checkpoints: [],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 1,
          durationMs: 300,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: computeBoardHash(finalBoard, 4, 1, 4),
        },
      };
    };

    it('fails on FINAL_BOARD_MISMATCH when finalBoard cells are altered', () => {
      const rep = baseReplay();
      rep.finalSummary.finalBoard[0] = 8; // Tampered cell
      // update hash to match tampered board to ensure board check itself fails
      rep.finalSummary.finalBoardHash = computeBoardHash(rep.finalSummary.finalBoard, 4, 1, 4);

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_BOARD_MISMATCH');
    });

    it('fails on FINAL_BOARD_HASH_MISMATCH when finalBoardHash does not match computed hash', () => {
      const rep = baseReplay();
      rep.finalSummary.finalBoardHash = 'f'.repeat(64); // Tampered hash

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_BOARD_HASH_MISMATCH');
    });

    it('fails on FINAL_SCORE_MISMATCH when summary score diverges', () => {
      const rep = baseReplay();
      rep.finalSummary.score = 9999;

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_SCORE_MISMATCH');
    });

    it('fails on FINAL_MOVE_COUNT_MISMATCH when totalMoves diverges', () => {
      const rep = baseReplay();
      rep.finalSummary.totalMoves = 10;

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_MOVE_COUNT_MISMATCH');
    });

    it('fails on FINAL_COMPETITIVE_CLASS_MISMATCH when competitiveClass diverges', () => {
      const rep = baseReplay();
      rep.finalSummary.competitiveClass = 'ASSISTED'; // Summary claims ASSISTED without any boost/assist event

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_COMPETITIVE_CLASS_MISMATCH');
    });

    it('fails on FINAL_TERMINAL_REASON_MISMATCH when terminal reason claims GAME_OVER but moves remain', () => {
      const rep = baseReplay();
      rep.finalSummary.terminalReason = 'GAME_OVER'; // Invalid: board has empty cells and valid moves!

      const res = playReplayV1(rep);
      expect(res.success).toBe(false);
      expect(res.desyncDetected).toBe(true);
      expect(res.desyncDetails?.type).toBe('FINAL_TERMINAL_REASON_MISMATCH');
    });
  });

  describe('Seek & Checkpoint with No-Ops and Undo Branches', () => {
    it('maintains explicit event cursor across no-ops, undos, and alternate branches', () => {
      // initial: cell 0 = 2, cell 4 = 2.
      // Move 1 (up): merge -> cell 0 = 4. Spawn at cell 12 (value 2).
      const boardMove1 = [
        4, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
        2, 0, 0, 0,
      ];
      const hash1 = computeBoardHash(boardMove1, 4, 1, 4);

      // Alternate move 2: down.
      // cell 12 has 2, cell 0 slides to cell 8 (value 4). Spawn at cell 15 (value 4).
      const finalBoard = [
        0, 0, 0, 0,
        0, 0, 0, 0,
        4, 0, 0, 0,
        2, 0, 0, 4,
      ];
      const finalHash = computeBoardHash(finalBoard, 4, 2, 4);

      const replayObj: ReplayV1 = {
        replaySchemaVersion: 1,
        engineVersion: ENGINE_VERSION,
        rulesetVersion: RULESET_VERSION,
        runId: 'run-seek-branch',
        seed: 123,
        mode: 'CLASSIC',
        competitiveClassAtStart: 'PURE',
        startedAt: 1000,
        initialBoard: [
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        events: [
          { type: 'RUN_START', t: 0 },
          // Event 1: Move 1 (up) -> score: 4, moveIndex: 1. Spawn at cell 12
          { type: 'MOVE', t: 100, dt: 100, direction: 'up', spawn: { index: 12, value: 2 }, scoreDelta: 4 },
          // Event 2: No-op move (left: both cell 0 and cell 12 are already at column 0)
          { type: 'MOVE', t: 200, dt: 100, direction: 'left', spawn: null, scoreDelta: 0 },
          // Event 3: Move 2 (right) -> cell 0 slides to cell 3, cell 12 slides to cell 15
          { type: 'MOVE', t: 300, dt: 100, direction: 'right', spawn: { index: 1, value: 2 }, scoreDelta: 0 },
          // Event 4: Undo Move 2 -> back to moveIndex 1 (boardMove1 restored)
          { type: 'UNDO', t: 400, restoredMoveIndex: 1, restoredScore: 4 },
          // Event 5: Alternate Move 2 (down) -> cell 0 slides to cell 8, spawn at cell 15
          { type: 'MOVE', t: 500, dt: 100, direction: 'down', spawn: { index: 15, value: 4 }, scoreDelta: 0 },
          // Event 6: Terminal
          { type: 'RUN_TERMINAL', t: 600, reason: 'RESIGNED', finalScore: 4, finalHighestTile: 4, totalMoves: 2 },
        ],
        checkpoints: [
          {
            moveIndex: 1,
            board: boardMove1,
            score: 4,
            highestTile: 4,
            competitiveClass: 'PURE',
            boardHash: hash1,
            eventIndex: 2, // Checkpoint recorded right after Move 1
          },
        ],
        finalSummary: {
          score: 4,
          highestTile: 4,
          totalMoves: 2,
          durationMs: 600,
          competitiveClass: 'PURE',
          terminalReason: 'RESIGNED',
          finalBoard,
          finalBoardHash: finalHash,
        },
      };

      // 1. Full playback validation
      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);
      expect(playback.finalState.moveIndex).toBe(2);

      // 2. Interactive player seeking
      const player = createReplayPlayerV1(replayObj);

      // Seek to checkpoint move 1
      player.seekToMoveIndex(1);
      expect(player.getCurrentMoveIndex()).toBe(1);
      expect(player.getCurrentState().score).toBe(4);

      // Step forward through no-op and undo and alternate move to end
      while (!player.isAtEnd()) {
        player.stepForward();
      }
      expect(player.getCurrentMoveIndex()).toBe(2);
      expect(player.getCurrentState().score).toBe(4);
      expect(Array.from(player.getCurrentState().board)).toEqual(finalBoard);

      // Seek back to 0
      player.seekToMoveIndex(0);
      expect(player.getCurrentMoveIndex()).toBe(0);
      expect(player.getCurrentState().score).toBe(0);

      // Seek forward directly to move 2
      player.seekToMoveIndex(2);
      expect(player.getCurrentMoveIndex()).toBe(2);
      expect(player.getCurrentState().score).toBe(4);
      expect(Array.from(player.getCurrentState().board)).toEqual(finalBoard);
    });
  });
});
