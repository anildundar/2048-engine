import {
  BOARD_CELL_COUNT,
  cloneBoard,
  createBoardFrom,
  getHighestTile,
} from './board.js';
import { executeMove } from './move.js';
import { createGame } from './engine.js';
import { sha256 } from './hash.js';
import type { Direction, GameState } from './types.js';

export const REPLAY_SCHEMA_VERSION = 1;
export const RULESET_VERSION = 'classic-v1';
export const DEFAULT_CHECKPOINT_CADENCE = 50;
export const MAX_REPLAY_EVENTS_LIMIT = 50_000;

export type ReplayEventType =
  | 'RUN_START'
  | 'MOVE'
  | 'PAUSE'
  | 'RESUME'
  | 'TIME_BOOST'
  | 'UNDO'
  | 'ASSISTED_TRANSITION'
  | 'RESCUE_TIMEOUT'
  | 'RESCUE_UNDO'
  | 'RUN_TERMINAL';

export interface ReplayExplicitSpawn {
  index: number;
  value: 2 | 4;
}

export interface ReplayEventV1 {
  type: ReplayEventType;
  t: number; // Milliseconds from run start
  dt?: number; // Milliseconds from previous event
  direction?: Direction; // For MOVE
  spawn?: ReplayExplicitSpawn | null; // Resulting spawn for valid move; null if board unchanged or no-op
  scoreDelta?: number; // Score gained in this move
  addedSeconds?: number; // For TIME_BOOST or RESCUE_TIMEOUT
  restoredMoveIndex?: number; // For UNDO
  restoredScore?: number; // For UNDO
  restoredBoard?: number[]; // For UNDO (optional checkpoint snapshot)
  pauseDurationMs?: number; // For RESUME
  reason?: string; // For RUN_TERMINAL or ASSISTED_TRANSITION
  finalScore?: number; // For RUN_TERMINAL
  finalHighestTile?: number; // For RUN_TERMINAL
  totalMoves?: number; // For RUN_TERMINAL
}

export interface ReplayCheckpointV1 {
  moveIndex: number;
  board: number[]; // 16 values
  score: number;
  highestTile: number;
  competitiveClass: 'PURE' | 'ASSISTED';
  boardHash: string;
  rngState?: number;
}

export interface ReplayFinalSummaryV1 {
  score: number;
  highestTile: number;
  totalMoves: number;
  durationMs: number;
  competitiveClass: 'PURE' | 'ASSISTED';
  terminalReason: 'GAME_OVER' | 'TIME_EXPIRED' | 'RESIGNED';
  finalBoard: number[];
  finalBoardHash: string;
}

export interface ReplayV1 {
  replaySchemaVersion: 1;
  engineVersion: string;
  rulesetVersion: string;
  runId: string;
  seed: number;
  mode: string;
  competitiveClassAtStart: 'PURE' | 'ASSISTED';
  startedAt: number;
  initialBoard: number[];
  events: ReplayEventV1[];
  checkpoints: ReplayCheckpointV1[];
  finalSummary: ReplayFinalSummaryV1;
}

/**
 * Computes a deterministic SHA-256 fingerprint for a board and state tuple.
 */
export function computeBoardHash(
  board: Uint16Array | number[],
  score: number,
  moveIndex: number,
  highestTile: number
): string {
  const boardArr = Array.isArray(board) ? board : Array.from(board);
  const payload = `v1:${boardArr.join(',')}:${score}:${moveIndex}:${highestTile}`;
  return sha256(payload);
}

export interface ReplayValidationResult {
  valid: boolean;
  error?: string;
  code?:
    | 'UNSUPPORTED_SCHEMA_VERSION'
    | 'UNSUPPORTED_ENGINE_VERSION'
    | 'UNSUPPORTED_RULESET_VERSION'
    | 'INVALID_METADATA'
    | 'INVALID_BOARD'
    | 'EXCESSIVE_EVENTS'
    | 'MALFORMED_EVENT';
}

/**
 * Pure fail-closed schema validator for Replay V1 payloads.
 */
