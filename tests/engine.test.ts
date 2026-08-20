import { describe, expect, it } from 'vitest';
import { createBoardFrom, getEmptyCellIndices } from '../src/board.js';
import { applyMove, applyTimeBoost, createGame, evaluateTime, undo } from '../src/engine.js';

describe('Deterministic 2048 Engine Core', () => {
  it('creates identical starting board and state given the same seed', () => {
    const game1 = createGame({ seed: 42 });
    const game2 = createGame({ seed: 42 });

    expect(Array.from(game1.state.board)).toEqual(Array.from(game2.state.board));
    expect(game1.state.score).toBe(0);
    expect(game1.state.moveIndex).toBe(0);
    expect(game1.state.status).toBe('ACTIVE');
    expect(game1.state.rngState).toBe(game2.state.rngState);
    expect(game1.spawned).toHaveLength(2);
  });

  it('spawns only into empty cells and follows 90/10 probability', () => {
    const { state } = createGame({ seed: 100 });
    const nonZeroCount = state.board.filter((x) => x !== 0).length;
    expect(nonZeroCount).toBe(2);

    // Run 50 sequential moves with seed to check spawn validity
    let current = state;
    for (let i = 0; i < 20; i++) {
      const dir = (['left', 'up', 'right', 'down'] as const)[i % 4];
      const { state: next, result } = applyMove(current, dir, i * 1000);
      if (result.changed) {
        expect(result.spawnedTile).not.toBeNull();
        expect([2, 4]).toContain(result.spawnedTile?.value);
      }
      current = next;
    }
  });

  it('resets timer on valid move but does NOT reset timer on invalid move', () => {
    const { state: initial } = createGame({ seed: 1, currentTimeMs: 0 });
    const initialDeadline = initial.timer.deadlineTimestampMs;

    const invalidBoard = createBoardFrom([
      2, 0, 0, 0,
      4, 0, 0, 0,
      8, 0, 0, 0,
      16, 0, 0, 0,
    ]);
    const stateWithLeftmostBoard = {
      ...initial,
      board: invalidBoard,
    };

    // Attempt invalid move at t = 2000ms
    const { state: afterInvalid, result: invResult } = applyMove(
      stateWithLeftmostBoard,
      'left',
      2000
    );
    expect(invResult.changed).toBe(false);
    expect(afterInvalid.moveIndex).toBe(0);
    // CRITICAL INVARIANT: deadline did NOT reset
    expect(afterInvalid.timer.deadlineTimestampMs).toBe(initialDeadline);

    // Make a valid move right at t = 3000ms
    const { state: afterValid, result: valResult } = applyMove(
      stateWithLeftmostBoard,
      'right',
      3000
    );
    expect(valResult.changed).toBe(true);
    expect(afterValid.moveIndex).toBe(1);
    // Deadline is reset to 3000 + duration
    expect(afterValid.timer.deadlineTimestampMs).toBe(3000 + afterValid.timer.durationMs);
  });

  it('detects game over when board is full and no valid merges exist', () => {
    const { state } = createGame({ seed: 1, currentTimeMs: 0 });

    const fullLocked = createBoardFrom([
      2, 4, 2, 4,
      4, 2, 4, 2,
      2, 4, 2, 4,
      4, 2, 4, 2,
    ]);
    const stateLocked = {
      ...state,
      board: fullLocked,
    };

    const { state: afterLockedMove } = applyMove(stateLocked, 'left', 1000);
    expect(afterLockedMove.status).toBe('ACTIVE'); // No change occurred, move was invalid
    expect(getEmptyCellIndices(fullLocked)).toHaveLength(0);
  });

  it('handles timer expiration and Time Boost restoration', () => {
    const { state } = createGame({ seed: 1, currentTimeMs: 0 });
    const deadline = state.timer.deadlineTimestampMs; // e.g. 15000ms

    // Check evaluateTime after deadline
    const { state: expiredState, event } = evaluateTime(state, deadline + 1000);
    expect(expiredState.status).toBe('TIME_EXPIRED');
    expect(event?.type).toBe('TIME_EXPIRED');

    // Attempting a move while expired is rejected
    const { state: rejectedMoveState, result: rejResult } = applyMove(
      expiredState,
      'left',
      deadline + 2000
    );
    expect(rejResult.changed).toBe(false);
    expect(rejectedMoveState.status).toBe('TIME_EXPIRED');

    // Apply Time Boost to recover
    const { state: boostedState } = applyTimeBoost(expiredState, deadline + 3000);
    expect(boostedState.status).toBe('ACTIVE');
    expect(boostedState.timeBoostsUsed).toBe(1);
    expect(boostedState.timer.deadlineTimestampMs).toBe(deadline + 3000 + 10_000);
  });

  it('supports undoing moves and restoring exact deterministic board and score', () => {
    const { state: initial } = createGame({ seed: 999, currentTimeMs: 0 });

    // Make 3 sequential valid moves
    const { state: s1 } = applyMove(initial, 'left', 1000);
    const { state: s2 } = applyMove(s1, 'down', 2000);
    const { state: s3 } = applyMove(s2, 'right', 3000);

    expect(s3.moveIndex).toBe(3);
    expect(s3.history).toHaveLength(3);

    // Undo 1 step
    const undo1 = undo(s3, 4000);
    expect(undo1).not.toBeNull();
    expect(undo1?.state.moveIndex).toBe(2);
    expect(undo1?.state.score).toBe(s2.score);
    expect(Array.from(undo1?.state.board ?? [])).toEqual(Array.from(s2.board));
    expect(undo1?.state.undosUsed).toBe(1);

    // Undo 2nd step
    const undo2 = undo(undo1!.state, 5000);
    expect(undo2).not.toBeNull();
    expect(undo2?.state.moveIndex).toBe(1);
    expect(undo2?.state.score).toBe(s1.score);
    expect(Array.from(undo2?.state.board ?? [])).toEqual(Array.from(s1.board));
    expect(undo2?.state.undosUsed).toBe(2);

    // Undo 3rd step (back to start)
    const undo3 = undo(undo2!.state, 6000);
    expect(undo3).not.toBeNull();
    expect(undo3?.state.moveIndex).toBe(0);
    expect(undo3?.state.score).toBe(0);
    expect(Array.from(undo3?.state.board ?? [])).toEqual(Array.from(initial.board));
    expect(undo3?.state.undosUsed).toBe(3);

    // 4th undo should return null as history is empty
    const undo4 = undo(undo3!.state, 7000);
    expect(undo4).toBeNull();
  });
});
