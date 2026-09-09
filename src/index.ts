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
export {
  REPLAY_SCHEMA_VERSION,
  RULESET_VERSION,
  DEFAULT_CHECKPOINT_CADENCE,
  MAX_REPLAY_EVENTS_LIMIT,
  MAX_REPLAY_CHECKPOINTS_LIMIT,
  MAX_REPLAY_SERIALIZED_BYTES_LIMIT,
  computeBoardHash,
  validateReplayV1,
  playReplayV1,
  createReplayPlayerV1,
} from './replay.js';

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
export type {
  ReplayEventType,
  ReplayExplicitSpawn,
  ReplayEventV1,
  ReplayCheckpointV1,
  ReplayFinalSummaryV1,
  ReplayV1,
  ReplayValidationResult,
  ReplayValidationErrorCode,
  ReplayDesyncType,
  ReplayPlaybackState,
  ReplayPlaybackResult,
  ReplayPlayerInstance,
} from './replay.js';
export type { PRNGResult } from './prng.js';
