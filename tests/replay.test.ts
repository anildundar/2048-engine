import { describe, expect, it } from 'vitest';
import { applyMove, applyTimeBoost, createGame, replay, undo } from '../src/engine.js';
import type { ReplayAction } from '../src/types.js';

describe('Deterministic Replay Foundation', () => {
  it('reproduces exact final state from seed and action sequence', () => {
    const seed = 54321;
    const actions: ReplayAction[] = [
      { type: 'MOVE', direction: 'left', timestampMs: 1000 },
      { type: 'MOVE', direction: 'up', timestampMs: 2000 },
      { type: 'MOVE', direction: 'right', timestampMs: 3000 },
      { type: 'TIME_BOOST', timestampMs: 3500 },
      { type: 'MOVE', direction: 'down', timestampMs: 4000 },
      { type: 'UNDO', timestampMs: 4500 },
      { type: 'MOVE', direction: 'left', timestampMs: 5000 },
    ];

    // 1. Execute interactively step-by-step
    const { state: initial } = createGame({ seed, currentTimeMs: 0 });
    let manual = initial;
    for (const a of actions) {
      if (a.type === 'MOVE') {
        manual = applyMove(manual, a.direction, a.timestampMs).state;
      } else if (a.type === 'TIME_BOOST') {
        manual = applyTimeBoost(manual, a.timestampMs).state;
      } else if (a.type === 'UNDO') {
        const res = undo(manual, a.timestampMs);
        if (res) manual = res.state;
      }
    }

    // 2. Execute via batch replay() function
    const replayed = replay(seed, actions, 0);

    expect(Array.from(replayed.board)).toEqual(Array.from(manual.board));
    expect(replayed.score).toBe(manual.score);
    expect(replayed.bestScore).toBe(manual.bestScore);
    expect(replayed.moveIndex).toBe(manual.moveIndex);
    expect(replayed.rngState).toBe(manual.rngState);
    expect(replayed.timeBoostsUsed).toBe(manual.timeBoostsUsed);
    expect(replayed.undosUsed).toBe(manual.undosUsed);
  });
});
