import { describe, expect, it } from 'vitest';
import {
  applyMove,
  createGame,
  computeBoardHash,
  createReplayPlayerV1,
  playReplayV1,
  validateReplayV1,
  REPLAY_SCHEMA_VERSION,
  RULESET_VERSION,
  ENGINE_VERSION,
  type ReplayV1,
  type ReplayEventV1,
  type ReplayCheckpointV1,
} from '../src/index.js';
import { getHighestTile } from '../src/board.js';

describe('Replay V1 Foundation Contract & Player', () => {
  it('validates a well-formed Replay V1 object', () => {
    const replay: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-test-123',
      seed: 42,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 1700000000000,
      initialBoard: [
        2, 0, 0, 0,
        0, 2, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ],
      events: [
        { type: 'RUN_START', t: 0 },
        { type: 'MOVE', t: 500, dt: 500, direction: 'left', spawn: { index: 3, value: 2 }, scoreDelta: 0 },
        { type: 'RUN_TERMINAL', t: 1000, reason: 'GAME_OVER', finalScore: 0, finalHighestTile: 2, totalMoves: 1 },
      ],
      checkpoints: [],
      finalSummary: {
        score: 0,
        highestTile: 2,
        totalMoves: 1,
        durationMs: 1000,
        competitiveClass: 'PURE',
        terminalReason: 'GAME_OVER',
        finalBoard: [
          2, 2, 0, 2,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
        ],
        finalBoardHash: 'test-hash',
      },
    };

    const val = validateReplayV1(replay);
    expect(val.valid).toBe(true);
  });

  it('fails closed when unsupported schema version is provided', () => {
    const val = validateReplayV1({
      replaySchemaVersion: 2, // Unsupported future schema
      engineVersion: '1.0.0',
      rulesetVersion: 'classic-v1',
      runId: 'abc',
      seed: 1,
      initialBoard: new Array(16).fill(0),
      events: [],
    });

    expect(val.valid).toBe(false);
    expect(val.code).toBe('UNSUPPORTED_SCHEMA_VERSION');
  });

  it('fails closed on corrupt or impossible spawn events', () => {
    const replay: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-corrupt',
      seed: 1,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 0,
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
        terminalReason: 'GAME_OVER',
        finalBoard: new Array(16).fill(0),
        finalBoardHash: '',
      },
    };

    const val = validateReplayV1(replay);
    expect(val.valid).toBe(false);
    expect(val.code).toBe('MALFORMED_EVENT');
  });

  it('reproduces exact deterministic run with actions, explicit spawns, and checkpoints', () => {
    // 1. Play real interactive game
    const seed = 999;
    const { state: initial } = createGame({ seed });
    const initialBoard = Array.from(initial.board);

    const moves: ('left' | 'up' | 'right' | 'down')[] = ['left', 'up', 'right', 'down', 'left', 'up'];
    let interactive = initial;

    const events: ReplayEventV1[] = [{ type: 'RUN_START', t: 0 }];
    const checkpoints: ReplayCheckpointV1[] = [];
    let currentTime = 0;

    for (let i = 0; i < moves.length; i++) {
      const dir = moves[i];
      currentTime += 350;
      const { state: nextState, result } = applyMove(interactive, dir, currentTime);

      events.push({
        type: 'MOVE',
        t: currentTime,
        dt: 350,
        direction: dir,
        spawn: result.spawnedTile ? { index: result.spawnedTile.index, value: result.spawnedTile.value as 2 | 4 } : null,
        scoreDelta: result.scoreDelta,
      });

      interactive = nextState;

      // Add checkpoint after move 3
      if (i === 2) {
        checkpoints.push({
          moveIndex: interactive.moveIndex,
          board: Array.from(interactive.board),
          score: interactive.score,
          highestTile: getHighestTile(interactive.board),
          competitiveClass: 'PURE',
          boardHash: computeBoardHash(
            interactive.board,
            interactive.score,
            interactive.moveIndex,
            getHighestTile(interactive.board)
          ),
        });
      }
    }

    events.push({
      type: 'RUN_TERMINAL',
      t: currentTime + 100,
      reason: 'GAME_OVER',
      finalScore: interactive.score,
      finalHighestTile: getHighestTile(interactive.board),
      totalMoves: interactive.moveIndex,
    });

    const replayObj: ReplayV1 = {
      replaySchemaVersion: REPLAY_SCHEMA_VERSION,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-deterministic-1',
      seed,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 1000,
      initialBoard,
      events,
      checkpoints,
      finalSummary: {
        score: interactive.score,
        highestTile: getHighestTile(interactive.board),
        totalMoves: interactive.moveIndex,
        durationMs: currentTime + 100,
        competitiveClass: 'PURE',
        terminalReason: 'GAME_OVER',
        finalBoard: Array.from(interactive.board),
        finalBoardHash: computeBoardHash(
          interactive.board,
          interactive.score,
          interactive.moveIndex,
          getHighestTile(interactive.board)
        ),
      },
    };

    // 2. Playback via playReplayV1
    const playback = playReplayV1(replayObj);

    expect(playback.success).toBe(true);
    expect(playback.desyncDetected).toBe(false);
    expect(playback.matchedCheckpointsCount).toBe(1);
    expect(Array.from(playback.finalState.board)).toEqual(Array.from(interactive.board));
    expect(playback.finalState.score).toBe(interactive.score);
    expect(playback.finalState.moveIndex).toBe(interactive.moveIndex);
  });

  it('detects desync when a checkpoint hash or score is corrupted', () => {
    const replayObj: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-tampered',
      seed: 123,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 0,
      initialBoard: [
        2, 0, 0, 0,
        2, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ],
      events: [
        { type: 'RUN_START', t: 0 },
        { type: 'MOVE', t: 200, dt: 200, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
        { type: 'RUN_TERMINAL', t: 300, reason: 'GAME_OVER', finalScore: 4, finalHighestTile: 4, totalMoves: 1 },
      ],
      checkpoints: [
        {
          moveIndex: 1,
          board: [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
          score: 99999, // Tampered score
          highestTile: 4,
          competitiveClass: 'PURE',
          boardHash: 'fake-hash',
        },
      ],
      finalSummary: {
        score: 4,
        highestTile: 4,
        totalMoves: 1,
        durationMs: 300,
        competitiveClass: 'PURE',
        terminalReason: 'GAME_OVER',
        finalBoard: [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        finalBoardHash: 'valid-hash',
      },
    };

    const playback = playReplayV1(replayObj);
    expect(playback.success).toBe(false);
    expect(playback.desyncDetected).toBe(true);
    expect(playback.desyncDetails?.type).toBe('CHECKPOINT_MISMATCH');
  });

  it('handles undo sequences correctly in replay', () => {
    const replayObj: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-undo',
      seed: 123,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 0,
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
        // Move 2: down -> [0, 0, 0, 0 ... 4, 0, 0, 2], spawn at 0
        { type: 'MOVE', t: 400, dt: 200, direction: 'down', spawn: { index: 0, value: 2 }, scoreDelta: 0 },
        // Undo move 2: restores state back to move 1
        { type: 'UNDO', t: 500, restoredMoveIndex: 1, restoredScore: 4 },
        // Move 3 alternate: right -> [0, 0, 0, 4] with spawn at 5
        { type: 'MOVE', t: 700, dt: 200, direction: 'right', spawn: { index: 5, value: 4 }, scoreDelta: 0 },
        { type: 'RUN_TERMINAL', t: 800, reason: 'GAME_OVER', finalScore: 4, finalHighestTile: 4, totalMoves: 2 },
      ],
      checkpoints: [],
      finalSummary: {
        score: 4,
        highestTile: 4,
        totalMoves: 2,
        durationMs: 800,
        competitiveClass: 'ASSISTED',
        terminalReason: 'GAME_OVER',
        finalBoard: [
          0, 0, 0, 4,
          0, 4, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 2,
        ],
        finalBoardHash: 'valid-hash',
      },
    };

    const playback = playReplayV1(replayObj);
    expect(playback.success).toBe(true);
    expect(playback.finalState.score).toBe(4);
    expect(playback.finalState.moveIndex).toBe(2);
    expect(playback.finalState.board[3]).toBe(4);
    expect(playback.finalState.board[5]).toBe(4);
    expect(playback.finalState.board[15]).toBe(2);
  });

  it('supports interactive stepping and seeking via ReplayPlayerInstance', () => {
    const replayObj: ReplayV1 = {
      replaySchemaVersion: 1,
      engineVersion: ENGINE_VERSION,
      rulesetVersion: RULESET_VERSION,
      runId: 'run-player',
      seed: 123,
      mode: 'CLASSIC',
      competitiveClassAtStart: 'PURE',
      startedAt: 0,
      initialBoard: [
        2, 0, 0, 0,
        2, 0, 0, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ],
      events: [
        { type: 'RUN_START', t: 0 },
        { type: 'MOVE', t: 100, dt: 100, direction: 'up', spawn: { index: 15, value: 2 }, scoreDelta: 4 },
        { type: 'MOVE', t: 200, dt: 100, direction: 'right', spawn: { index: 0, value: 2 }, scoreDelta: 0 },
        { type: 'RUN_TERMINAL', t: 300, reason: 'GAME_OVER', finalScore: 4, finalHighestTile: 4, totalMoves: 2 },
      ],
      checkpoints: [
        {
          moveIndex: 1,
          board: [4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
          score: 4,
          highestTile: 4,
          competitiveClass: 'PURE',
          boardHash: computeBoardHash([4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2], 4, 1, 4),
        },
      ],
      finalSummary: {
        score: 4,
        highestTile: 4,
        totalMoves: 2,
        durationMs: 300,
        competitiveClass: 'PURE',
        terminalReason: 'GAME_OVER',
        finalBoard: [2, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2],
        finalBoardHash: 'valid-hash',
      },
    };

    const player = createReplayPlayerV1(replayObj);
    expect(player.getCurrentMoveIndex()).toBe(0);

    // Step 1: RUN_START
    player.stepForward();
    expect(player.getCurrentMoveIndex()).toBe(0);

    // Step 2: Move 1 (up)
    player.stepForward();
    expect(player.getCurrentMoveIndex()).toBe(1);
    expect(player.getCurrentState().score).toBe(4);

    // Step 3: Move 2 (right)
    player.stepForward();
    expect(player.getCurrentMoveIndex()).toBe(2);

    // Seek back to move 1
    player.seekToMoveIndex(1);
    expect(player.getCurrentMoveIndex()).toBe(1);
    expect(player.getCurrentState().score).toBe(4);

    // Seek to beginning
    player.seekToMoveIndex(0);
    expect(player.getCurrentMoveIndex()).toBe(0);
    expect(player.getCurrentState().score).toBe(0);
  });
});
