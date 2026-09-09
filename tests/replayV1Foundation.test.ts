import { describe, expect, it } from 'vitest';
import {
  computeBoardHash,
  createReplayPlayerV1,
  playReplayV1,
  validateReplayV1,
  applyReplayEventV1,
  getAdaptiveTimerStageBaseMs,
  getAdaptiveTimerMaxCapMs,
  ADAPTIVE_INITIAL_TIMER_MS,
  RULESET_VERSION,
  ENGINE_VERSION,
  type ReplayV1,
  type FullUndoSnapshot,
} from '../src/index.js';

describe('Replay V1 Foundation Contract, Adaptive Timer & Player', () => {
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

  describe('Adaptive Per-Move Timer (10s -> 3s) & Monotonic highestTileEver (§2, §4, §5)', () => {
    it('resolves correct stage base across all highestTileEver boundaries', () => {
      expect(getAdaptiveTimerStageBaseMs(2)).toBe(10_000);
      expect(getAdaptiveTimerStageBaseMs(64)).toBe(10_000);
      expect(getAdaptiveTimerStageBaseMs(128)).toBe(9_000);
      expect(getAdaptiveTimerStageBaseMs(256)).toBe(8_000);
      expect(getAdaptiveTimerStageBaseMs(512)).toBe(7_000);
      expect(getAdaptiveTimerStageBaseMs(1024)).toBe(6_000);
      expect(getAdaptiveTimerStageBaseMs(2048)).toBe(5_000);
      expect(getAdaptiveTimerStageBaseMs(4096)).toBe(4_000);
      expect(getAdaptiveTimerStageBaseMs(8192)).toBe(3_000);
      expect(getAdaptiveTimerStageBaseMs(16384)).toBe(3_000);
    });

    it('resets timer duration to current stage base on valid move, but preserves timer on no-op move', () => {
      const history: FullUndoSnapshot[] = [];
      let state = {
        board: new Uint16Array([
          2, 0, 0, 0,
          2, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ]),
        score: 0,
        bestScore: 0,
        moveIndex: 0,
        status: 'ACTIVE' as const,
        rngState: 1,
        timer: {
          durationMs: ADAPTIVE_INITIAL_TIMER_MS,
          timeRemainingMs: 3_000, // Pretend 7s elapsed
          currentTier: 1,
          deadlineTimestampMs: 3_000,
        },
        competitiveClass: 'PURE' as const,
        undosUsed: 0,
        timeBoostsUsed: 0,
        highestTileEver: 2,
        isPaused: false,
      };

      // 1. Valid move (up) merges [2, 2] -> 4. Timer MUST reset to 10,000ms!
      const validRes = applyReplayEventV1(state, {
        type: 'MOVE',
        t: 1000,
        direction: 'up',
        spawn: { index: 12, value: 2 },
        scoreDelta: 4,
      }, history);

      expect(validRes.nextState.timer.timeRemainingMs).toBe(10_000);
      expect(validRes.nextState.highestTileEver).toBe(4);
      expect(validRes.nextState.moveIndex).toBe(1);
      state = validRes.nextState;

      // Simulate timer ticking down to 2,000ms
      state.timer.timeRemainingMs = 2_000;

      // 2. No-op move (left: both cell 0 and 12 are already in col 0). Timer MUST NOT reset!
      const noopRes = applyReplayEventV1(state, {
        type: 'MOVE',
        t: 2000,
        direction: 'left',
        spawn: null,
        scoreDelta: 0,
      }, history);

      expect(noopRes.nextState.timer.timeRemainingMs).toBe(2_000); // Unchanged!
      expect(noopRes.nextState.moveIndex).toBe(1); // Unchanged!
    });

    it('enforces canonical Time Boost +5s cap: stageBase + 5s max', () => {
      const history: FullUndoSnapshot[] = [];
      const stageBaseMs = getAdaptiveTimerStageBaseMs(2); // 10,000ms
      const maxCapMs = getAdaptiveTimerMaxCapMs(stageBaseMs); // 15,000ms
      expect(maxCapMs).toBe(15_000);

      // Case A: remaining is 9s -> +5s -> 14s (below cap)
      const stateA = {
        board: new Uint16Array(16),
        score: 0,
        bestScore: 0,
        moveIndex: 1,
        status: 'ACTIVE' as const,
        rngState: 1,
        timer: { durationMs: 10_000, timeRemainingMs: 9_000, currentTier: 1, deadlineTimestampMs: 9_000 },
        competitiveClass: 'PURE' as const,
        undosUsed: 0,
        timeBoostsUsed: 0,
        highestTileEver: 4,
        isPaused: false,
      };

      const resA = applyReplayEventV1(stateA, { type: 'TIME_BOOST', t: 500, addedSeconds: 5 }, history);
      expect(resA.nextState.timer.timeRemainingMs).toBe(14_000);
      expect(resA.nextState.competitiveClass).toBe('ASSISTED');

      // Case B: remaining is 14s -> +5s would be 19s, but MUST BE CAPPED at 15s!
      const stateB = {
        ...stateA,
        timer: { durationMs: 10_000, timeRemainingMs: 14_000, currentTier: 1, deadlineTimestampMs: 14_000 },
      };

      const resB = applyReplayEventV1(stateB, { type: 'TIME_BOOST', t: 600, addedSeconds: 5 }, history);
      expect(resB.nextState.timer.timeRemainingMs).toBe(15_000); // Capped at stageBase + 5s!
    });
  });

  describe('Fail-Closed Version Compatibility, Hex Format & Semantic Validation', () => {
    it('fails closed when unsupported schema version is provided', () => {
      const val = validateReplayV1({
        replaySchemaVersion: 2,
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
        engineVersion: '2.0.0',
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

    it('fails closed when TIME_BOOST contains non-5 addedSeconds', () => {
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
        events: [{ type: 'TIME_BOOST', t: 100, addedSeconds: 15 }], // Invalid for canonical V1
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
      expect(val.error).toContain('addedSeconds === 5');
    });

    it('enforces strict 64-char hex format on checkpoint and final hashes (§15)', () => {
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
            moveIndex: 1,
            board: new Array(16).fill(0),
            score: 0,
            highestTile: 0,
            competitiveClass: 'PURE',
            boardHash: 'not-a-valid-hex-string-of-64-characters-zzzzzzzzzzzzzzzzzzzzzzzzzzzz', // 64 chars, but non-hex!
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
      expect(val.error).toContain('hex');
    });
  });

  describe('Undo & Seek With Single Canonical Reducer (§12, §13)', () => {
    it('restores full semantic state and preserves monotonic highestTileEver on Undo', () => {
      const history: FullUndoSnapshot[] = [];
      let state = {
        board: new Uint16Array([
          2, 2, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ]),
        score: 0,
        bestScore: 0,
        moveIndex: 0,
        status: 'ACTIVE' as const,
        rngState: 1,
        timer: { durationMs: 10_000, timeRemainingMs: 10_000, currentTier: 1, deadlineTimestampMs: 10_000 },
        competitiveClass: 'PURE' as const,
        undosUsed: 0,
        timeBoostsUsed: 0,
        highestTileEver: 2,
        isPaused: false,
      };

      // Move 1: left -> [4, 0, 0, 0], highestTileEver becomes 4
      const res1 = applyReplayEventV1(state, {
        type: 'MOVE',
        t: 100,
        direction: 'left',
        spawn: { index: 15, value: 2 },
        scoreDelta: 4,
      }, history);
      state = res1.nextState;
      expect(state.highestTileEver).toBe(4);
      expect(state.moveIndex).toBe(1);

      // Move 2: down -> spawn at 0
      const res2 = applyReplayEventV1(state, {
        type: 'MOVE',
        t: 200,
        direction: 'down',
        spawn: { index: 0, value: 2 },
        scoreDelta: 0,
      }, history);
      state = res2.nextState;
      expect(state.moveIndex).toBe(2);

      // Undo Move 2 -> restores Move 1 board and score, but highestTileEver remains 4 (monotonic invariant)
      const resUndo = applyReplayEventV1(state, {
        type: 'UNDO',
        t: 300,
        restoredMoveIndex: 1,
        restoredScore: 4,
      }, history);
      state = resUndo.nextState;

      expect(state.moveIndex).toBe(1);
      expect(state.score).toBe(4);
      expect(state.highestTileEver).toBe(4); // Did not decrease!
      expect(state.undosUsed).toBe(1);
    });

    it('seeks reliably across no-ops, undos, and alternate branches via REPLAY_FROM_START strategy', () => {
      const boardMove1 = [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0];
      const hash1 = computeBoardHash(boardMove1, 4, 1, 4);

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
        runId: 'run-seek-canonical',
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
          { type: 'MOVE', t: 100, dt: 100, direction: 'up', spawn: { index: 12, value: 2 }, scoreDelta: 4 },
          { type: 'MOVE', t: 200, dt: 100, direction: 'left', spawn: null, scoreDelta: 0 }, // No-op
          { type: 'MOVE', t: 300, dt: 100, direction: 'right', spawn: { index: 1, value: 2 }, scoreDelta: 0 },
          { type: 'UNDO', t: 400, restoredMoveIndex: 1, restoredScore: 4 },
          { type: 'MOVE', t: 500, dt: 100, direction: 'down', spawn: { index: 15, value: 4 }, scoreDelta: 0 },
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
            eventIndex: 2,
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

      // Playback check
      const playback = playReplayV1(replayObj);
      expect(playback.success).toBe(true);

      // Player seek check
      const player = createReplayPlayerV1(replayObj);
      player.seekToMoveIndex(1);
      expect(player.getCurrentMoveIndex()).toBe(1);
      expect(player.getCurrentState().score).toBe(4);

      player.seekToMoveIndex(2);
      expect(player.getCurrentMoveIndex()).toBe(2);
      expect(player.getCurrentState().score).toBe(4);
      expect(Array.from(player.getCurrentState().board)).toEqual(finalBoard);
    });
  });
});
