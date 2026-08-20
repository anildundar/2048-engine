import { cloneBoard } from './board.js';
import type { GameState, UndoSnapshot } from './types.js';

/**
 * Creates an immutable snapshot of current game state for undo history.
 */
export function createUndoSnapshot(state: GameState): UndoSnapshot {
  return {
    board: cloneBoard(state.board),
    score: state.score,
    moveIndex: state.moveIndex,
    status: state.status,
    rngState: state.rngState,
    timer: { ...state.timer },
  };
}

/**
 * Appends a new snapshot onto the bounded history stack.
 */
export function pushHistory(
  history: UndoSnapshot[],
  snapshot: UndoSnapshot,
  maxHistory = 10
): UndoSnapshot[] {
  const nextHistory = [...history, snapshot];
  if (nextHistory.length > maxHistory) {
    return nextHistory.slice(nextHistory.length - maxHistory);
  }
  return nextHistory;
}

/**
 * Pops the most recent snapshot from history.
 */
export function popHistory(
  history: UndoSnapshot[]
): { restored: UndoSnapshot; remainingHistory: UndoSnapshot[] } | null {
  if (history.length === 0) return null;
  const restored = history[history.length - 1];
  const remainingHistory = history.slice(0, history.length - 1);
  return { restored, remainingHistory };
}
