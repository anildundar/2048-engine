import {
  cloneBoard,
  createEmptyBoard,
  getEmptyCellIndices,
  isGameOver,
  toCoords,
} from './board.js';
import { executeMove } from './move.js';
import { chooseRandomEmptyCell, determineSpawnValue, initPRNG } from './prng.js';
import {
  applyTimeBoostToTimer,
  createTimerState,
  DEFAULT_TIMER_CONFIG,
  evaluateTimer,
  resetTimerOnValidMove,
} from './timer.js';
import type {
  Direction,
  GameConfig,
  GameEvent,
  GameState,
  MoveResult,
  ReplayAction,
  SpawnedTile,
} from './types.js';
import { createUndoSnapshot, popHistory, pushHistory } from './undo.js';

export const DEFAULT_GAME_CONFIG: GameConfig = {
  timerConfig: DEFAULT_TIMER_CONFIG,
  maxUndoHistory: 10,
  p4Probability: 0.1,
};

/**
 * Initializes a new deterministic game with 2 initial spawned tiles.
 */
export function createGame(options?: {
  seed?: number;
  currentTimeMs?: number;
  config?: Partial<GameConfig>;
}): { state: GameState; spawned: SpawnedTile[] } {
  const seed = options?.seed ?? 1;
  const currentTimeMs = options?.currentTimeMs ?? 0;
  const config: GameConfig = {
    timerConfig: { ...DEFAULT_TIMER_CONFIG, ...options?.config?.timerConfig },
    maxUndoHistory: options?.config?.maxUndoHistory ?? DEFAULT_GAME_CONFIG.maxUndoHistory,
    p4Probability: options?.config?.p4Probability ?? DEFAULT_GAME_CONFIG.p4Probability,
  };

  let rngState = initPRNG(seed);
  const board = createEmptyBoard();
  const spawned: SpawnedTile[] = [];

  // Spawn initial 2 tiles
  for (let i = 0; i < 2; i++) {
    const emptyIndices = getEmptyCellIndices(board);
    const { cellIndex, nextState: s1 } = chooseRandomEmptyCell(rngState, emptyIndices);
    const { value, nextState: s2 } = determineSpawnValue(s1, config.p4Probability);
    rngState = s2;

    board[cellIndex] = value;
    const coords = toCoords(cellIndex);
    spawned.push({
      index: cellIndex,
      row: coords.row,
      col: coords.col,
      value,
    });
  }

  const timer = createTimerState(currentTimeMs, config.timerConfig);

  const state: GameState = {
    board,
    score: 0,
    bestScore: 0,
    moveIndex: 0,
    status: 'ACTIVE',
    rngState,
    timer,
    history: [],
    timeBoostsUsed: 0,
    undosUsed: 0,
    config,
  };

  return { state, spawned };
}

/**
 * Evaluates game timer against the provided timestamp.
 */
export function evaluateTime(
  state: GameState,
  currentTimeMs: number
): { state: GameState; event?: GameEvent } {
  if (state.status !== 'ACTIVE') {
    return { state };
  }

  const { isExpired, remainingMs } = evaluateTimer(state.timer, currentTimeMs);
  const updatedTimer = { ...state.timer, timeRemainingMs: remainingMs };

  if (isExpired) {
    const nextState: GameState = {
      ...state,
      status: 'TIME_EXPIRED',
      timer: updatedTimer,
    };
    const event: GameEvent = {
      type: 'TIME_EXPIRED',
      timestampMs: currentTimeMs,
      moveIndex: state.moveIndex,
      score: state.score,
      status: 'TIME_EXPIRED',
    };
    return { state: nextState, event };
  }

  return { state: { ...state, timer: updatedTimer } };
}

/**
 * Applies a move in the given direction.
 * Validates timer deadline, executes slide/merge, spawns new tile on success,
 * advances move index, and updates score/undo history.
 */