export function validateReplayV1(raw: unknown): ReplayValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, code: 'INVALID_METADATA', error: 'Replay payload must be a non-null object' };
  }

  const replay = raw as Partial<ReplayV1>;

  if (replay.replaySchemaVersion !== REPLAY_SCHEMA_VERSION) {
    return {
      valid: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      error: `Unsupported replay schema version: ${String(replay.replaySchemaVersion)}. Expected ${REPLAY_SCHEMA_VERSION}`,
    };
  }

  if (typeof replay.engineVersion !== 'string' || !replay.engineVersion.trim()) {
    return { valid: false, code: 'UNSUPPORTED_ENGINE_VERSION', error: 'Missing or empty engineVersion' };
  }

  if (typeof replay.rulesetVersion !== 'string' || !replay.rulesetVersion.trim()) {
    return { valid: false, code: 'UNSUPPORTED_RULESET_VERSION', error: 'Missing or empty rulesetVersion' };
  }

  if (typeof replay.runId !== 'string' || !replay.runId.trim()) {
    return { valid: false, code: 'INVALID_METADATA', error: 'Invalid or missing runId' };
  }

  if (typeof replay.seed !== 'number' || !Number.isFinite(replay.seed)) {
    return { valid: false, code: 'INVALID_METADATA', error: 'Invalid seed: must be finite number' };
  }

  if (!Array.isArray(replay.initialBoard) || replay.initialBoard.length !== BOARD_CELL_COUNT) {
    return { valid: false, code: 'INVALID_BOARD', error: `Initial board must contain exactly ${BOARD_CELL_COUNT} numbers` };
  }

  if (!Array.isArray(replay.events)) {
    return { valid: false, code: 'INVALID_METADATA', error: 'events field must be an array' };
  }

  if (replay.events.length > MAX_REPLAY_EVENTS_LIMIT) {
    return {
      valid: false,
      code: 'EXCESSIVE_EVENTS',
      error: `Event count exceeds maximum allowed limit of ${MAX_REPLAY_EVENTS_LIMIT}`,
    };
  }

  for (let i = 0; i < replay.events.length; i++) {
    const ev = replay.events[i];
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string' || typeof ev.t !== 'number') {
      return { valid: false, code: 'MALFORMED_EVENT', error: `Event at index ${i} is missing required fields (type, t)` };
    }

    if (ev.type === 'MOVE') {
      if (!ev.direction || !['up', 'down', 'left', 'right'].includes(ev.direction)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid direction: ${String(ev.direction)}` };
      }
      if (ev.spawn) {
        if (typeof ev.spawn.index !== 'number' || ev.spawn.index < 0 || ev.spawn.index >= BOARD_CELL_COUNT) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn cell: ${String(ev.spawn?.index)}` };
        }
        if (ev.spawn.value !== 2 && ev.spawn.value !== 4) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn value: ${String(ev.spawn?.value)}` };
        }
      }
    }
  }

  return { valid: true };
}

export interface ReplayPlaybackResult {
  success: boolean;
  desyncDetected: boolean;
  finalState: GameState;
  desyncDetails?: {
    type: 'CHECKPOINT_MISMATCH' | 'FINAL_SCORE_MISMATCH' | 'FINAL_BOARD_MISMATCH' | 'SPAWN_MISMATCH';
    moveIndex: number;
    expected: unknown;
    actual: unknown;
    message: string;
  };
  matchedCheckpointsCount: number;
}

/**
 * Executes a deterministic playback of a Replay V1 payload, validating explicit spawns
 * and periodic checkpoints along the trajectory.
 */
export function playReplayV1(
  replay: ReplayV1,
  options?: { stopAtMoveIndex?: number }
): ReplayPlaybackResult {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot play invalid replay: ${validation.error}`);
  }

  // Initialize game state with provided initial board & seed
  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  const board = createBoardFrom(replay.initialBoard);

  let current: GameState = {
    ...initial,
    board,
    score: 0,
    bestScore: 0,
    moveIndex: 0,
  };

  let matchedCheckpointsCount = 0;
  const checkpointsMap = new Map<number, ReplayCheckpointV1>();
  for (const cp of replay.checkpoints || []) {
    checkpointsMap.set(cp.moveIndex, cp);
  }

  // History stack for exact undo reconstruction during replay
  const localHistory: { board: Uint16Array; score: number; moveIndex: number }[] = [];

  for (const event of replay.events) {
    if (options?.stopAtMoveIndex !== undefined && current.moveIndex >= options.stopAtMoveIndex) {
      break;
    }

    if (event.type === 'MOVE' && event.direction) {
      // 1. Save pre-move snapshot for potential undo
      localHistory.push({
        board: cloneBoard(current.board),
        score: current.score,
        moveIndex: current.moveIndex,
      });

      // 2. Execute move shift & merge
      const moveRes = executeMove(current.board, event.direction);

      if (moveRes.changed) {
        // Apply explicit resulting spawn if recorded
        if (event.spawn) {
          if (moveRes.board[event.spawn.index] !== 0) {
            return {
              success: false,
              desyncDetected: true,
              finalState: current,
              matchedCheckpointsCount,
              desyncDetails: {
                type: 'SPAWN_MISMATCH',
                moveIndex: current.moveIndex + 1,
                expected: `cell ${event.spawn.index} empty`,
                actual: `cell occupied by ${moveRes.board[event.spawn.index]}`,
                message: `Desync: explicit spawn into non-empty cell ${event.spawn.index}`,
              },
            };
          }
          moveRes.board[event.spawn.index] = event.spawn.value;
        }

        const nextScore = current.score + moveRes.scoreDelta;
        current = {
          ...current,
          board: moveRes.board,
          score: nextScore,
          bestScore: Math.max(current.bestScore, nextScore),
          moveIndex: current.moveIndex + 1,
        };

        // 3. Verify periodic checkpoint if present at this moveIndex
        const cp = checkpointsMap.get(current.moveIndex);
        if (cp) {
          const currentHash = computeBoardHash(
            current.board,
            current.score,
            current.moveIndex,
            getHighestTile(current.board)
          );

          if (currentHash !== cp.boardHash || current.score !== cp.score) {
            return {
              success: false,
              desyncDetected: true,
              finalState: current,
              matchedCheckpointsCount,
              desyncDetails: {
                type: 'CHECKPOINT_MISMATCH',
                moveIndex: current.moveIndex,
                expected: cp.boardHash,
                actual: currentHash,
                message: `Desync at move ${current.moveIndex}: board hash or score does not match checkpoint`,
              },
            };
          }
          matchedCheckpointsCount++;
        }
      } else {
        // No-op move: pop unused snapshot
        localHistory.pop();
      }
    } else if (event.type === 'UNDO') {
      // Revert to prior move snapshot
      const prior = localHistory.pop();
      if (prior) {
        current = {
          ...current,
          board: prior.board,
          score: prior.score,
          moveIndex: prior.moveIndex,
          undosUsed: current.undosUsed + 1,
        };
      } else if (event.restoredBoard && event.restoredScore !== undefined && event.restoredMoveIndex !== undefined) {
        current = {
          ...current,
          board: createBoardFrom(event.restoredBoard),
          score: event.restoredScore,
          moveIndex: event.restoredMoveIndex,
          undosUsed: current.undosUsed + 1,
        };
      }
    } else if (event.type === 'TIME_BOOST' || event.type === 'RESCUE_TIMEOUT') {
      current = {
        ...current,
        timeBoostsUsed: current.timeBoostsUsed + 1,
      };
    }
  }

  // Verify final summary if we reached full completion (no stopAtMoveIndex)
  if (options?.stopAtMoveIndex === undefined && replay.finalSummary) {
    if (replay.finalSummary.score !== current.score) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_SCORE_MISMATCH',
          moveIndex: current.moveIndex,
          expected: replay.finalSummary.score,
          actual: current.score,
          message: `Desync at completion: expected final score ${replay.finalSummary.score}, got ${current.score}`,
        },
      };
    }

    const finalHighest = getHighestTile(current.board);
    if (replay.finalSummary.highestTile !== finalHighest) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_BOARD_MISMATCH',
          moveIndex: current.moveIndex,
          expected: `highest tile ${replay.finalSummary.highestTile}`,
          actual: `highest tile ${finalHighest}`,
          message: `Desync at completion: highest tile mismatch`,
        },
      };
    }
  }

  return {
    success: true,
    desyncDetected: false,
    finalState: current,
    matchedCheckpointsCount,
  };
}

