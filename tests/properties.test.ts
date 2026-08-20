import { describe, expect, it } from 'vitest';
import { applyMove, createGame } from '../src/engine.js';

describe('Engine Invariant Property Tests', () => {
  it('preserves non-decreasing bestScore and monotonically increasing moveIndex on valid moves', () => {
    const { state: initial } = createGame({ seed: 123456 });
    let current = initial;

    const directions = ['left', 'up', 'right', 'down'] as const;
    for (let i = 0; i < 50; i++) {
      const dir = directions[i % 4];
      const { state: next, result } = applyMove(current, dir, (i + 1) * 1000);

      if (result.changed) {
        expect(next.moveIndex).toBe(current.moveIndex + 1);
        expect(next.score).toBe(current.score + result.scoreDelta);
        expect(next.bestScore).toBeGreaterThanOrEqual(current.bestScore);
        expect(next.bestScore).toBeGreaterThanOrEqual(next.score);
      } else {
        expect(next.moveIndex).toBe(current.moveIndex);
        expect(next.score).toBe(current.score);
      }
      current = next;
    }
  });
});