export function applyMove(
  state: GameState,
  direction: Direction,
  currentTimeMs = 0
): { state: GameState; result: MoveResult; event: GameEvent } {
  // If game is not active, moves are rejected
  if (state.status !== 'ACTIVE') {
    const noopResult: MoveResult = {
      changed: false,
      board: cloneBoard(state.board),
      scoreDelta: 0,
      movedTiles: [],
      merges: [],
      spawnedTile: null,
    };
    const event: GameEvent = {
      type: 'MOVE_INVALID',
      timestampMs: currentTimeMs,
      moveIndex: state.moveIndex,
      score: state.score,
      status: state.status,
      moveResult: noopResult,
    };
    return { state, result: noopResult, event };
  }

  // Check if timer expired before this move
  const timeEval = evaluateTime(state, currentTimeMs);
  if (timeEval.state.status === 'TIME_EXPIRED') {
    const noopResult: MoveResult = {
      changed: false,
      board: cloneBoard(state.board),
      scoreDelta: 0,
      movedTiles: [],
      merges: [],
      spawnedTile: null,
    };
    const event: GameEvent = {
      type: 'TIME_EXPIRED',
      timestampMs: currentTimeMs,
      moveIndex: state.moveIndex,
      score: state.score,
      status: 'TIME_EXPIRED',
      moveResult: noopResult,
    };
    return { state: timeEval.state, result: noopResult, event };
  }

  // Execute canonical 2048 slide & merge
  const moveResult = executeMove(state.board, direction);

  // If move produced no change, board remains untouched and timer does NOT reset
  if (!moveResult.changed) {
    const event: GameEvent = {
      type: 'MOVE_INVALID',
      timestampMs: currentTimeMs,
      moveIndex: state.moveIndex,
      score: state.score,
      status: state.status,
      moveResult,
    };
    return { state, result: moveResult, event };
  }

  // Save current state to undo history before applying the new move
  const snapshot = createUndoSnapshot(state);
  const nextHistory = pushHistory(state.history, snapshot, state.config.maxUndoHistory);

  // Deterministically spawn 1 new tile into an empty slot
  let nextRngState = state.rngState;
  const emptyIndices = getEmptyCellIndices(moveResult.board);

  if (emptyIndices.length > 0) {
    const { cellIndex, nextState: s1 } = chooseRandomEmptyCell(nextRngState, emptyIndices);
    const { value: spawnVal, nextState: s2 } = determineSpawnValue(s1, state.config.p4Probability);
    nextRngState = s2;

    moveResult.board[cellIndex] = spawnVal;
    const coords = toCoords(cellIndex);
    moveResult.spawnedTile = {
      index: cellIndex,
      row: coords.row,
      col: coords.col,
      value: spawnVal,
    };
  }

  const nextScore = state.score + moveResult.scoreDelta;
  const nextBestScore = Math.max(state.bestScore, nextScore);
  const nextMoveIndex = state.moveIndex + 1;

  // Reset timer on valid move
  const nextTimer = resetTimerOnValidMove(
    state.timer,
    currentTimeMs,
    state.timer.currentTier,
    state.config.timerConfig
  );

  // Check game over
  const gameOver = isGameOver(moveResult.board);
  const nextStatus = gameOver ? 'GAME_OVER' : 'ACTIVE';

  const nextState: GameState = {
    ...state,
    board: moveResult.board,
    score: nextScore,
    bestScore: nextBestScore,
    moveIndex: nextMoveIndex,
    status: nextStatus,
    rngState: nextRngState,
    timer: nextTimer,
    history: nextHistory,
  };

  const event: GameEvent = {
    type: gameOver ? 'GAME_OVER' : 'MOVE_APPLIED',
    timestampMs: currentTimeMs,
    moveIndex: nextMoveIndex,
    score: nextScore,
    status: nextStatus,
    moveResult,
  };

  return { state: nextState, result: moveResult, event };
}

/**
 * Applies a Time Boost to extend timer budget and restore ACTIVE status.
 */
export function applyTimeBoost(
  state: GameState,
  currentTimeMs: number
): { state: GameState; event: GameEvent } {
  if (state.status === 'GAME_OVER') {
    const event: GameEvent = {
      type: 'GAME_OVER',
      timestampMs: currentTimeMs,
      moveIndex: state.moveIndex,
      score: state.score,
      status: 'GAME_OVER',
    };
    return { state, event };
  }

  const updatedTimer = applyTimeBoostToTimer(state.timer, currentTimeMs, state.config.timerConfig);

  const nextState: GameState = {
    ...state,
    status: 'ACTIVE',
    timer: updatedTimer,
    timeBoostsUsed: state.timeBoostsUsed + 1,
  };

  const event: GameEvent = {
    type: 'TIME_BOOST_APPLIED',
    timestampMs: currentTimeMs,
    moveIndex: state.moveIndex,
    score: state.score,
    status: 'ACTIVE',
  };

  return { state: nextState, event };
}

/**
 * Reverts the most recent move, restoring exact deterministic game snapshot.
 * Preserves bestScore and external counters (undosUsed increments).
 */
export function undo(
  state: GameState,
  currentTimeMs: number
): { state: GameState; event: GameEvent } | null {
  const popResult = popHistory(state.history);
  if (!popResult) return null;

  const { restored, remainingHistory } = popResult;

  const nextState: GameState = {
    board: restored.board,
    score: restored.score,
    bestScore: state.bestScore,
    moveIndex: restored.moveIndex,
    status: restored.status,
    rngState: restored.rngState,
    timer: {
      ...restored.timer,
      deadlineTimestampMs: currentTimeMs + restored.timer.durationMs,
      timeRemainingMs: restored.timer.durationMs,
    },
    history: remainingHistory,
    timeBoostsUsed: state.timeBoostsUsed,
    undosUsed: state.undosUsed + 1,
    config: state.config,
  };

  const event: GameEvent = {
    type: 'UNDO_APPLIED',
    timestampMs: currentTimeMs,
    moveIndex: nextState.moveIndex,
    score: nextState.score,
    status: nextState.status,
  };

  return { state: nextState, event };
}

/**
 * Replays an ordered sequence of deterministic actions from seed and returns resulting GameState.
 */
export function replay(
  seed: number,
  actions: ReplayAction[],
  initialTimeMs = 0,
  config?: Partial<GameConfig>
): GameState {
  const { state: initial } = createGame({ seed, currentTimeMs: initialTimeMs, config });
  let current = initial;

  for (const action of actions) {
    if (action.type === 'MOVE') {
      const { state: next } = applyMove(current, action.direction, action.timestampMs);
      current = next;
    } else if (action.type === 'TIME_BOOST') {
      const { state: next } = applyTimeBoost(current, action.timestampMs);
      current = next;
    } else if (action.type === 'UNDO') {
      const undoResult = undo(current, action.timestampMs);
      if (undoResult) {
        current = undoResult.state;
      }
    }
  }

  return current;
}
