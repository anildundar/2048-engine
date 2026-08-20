import { createBoardFrom } from './board.js';
import type { GameState, SerializedGameState, SerializedUndoSnapshot, UndoSnapshot } from './types.js';

export const CURRENT_SERIALIZATION_VERSION = 1;

/**
 * Serializes canonical GameState into a versioned JSON string.
 */
export function serializeGameState(state: GameState): string {
  const serialized: SerializedGameState = {
    version: CURRENT_SERIALIZATION_VERSION,
    board: Array.from(state.board),
    score: state.score,
    bestScore: state.bestScore,
    moveIndex: state.moveIndex,
    status: state.status,
    rngState: state.rngState,
    timer: { ...state.timer },
    history: state.history.map((snapshot) => ({
      board: Array.from(snapshot.board),
      score: snapshot.score,
      moveIndex: snapshot.moveIndex,
      status: snapshot.status,
      rngState: snapshot.rngState,
      timer: { ...snapshot.timer },
    })),
    timeBoostsUsed: state.timeBoostsUsed,
    undosUsed: state.undosUsed,
    config: { ...state.config },
  };

  return JSON.stringify(serialized);
}

/**
 * Deserializes and validates JSON string into canonical GameState.
 */
export function deserializeGameState(jsonString: string): GameState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(`Failed to parse game state JSON: ${String(err)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid game state format: expected an object');
  }

  const obj = parsed as Record<string, unknown>;

  if (obj.version !== CURRENT_SERIALIZATION_VERSION) {
    throw new Error(
      `Unsupported serialization version: ${String(obj.version)}. Expected ${CURRENT_SERIALIZATION_VERSION}`
    );
  }

  if (!Array.isArray(obj.board) || obj.board.length !== 16) {
    throw new Error('Invalid game state: board must be an array of 16 numbers');
  }

  const board = createBoardFrom(obj.board as number[]);

  if (typeof obj.score !== 'number' || typeof obj.moveIndex !== 'number') {
    throw new Error('Invalid game state: score and moveIndex must be numbers');
  }

  const history: UndoSnapshot[] = [];
  if (Array.isArray(obj.history)) {
    for (const snap of obj.history as SerializedUndoSnapshot[]) {
      if (!snap || !Array.isArray(snap.board) || snap.board.length !== 16) {
        throw new Error('Invalid history entry in serialized state');
      }
      history.push({
        board: createBoardFrom(snap.board),
        score: snap.score,
        moveIndex: snap.moveIndex,
        status: snap.status,
        rngState: snap.rngState,
        timer: { ...snap.timer },
      });
    }
  }

  return {
    board,
    score: obj.score as number,
    bestScore: typeof obj.bestScore === 'number' ? obj.bestScore : (obj.score as number),
    moveIndex: obj.moveIndex as number,
    status: (obj.status as GameState['status']) || 'ACTIVE',
    rngState: typeof obj.rngState === 'number' ? obj.rngState : 1,
    timer: obj.timer as GameState['timer'],
    history,
    timeBoostsUsed: typeof obj.timeBoostsUsed === 'number' ? obj.timeBoostsUsed : 0,
    undosUsed: typeof obj.undosUsed === 'number' ? obj.undosUsed : 0,
    config: obj.config as GameState['config'],
  };
}
