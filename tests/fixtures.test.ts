import { describe, expect, it } from 'vitest';
import { createBoardFrom } from '../src/board.js';
import { executeMove } from '../src/move.js';

describe('Canonical 2048 Merge Fixtures', () => {
  it('handles [2,2,0,0] -> [4,0,0,0] with score +4', () => {
    const board = createBoardFrom([
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(4);
    expect(Array.from(result.board.slice(0, 4))).toEqual([4, 0, 0, 0]);
  });

  it('handles [2,2,2,0] -> [4,2,0,0] with score +4', () => {
    const board = createBoardFrom([
      2, 2, 2, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(4);
    expect(Array.from(result.board.slice(0, 4))).toEqual([4, 2, 0, 0]);
  });

  it('handles [2,2,2,2] -> [4,4,0,0] with score +8', () => {
    const board = createBoardFrom([
      2, 2, 2, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(8);
    expect(Array.from(result.board.slice(0, 4))).toEqual([4, 4, 0, 0]);
  });

  it('handles [4,4,8,8] -> [8,16,0,0] with score +24', () => {
    const board = createBoardFrom([
      4, 4, 8, 8,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(24);
    expect(Array.from(result.board.slice(0, 4))).toEqual([8, 16, 0, 0]);
  });

  it('handles [2,0,2,2] -> [4,2,0,0] with score +4', () => {
    const board = createBoardFrom([
      2, 0, 2, 2,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(4);
    expect(Array.from(result.board.slice(0, 4))).toEqual([4, 2, 0, 0]);
  });

  it('handles [4,4,4,4] -> [8,8,0,0] with score +16', () => {
    const board = createBoardFrom([
      4, 4, 4, 4,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(true);
    expect(result.scoreDelta).toBe(16);
    expect(Array.from(result.board.slice(0, 4))).toEqual([8, 8, 0, 0]);
  });

  it('proves equivalent behavior in all 4 directions', () => {
    // Test RIGHT
    const bRight = createBoardFrom([
      2, 2, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const resRight = executeMove(bRight, 'right');
    expect(Array.from(resRight.board.slice(0, 4))).toEqual([0, 0, 0, 4]);

    // Test UP
    const bUp = createBoardFrom([
      2, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const resUp = executeMove(bUp, 'up');
    expect(resUp.board[0]).toBe(4);
    expect(resUp.board[4]).toBe(0);

    // Test DOWN
    const bDown = createBoardFrom([
      2, 0, 0, 0,
      2, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    const resDown = executeMove(bDown, 'down');
    expect(resDown.board[12]).toBe(4);
    expect(resDown.board[8]).toBe(0);
  });

  it('returns changed=false and scoreDelta=0 on invalid no-op move', () => {
    const board = createBoardFrom([
      2, 0, 0, 0,
      4, 0, 0, 0,
      8, 0, 0, 0,
      16, 0, 0, 0,
    ]);
    const result = executeMove(board, 'left');
    expect(result.changed).toBe(false);
    expect(result.scoreDelta).toBe(0);
    expect(result.movedTiles).toHaveLength(0);
    expect(result.merges).toHaveLength(0);
  });
});
