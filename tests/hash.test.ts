import { describe, expect, it } from 'vitest';
import { applyMove, createGame } from '../src/engine.js';
import { hashState, sha256 } from '../src/hash.js';

describe('SHA-256 State Fingerprint', () => {
  it('computes standard SHA-256 test vectors correctly', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('2048-deterministic-engine')).toBe(
      '7e3611ce363e750c76f18d92ca81bed966ba48293f84408e215f2a3f603e6926'
    );
  });

  it('produces identical hash for identical states and different hash for different states', () => {
    const game1 = createGame({ seed: 42, currentTimeMs: 0 });
    const game2 = createGame({ seed: 42, currentTimeMs: 0 });

    const hash1 = hashState(game1.state);
    const hash2 = hashState(game2.state);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{64}$/);

    // Apply move to game1
    const { state: s1AfterMove } = applyMove(game1.state, 'left', 1000);
    const hashAfterMove = hashState(s1AfterMove);

    expect(hashAfterMove).not.toBe(hash1);
    expect(hashAfterMove).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic across independent game executions with the same actions', () => {
    const seed = 98765;
    const g1 = createGame({ seed, currentTimeMs: 0 });
    const g2 = createGame({ seed, currentTimeMs: 0 });

    const m1_1 = applyMove(g1.state, 'up', 1000).state;
    const m1_2 = applyMove(m1_1, 'left', 2000).state;
    const m1_3 = applyMove(m1_2, 'right', 3000).state;

    const m2_1 = applyMove(g2.state, 'up', 1000).state;
    const m2_2 = applyMove(m2_1, 'left', 2000).state;
    const m2_3 = applyMove(m2_2, 'right', 3000).state;

    expect(hashState(m1_3)).toBe(hashState(m2_3));
  });
});