export interface ReplayPlayerInstance {
  getCurrentState(): GameState;
  getCurrentMoveIndex(): number;
  getCurrentEventIndex(): number;
  stepForward(): boolean;
  seekToMoveIndex(targetMoveIndex: number): boolean;
  isAtEnd(): boolean;
  getReplay(): ReplayV1;
}

/**
 * Creates an interactive stepping/seeking pure replay player instance.
 */
export function createReplayPlayerV1(replay: ReplayV1): ReplayPlayerInstance {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot create player for invalid replay: ${validation.error}`);
  }

  const checkpointsMap = new Map<number, ReplayCheckpointV1>();
  for (const cp of replay.checkpoints || []) {
    checkpointsMap.set(cp.moveIndex, cp);
  }

  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  let currentState: GameState = {
    ...initial,
    board: createBoardFrom(replay.initialBoard),
    score: 0,
    bestScore: 0,
    moveIndex: 0,
  };

  let currentEventIndex = 0;
  const history: { board: Uint16Array; score: number; moveIndex: number }[] = [];

  function stepForward(): boolean {
    if (currentEventIndex >= replay.events.length) {
      return false;
    }

    const event = replay.events[currentEventIndex];
    currentEventIndex++;

    if (event.type === 'MOVE' && event.direction) {
      history.push({
        board: cloneBoard(currentState.board),
        score: currentState.score,
        moveIndex: currentState.moveIndex,
      });

      const moveRes = executeMove(currentState.board, event.direction);
      if (moveRes.changed) {
        if (event.spawn && moveRes.board[event.spawn.index] === 0) {
          moveRes.board[event.spawn.index] = event.spawn.value;
        }
        const nextScore = currentState.score + moveRes.scoreDelta;
        currentState = {
          ...currentState,
          board: moveRes.board,
          score: nextScore,
          bestScore: Math.max(currentState.bestScore, nextScore),
          moveIndex: currentState.moveIndex + 1,
        };
      } else {
        history.pop();
      }
    } else if (event.type === 'UNDO') {
      const prior = history.pop();
      if (prior) {
        currentState = {
          ...currentState,
          board: prior.board,
          score: prior.score,
          moveIndex: prior.moveIndex,
          undosUsed: currentState.undosUsed + 1,
        };
      }
    } else if (event.type === 'TIME_BOOST' || event.type === 'RESCUE_TIMEOUT') {
      currentState = {
        ...currentState,
        timeBoostsUsed: currentState.timeBoostsUsed + 1,
      };
    }

    return true;
  }

  function seekToMoveIndex(targetMoveIndex: number): boolean {
    if (targetMoveIndex < 0) return false;

    // Find closest prior checkpoint
    let bestCheckpoint: ReplayCheckpointV1 | null = null;
    for (const cp of replay.checkpoints || []) {
      if (cp.moveIndex <= targetMoveIndex) {
        if (!bestCheckpoint || cp.moveIndex > bestCheckpoint.moveIndex) {
          bestCheckpoint = cp;
        }
      }
    }

    if (bestCheckpoint) {
      currentState = {
        ...currentState,
        board: createBoardFrom(bestCheckpoint.board),
        score: bestCheckpoint.score,
        moveIndex: bestCheckpoint.moveIndex,
      };
      // Find event index corresponding to this moveIndex
      let movesSeen = 0;
      currentEventIndex = 0;
      for (let i = 0; i < replay.events.length; i++) {
        if (movesSeen >= bestCheckpoint.moveIndex) {
          currentEventIndex = i;
          break;
        }
        if (replay.events[i].type === 'MOVE') {
          movesSeen++;
        }
      }
    } else {
      // Reset to beginning
      currentState = {
        ...initial,
        board: createBoardFrom(replay.initialBoard),
        score: 0,
        bestScore: 0,
        moveIndex: 0,
      };
      currentEventIndex = 0;
    }

    // Advance forward until targetMoveIndex reached
    while (currentState.moveIndex < targetMoveIndex && stepForward()) {
      // Advancing
    }

    return true;
  }

  return {
    getCurrentState: () => currentState,
    getCurrentMoveIndex: () => currentState.moveIndex,
    getCurrentEventIndex: () => currentEventIndex,
    stepForward,
    seekToMoveIndex,
    isAtEnd: () => currentEventIndex >= replay.events.length,
    getReplay: () => replay,
  };
}
