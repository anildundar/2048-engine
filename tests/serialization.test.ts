import { describe, expect, it } from 'vitest';
import { applyMove, createGame } from '../src/engine.js';
import { deserializeGameState, serializeGameState } from '../src/serialization.js';

describe('GameState Serialization & Deserialization', () => {
  it('round-trips active GameState losslessly', () => {
    const { state: initial } = createGame({ seed: 777, currentTimeMs: 5000 });
    const { state: s1 } = applyMove(initial, 'left', 6000);
    const { state: s2 } = applyMove(s1, 'down', 7000);

    const json = serializeGameState(s2);
    const restored = deserializeGameState(json);

    expect(Array.from(restored.board)).toEqual(Array.from(s2.board));
    expect(restored.score).toBe(s2.score);
    expect(restored.bestScore).toBe(s2.bestScore);
    expect(restored.moveIndex).toBe(s2.moveIndex);
    expect(restored.status).toBe(s2.status);
    expect(restored.rngState).toBe(s2.rngState);
    expect(restored.timer).toEqual(s2.timer);
    expect(restored.history).toHaveLength(s2.history.length);
    expect(restored.timeBoostsUsed).toBe(s2.timeBoostsUsed);
    expect(restored.undosUsed).toBe(s2.undosUsed);
    expect(restored.config).toEqual(s2.config);
  });

  it('rejects corrupt or unsupported version JSON safely', () => {
    expect(() => deserializeGameState('invalid json')).toThrow(/Failed to parse/);
    expect(() => deserializeGameState(JSON.stringify({ version: 999 }))).toThrow(
      /Unsupported serialization version/
    );
    expect(() => deserializeGameState(JSON.stringify({ version: 1, board: [1, 2, 3] }))).toThrow(
      /board must be an array of 16 numbers/
    );
  });
});
