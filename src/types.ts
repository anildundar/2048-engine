export type Direction = 'up' | 'down' | 'left' | 'right';

export type GameStatus = 'ACTIVE' | 'TIME_EXPIRED' | 'GAME_OVER';

export interface MovedTile {
  fromIndex: number;
  toIndex: number;
  fromRow: number;
  fromCol: number;
  toRow: number;
  toCol: number;
  value: number;
}

export interface MergedTile {
  index: number;
  row: number;
  col: number;
  value: number;
  sourceIndices: [number, number];
}

export interface SpawnedTile {
  index: number;
  row: number;
  col: number;
  value: number;
}

export interface MoveResult {
  changed: boolean;
  board: Uint16Array;
  scoreDelta: number;
  movedTiles: MovedTile[];
  merges: MergedTile[];
  spawnedTile: SpawnedTile | null;
}

export interface TimerConfig {
  tier1DurationMs: number;
  tier2DurationMs: number;
  tier3DurationMs: number;
  timeBoostAmountMs: number;
}

export interface TimerState {
  deadlineTimestampMs: number;
  currentTier: number;
  durationMs: number;
  timeRemainingMs: number;
}

export interface GameConfig {
  timerConfig: TimerConfig;
  maxUndoHistory: number;
  p4Probability: number;
}

export interface UndoSnapshot {
  board: Uint16Array;
  score: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: TimerState;
}

export interface GameState {
  board: Uint16Array;
  score: number;
  bestScore: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: TimerState;
  history: UndoSnapshot[];
  timeBoostsUsed: number;
  undosUsed: number;
  config: GameConfig;
}

export type GameEventType =
  | 'GAME_INITIALIZED'
  | 'MOVE_APPLIED'
  | 'MOVE_INVALID'
  | 'TIME_EXPIRED'
  | 'TIME_BOOST_APPLIED'
  | 'UNDO_APPLIED'
  | 'GAME_OVER';

export interface GameEvent {
  type: GameEventType;
  timestampMs: number;
  moveIndex: number;
  score: number;
  status: GameStatus;
  moveResult?: MoveResult;
}

export interface SerializedTimerState {
  deadlineTimestampMs: number;
  currentTier: number;
  durationMs: number;
  timeRemainingMs: number;
}

export interface SerializedUndoSnapshot {
  board: number[];
  score: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: SerializedTimerState;
}

export interface SerializedGameState {
  version: 1;
  board: number[];
  score: number;
  bestScore: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: SerializedTimerState;
  history: SerializedUndoSnapshot[];
  timeBoostsUsed: number;
  undosUsed: number;
  config: GameConfig;
}

export type ReplayAction =
  | { type: 'MOVE'; direction: Direction; timestampMs: number }
  | { type: 'TIME_BOOST'; timestampMs: number }
  | { type: 'UNDO'; timestampMs: number };
