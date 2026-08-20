// Public Engine API
export { createGame, applyMove, evaluateTime, applyTimeBoost, undo, replay, DEFAULT_GAME_CONFIG } from './engine.js';
export { hashState, sha256, getCanonicalStateFingerprint, ENGINE_VERSION } from './hash.js';
export {
  createEmptyBoard,
  createBoardFrom,
  cloneBoard,
  boardsEqual,
  toIndex,
  toCoords,
  getEmptyCellIndices,
  hasEmptyCell,
  hasAvailableMerge,
  isGameOver,
  getHighestTile,
  BOARD_SIZE,
  BOARD_CELL_COUNT,
} from './board.js';
export { executeMove } from './move.js';
export { initPRNG, nextPRNG, nextInt, chooseRandomEmptyCell, determineSpawnValue } from './prng.js';
export {
  createTimerState,
  getTierDuration,
  resetTimerOnValidMove,
  applyTimeBoostToTimer,
  evaluateTimer,
  DEFAULT_TIMER_CONFIG,
} from './timer.js';
export { createUndoSnapshot, pushHistory, popHistory } from './undo.js';
export { serializeGameState, deserializeGameState, CURRENT_SERIALIZATION_VERSION } from './serialization.js';

// Types
export type {
  Direction,
  GameStatus,
  MovedTile,
  MergedTile,
  SpawnedTile,
  MoveResult,
  TimerConfig,
  TimerState,
  GameConfig,
  UndoSnapshot,
  GameState,
  GameEventType,
  GameEvent,
  SerializedTimerState,
  SerializedUndoSnapshot,
  SerializedGameState,
  ReplayAction,
} from './types.js';
export type { PRNGResult } from './prng.js';
