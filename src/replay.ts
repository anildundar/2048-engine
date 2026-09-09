import {
  BOARD_CELL_COUNT,
  cloneBoard,
  createBoardFrom,
  getHighestTile,
  isGameOver,
} from './board.js';
import { executeMove } from './move.js';
import { createGame } from './engine.js';
import { ENGINE_VERSION, sha256 } from './hash.js';
import {
  getAdaptiveTimerMaxCapMs,
  getAdaptiveTimerStageBaseMs,
} from './timer.js';
import type { Direction, GameStatus, TimerState } from './types.js';

export const REPLAY_SCHEMA_VERSION = 1;
export const RULESET_VERSION = 'classic-v1';
export const DEFAULT_CHECKPOINT_CADENCE = 50;
export const MAX_REPLAY_EVENTS_LIMIT = 50_000;
export const MAX_REPLAY_CHECKPOINTS_LIMIT = 2_000;
export const MAX_REPLAY_SERIALIZED_BYTES_LIMIT = 1_500_000; // 1.5MB ceiling

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
  t: number; // Milliseconds from run start (monotonic)
  dt?: number; // Milliseconds from previous event
  direction?: Direction; // For MOVE
  spawn?: ReplayExplicitSpawn | null; // Resulting spawn for valid move; null if no-op
  scoreDelta?: number; // Score gained in this move
  addedSeconds?: number; // For TIME_BOOST or RESCUE_TIMEOUT (canonical 5s)
  restoredMoveIndex?: number; // For UNDO
  restoredScore?: number; // For UNDO
  restoredBoard?: number[]; // For UNDO (optional snapshot)
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
  boardHash: string; // 64-char SHA-256 hex
  rngState?: number;
  eventIndex?: number; // Canonical event cursor position
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
 * Computes deterministic SHA-256 fingerprint for a board and state tuple.
 * Note: Replay hash provides deterministic sync detection, NOT cryptographic rank authority.
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

export type ReplayValidationErrorCode =
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'UNSUPPORTED_ENGINE_VERSION'
  | 'UNSUPPORTED_RULESET_VERSION'
  | 'INVALID_METADATA'
  | 'INVALID_BOARD'
  | 'EXCESSIVE_EVENTS'
  | 'EXCESSIVE_CHECKPOINTS'
  | 'MALFORMED_EVENT'
  | 'MALFORMED_CHECKPOINT'
  | 'MALFORMED_FINAL_SUMMARY';

export interface ReplayValidationResult {
  valid: boolean;
  error?: string;
  code?: ReplayValidationErrorCode;
}

const VALID_EVENT_TYPES = new Set<ReplayEventType>([
  'RUN_START',
  'MOVE',
  'PAUSE',
  'RESUME',
  'TIME_BOOST',
  'UNDO',
  'ASSISTED_TRANSITION',
  'RESCUE_TIMEOUT',
  'RESCUE_UNDO',
  'RUN_TERMINAL',
]);

const SHA256_HEX_REGEX = /^[0-9a-fA-F]{64}$/;

function isValidBoardArray(arr: unknown): arr is number[] {
  if (!Array.isArray(arr) || arr.length !== BOARD_CELL_COUNT) return false;
  return arr.every(
    (val) => typeof val === 'number' && Number.isFinite(val) && val >= 0 && (val === 0 || (val & (val - 1)) === 0)
  );
}

/**
 * Strict fail-closed schema and contract validator for Replay V1 payloads.
 */
export function validateReplayV1(raw: unknown): ReplayValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, code: 'INVALID_METADATA', error: 'Replay payload must be a non-null object' };
  }

  const replay = raw as Partial<ReplayV1>;

  // 1. Version Compatibility (Strict Fail-Closed)
  if (replay.replaySchemaVersion !== REPLAY_SCHEMA_VERSION) {
    return {
      valid: false,
      code: 'UNSUPPORTED_SCHEMA_VERSION',
      error: `Unsupported replay schema version: ${String(replay.replaySchemaVersion)}. Expected ${REPLAY_SCHEMA_VERSION}`,
    };
  }

  if (replay.engineVersion !== ENGINE_VERSION) {
    return {
      valid: false,
      code: 'UNSUPPORTED_ENGINE_VERSION',
      error: `Unsupported engineVersion: '${String(replay.engineVersion)}'. Expected '${ENGINE_VERSION}'`,
    };
  }

  if (replay.rulesetVersion !== RULESET_VERSION) {
    return {
      valid: false,
      code: 'UNSUPPORTED_RULESET_VERSION',
      error: `Unsupported rulesetVersion: '${String(replay.rulesetVersion)}'. Expected '${RULESET_VERSION}'`,
    };
  }

  // 2. Metadata Integrity
  if (typeof replay.runId !== 'string' || !replay.runId.trim()) {
    return { valid: false, code: 'INVALID_METADATA', error: 'Invalid or missing runId' };
  }

  if (typeof replay.seed !== 'number' || !Number.isFinite(replay.seed)) {
    return { valid: false, code: 'INVALID_METADATA', error: 'Invalid seed: must be finite number' };
  }

  if (typeof replay.mode !== 'string' || !replay.mode.trim()) {
    return { valid: false, code: 'INVALID_METADATA', error: 'Invalid or missing mode' };
  }

  if (replay.competitiveClassAtStart !== 'PURE' && replay.competitiveClassAtStart !== 'ASSISTED') {
    return { valid: false, code: 'INVALID_METADATA', error: 'competitiveClassAtStart must be PURE or ASSISTED' };
  }

  if (typeof replay.startedAt !== 'number' || !Number.isFinite(replay.startedAt) || replay.startedAt < 0) {
    return { valid: false, code: 'INVALID_METADATA', error: 'startedAt must be a non-negative finite timestamp' };
  }

  // 3. Initial Board Integrity
  if (!isValidBoardArray(replay.initialBoard)) {
    return {
      valid: false,
      code: 'INVALID_BOARD',
      error: `Initial board must contain exactly ${BOARD_CELL_COUNT} valid tile values`,
    };
  }

  // 4. Events Array & Limits
  if (!Array.isArray(replay.events)) {
    return { valid: false, code: 'INVALID_METADATA', error: 'events field must be an array' };
  }

  if (replay.events.length > MAX_REPLAY_EVENTS_LIMIT) {
    return {
      valid: false,
      code: 'EXCESSIVE_EVENTS',
      error: `Event count (${replay.events.length}) exceeds maximum limit (${MAX_REPLAY_EVENTS_LIMIT})`,
    };
  }

  let lastT = 0;
  for (let i = 0; i < replay.events.length; i++) {
    const ev = replay.events[i];
    if (!ev || typeof ev !== 'object') {
      return { valid: false, code: 'MALFORMED_EVENT', error: `Event at index ${i} is not an object` };
    }

    if (!VALID_EVENT_TYPES.has(ev.type)) {
      return { valid: false, code: 'MALFORMED_EVENT', error: `Event at index ${i} has unknown type: '${String(ev.type)}'` };
    }

    if (typeof ev.t !== 'number' || !Number.isFinite(ev.t) || ev.t < 0) {
      return { valid: false, code: 'MALFORMED_EVENT', error: `Event at index ${i} has non-finite or negative timestamp t` };
    }

    // Monotonic timestamp check (events must not go backward in time)
    if (ev.t < lastT) {
      return {
        valid: false,
        code: 'MALFORMED_EVENT',
        error: `Event at index ${i} timestamp ${ev.t} is less than prior timestamp ${lastT} (non-monotonic)`,
      };
    }
    lastT = ev.t;

    if (ev.dt !== undefined && (typeof ev.dt !== 'number' || !Number.isFinite(ev.dt) || ev.dt < 0)) {
      return { valid: false, code: 'MALFORMED_EVENT', error: `Event at index ${i} has invalid delta time dt` };
    }

    if (ev.type === 'MOVE') {
      if (!ev.direction || !['up', 'down', 'left', 'right'].includes(ev.direction)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid direction: ${String(ev.direction)}` };
      }
      if (ev.scoreDelta !== undefined && (typeof ev.scoreDelta !== 'number' || !Number.isFinite(ev.scoreDelta) || ev.scoreDelta < 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has negative or invalid scoreDelta` };
      }
      if (ev.spawn) {
        if (typeof ev.spawn.index !== 'number' || ev.spawn.index < 0 || ev.spawn.index >= BOARD_CELL_COUNT) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn cell: ${String(ev.spawn?.index)}` };
        }
        if (ev.spawn.value !== 2 && ev.spawn.value !== 4) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn value: ${String(ev.spawn?.value)}` };
        }
      }
    } else if (ev.type === 'TIME_BOOST' || ev.type === 'RESCUE_TIMEOUT') {
      // Schema V1 requires addedSeconds to be exactly 5 if specified (§3, §16)
      if (ev.addedSeconds !== undefined && ev.addedSeconds !== 5) {
        return {
          valid: false,
          code: 'MALFORMED_EVENT',
          error: `${ev.type} at index ${i} must have addedSeconds === 5 (got ${String(ev.addedSeconds)})`,
        };
      }
    } else if (ev.type === 'RESUME') {
      if (ev.pauseDurationMs !== undefined && (typeof ev.pauseDurationMs !== 'number' || !Number.isFinite(ev.pauseDurationMs) || ev.pauseDurationMs < 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `RESUME at index ${i} has negative or invalid pauseDurationMs` };
      }
    } else if (ev.type === 'UNDO') {
      if (ev.restoredMoveIndex !== undefined && (typeof ev.restoredMoveIndex !== 'number' || ev.restoredMoveIndex < 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `UNDO event at index ${i} has invalid restoredMoveIndex` };
      }
      if (ev.restoredScore !== undefined && (typeof ev.restoredScore !== 'number' || ev.restoredScore < 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `UNDO event at index ${i} has invalid restoredScore` };
      }
      if (ev.restoredBoard && !isValidBoardArray(ev.restoredBoard)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `UNDO event at index ${i} has invalid restoredBoard` };
      }
    } else if (ev.type === 'RUN_TERMINAL') {
      if (ev.reason && !['GAME_OVER', 'TIME_EXPIRED', 'RESIGNED'].includes(ev.reason)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `RUN_TERMINAL at index ${i} has invalid reason: ${String(ev.reason)}` };
      }
    }
  }

  // 5. Checkpoints Array & Hex Validation (§11, §15)
  if (!Array.isArray(replay.checkpoints)) {
    return { valid: false, code: 'INVALID_METADATA', error: 'checkpoints field must be an array' };
  }

  if (replay.checkpoints.length > MAX_REPLAY_CHECKPOINTS_LIMIT) {
    return {
      valid: false,
      code: 'EXCESSIVE_CHECKPOINTS',
      error: `Checkpoint count (${replay.checkpoints.length}) exceeds limit (${MAX_REPLAY_CHECKPOINTS_LIMIT})`,
    };
  }

  let lastCheckpointEventIndex = -1;
  for (let j = 0; j < replay.checkpoints.length; j++) {
    const cp = replay.checkpoints[j];
    if (!cp || typeof cp !== 'object') {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} is not an object` };
    }
    if (typeof cp.moveIndex !== 'number' || cp.moveIndex < 0) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid moveIndex` };
    }

    // Checkpoint timeline ordering: eventIndex must be strictly increasing if provided
    if (cp.eventIndex !== undefined) {
      if (typeof cp.eventIndex !== 'number' || cp.eventIndex <= lastCheckpointEventIndex) {
        return {
          valid: false,
          code: 'MALFORMED_CHECKPOINT',
          error: `Checkpoint at index ${j} eventIndex (${cp.eventIndex}) is not strictly increasing`,
        };
      }
      lastCheckpointEventIndex = cp.eventIndex;
    }

    if (!isValidBoardArray(cp.board)) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid board` };
    }
    if (typeof cp.score !== 'number' || cp.score < 0) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid score` };
    }
    if (typeof cp.highestTile !== 'number' || cp.highestTile < 0) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid highestTile` };
    }
    if (cp.competitiveClass !== 'PURE' && cp.competitiveClass !== 'ASSISTED') {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid competitiveClass` };
    }

    // Strict SHA-256 Hex validation (§15)
    if (typeof cp.boardHash !== 'string' || !SHA256_HEX_REGEX.test(cp.boardHash)) {
      return {
        valid: false,
        code: 'MALFORMED_CHECKPOINT',
        error: `Checkpoint at index ${j} has invalid boardHash (must be valid 64-char lowercase/uppercase hex)`,
      };
    }
  }

  // 6. Final Summary Integrity & Hex Validation (§15)
  if (!replay.finalSummary || typeof replay.finalSummary !== 'object') {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'Missing or malformed finalSummary' };
  }

  const fs = replay.finalSummary;
  if (!isValidBoardArray(fs.finalBoard)) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid finalBoard' };
  }
  if (typeof fs.finalBoardHash !== 'string' || !SHA256_HEX_REGEX.test(fs.finalBoardHash)) {
    return {
      valid: false,
      code: 'MALFORMED_FINAL_SUMMARY',
      error: 'finalSummary has invalid finalBoardHash (must be valid 64-char hex)',
    };
  }
  if (typeof fs.score !== 'number' || fs.score < 0) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid score' };
  }
  if (typeof fs.highestTile !== 'number' || fs.highestTile < 0) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid highestTile' };
  }
  if (typeof fs.totalMoves !== 'number' || fs.totalMoves < 0) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid totalMoves' };
  }
  if (typeof fs.durationMs !== 'number' || fs.durationMs < 0) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid durationMs' };
  }
  if (fs.competitiveClass !== 'PURE' && fs.competitiveClass !== 'ASSISTED') {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid competitiveClass' };
  }
  if (!['GAME_OVER', 'TIME_EXPIRED', 'RESIGNED'].includes(fs.terminalReason)) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: `finalSummary has invalid terminalReason: ${String(fs.terminalReason)}` };
  }

  return { valid: true };
}

export type ReplayDesyncType =
  | 'CHECKPOINT_MISMATCH'
  | 'SPAWN_MISMATCH'
  | 'FINAL_SCORE_MISMATCH'
  | 'FINAL_BOARD_MISMATCH'
  | 'FINAL_BOARD_HASH_MISMATCH'
  | 'FINAL_HIGHEST_TILE_MISMATCH'
  | 'FINAL_MOVE_COUNT_MISMATCH'
  | 'FINAL_COMPETITIVE_CLASS_MISMATCH'
  | 'FINAL_TERMINAL_REASON_MISMATCH';

export interface ReplayPlaybackState {
  board: Uint16Array;
  score: number;
  bestScore: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: TimerState;
  competitiveClass: 'PURE' | 'ASSISTED';
  undosUsed: number;
  timeBoostsUsed: number;
  highestTileEver: number; // Monotonic highest tile reached in run (§2, §5)
  isPaused: boolean;
}

export interface FullUndoSnapshot {
  board: Uint16Array;
  score: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: TimerState;
  competitiveClass: 'PURE' | 'ASSISTED';
  highestTileEver: number;
  timeBoostsUsed: number;
  undosUsed: number;
}

export interface ReplayApplyResult {
  nextState: ReplayPlaybackState;
  spawnMismatch?: {
    moveIndex: number;
    expected: unknown;
    actual: unknown;
    message: string;
  };
}

/**
 * Pure canonical playback reducer (§13).
 * Single authoritative source of truth for all Replay V1 state mutations across
 * full playback, verification, and interactive stepping.
 */
export function applyReplayEventV1(
  current: ReplayPlaybackState,
  event: ReplayEventV1,
  history: FullUndoSnapshot[]
): ReplayApplyResult {
  switch (event.type) {
    case 'RUN_START':
      return { nextState: current };

    case 'MOVE': {
      if (!event.direction) return { nextState: current };

      const moveRes = executeMove(current.board, event.direction);
      if (moveRes.changed) {
        // 1. Save full pre-move snapshot to history
        history.push({
          board: cloneBoard(current.board),
          score: current.score,
          moveIndex: current.moveIndex,
          status: current.status,
          rngState: current.rngState,
          timer: { ...current.timer },
          competitiveClass: current.competitiveClass,
          highestTileEver: current.highestTileEver,
          timeBoostsUsed: current.timeBoostsUsed,
          undosUsed: current.undosUsed,
        });

        // 2. Apply explicit spawn if recorded
        if (event.spawn) {
          if (moveRes.board[event.spawn.index] !== 0) {
            return {
              nextState: current,
              spawnMismatch: {
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
        const nextMoveIndex = current.moveIndex + 1;
        const currentBoardHighest = getHighestTile(moveRes.board);
        const nextHighestTileEver = Math.max(current.highestTileEver, currentBoardHighest);

        // 3. Reset adaptive timer to the current stage base duration (§2, §4)
        const stageBaseMs = getAdaptiveTimerStageBaseMs(nextHighestTileEver);
        const nextTimer: TimerState = {
          durationMs: stageBaseMs,
          timeRemainingMs: stageBaseMs,
          currentTier: 1,
          deadlineTimestampMs: event.t + stageBaseMs,
        };

        const gameOver = isGameOver(moveRes.board);

        return {
          nextState: {
            ...current,
            board: moveRes.board,
            score: nextScore,
            bestScore: Math.max(current.bestScore, nextScore),
            moveIndex: nextMoveIndex,
            highestTileEver: nextHighestTileEver,
            timer: nextTimer,
            status: gameOver ? 'GAME_OVER' : 'ACTIVE',
          },
        };
      } else {
        // No-op move (§2, §4): board unchanged, moveIndex unchanged, timer NOT reset
        return { nextState: current };
      }
    }

    case 'PAUSE': {
      return {
        nextState: {
          ...current,
          isPaused: true,
        },
      };
    }

    case 'RESUME': {
      return {
        nextState: {
          ...current,
          isPaused: false,
        },
      };
    }

    case 'TIME_BOOST': {
      // Canonical +5s with adaptive cap (§3)
      const stageBaseMs = getAdaptiveTimerStageBaseMs(current.highestTileEver);
      const maxCapMs = getAdaptiveTimerMaxCapMs(stageBaseMs);
      const addedMs = (event.addedSeconds ?? 5) * 1000;
      const newRemainingMs = Math.min(maxCapMs, current.timer.timeRemainingMs + addedMs);

      return {
        nextState: {
          ...current,
          timeBoostsUsed: current.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          timer: {
            ...current.timer,
            timeRemainingMs: newRemainingMs,
            deadlineTimestampMs: event.t + newRemainingMs,
          },
        },
      };
    }

    case 'ASSISTED_TRANSITION': {
      return {
        nextState: {
          ...current,
          competitiveClass: 'ASSISTED',
        },
      };
    }

    case 'RESCUE_TIMEOUT': {
      // Timeout Rescue (§7): Reactivate timer with +5s, mark ASSISTED
      const stageBaseMs = getAdaptiveTimerStageBaseMs(current.highestTileEver);
      const maxCapMs = getAdaptiveTimerMaxCapMs(stageBaseMs);
      const addedMs = (event.addedSeconds ?? 5) * 1000;
      const newRemainingMs = Math.min(maxCapMs, addedMs);

      return {
        nextState: {
          ...current,
          timeBoostsUsed: current.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          status: 'ACTIVE',
          timer: {
            ...current.timer,
            timeRemainingMs: newRemainingMs,
            deadlineTimestampMs: event.t + newRemainingMs,
          },
        },
      };
    }

    case 'RESCUE_UNDO': {
      const prior = history.pop();
      if (prior) {
        return {
          nextState: {
            ...current,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            status: 'ACTIVE',
            highestTileEver: current.highestTileEver, // Monotonic invariant: never decreases!
            undosUsed: current.undosUsed + 1,
            competitiveClass: 'ASSISTED',
          },
        };
      }
      return {
        nextState: {
          ...current,
          undosUsed: current.undosUsed + 1,
          competitiveClass: 'ASSISTED',
        },
      };
    }

    case 'UNDO': {
      const prior = history.pop();
      if (prior) {
        return {
          nextState: {
            ...current,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            status: prior.status,
            highestTileEver: current.highestTileEver, // Monotonic invariant: never decreases!
            undosUsed: current.undosUsed + 1,
            competitiveClass:
              current.competitiveClass === 'ASSISTED' ? 'ASSISTED' : prior.competitiveClass,
          },
        };
      } else if (event.restoredBoard && event.restoredScore !== undefined && event.restoredMoveIndex !== undefined) {
        return {
          nextState: {
            ...current,
            board: createBoardFrom(event.restoredBoard),
            score: event.restoredScore,
            moveIndex: event.restoredMoveIndex,
            undosUsed: current.undosUsed + 1,
          },
        };
      }
      return {
        nextState: {
          ...current,
          undosUsed: current.undosUsed + 1,
        },
      };
    }

    case 'RUN_TERMINAL': {
      if (event.reason === 'TIME_EXPIRED') {
        return { nextState: { ...current, status: 'TIME_EXPIRED' } };
      } else if (event.reason === 'GAME_OVER') {
        return { nextState: { ...current, status: 'GAME_OVER' } };
      }
      return { nextState: current };
    }

    default:
      return { nextState: current };
  }
}

export interface ReplayPlaybackResult {
  success: boolean;
  desyncDetected: boolean;
  finalState: ReplayPlaybackState;
  desyncDetails?: {
    type: ReplayDesyncType;
    moveIndex: number;
    expected: unknown;
    actual: unknown;
    message: string;
  };
  matchedCheckpointsCount: number;
}

/**
 * Executes a deterministic playback of a Replay V1 payload via the canonical pure reducer.
 */
export function playReplayV1(
  replay: ReplayV1,
  options?: { stopAtMoveIndex?: number }
): ReplayPlaybackResult {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot play invalid replay: [${validation.code}] ${validation.error}`);
  }

  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  const board = createBoardFrom(replay.initialBoard);
  const initialHighest = getHighestTile(board);

  const initialTimerBaseMs = getAdaptiveTimerStageBaseMs(initialHighest);
  const initialTimer: TimerState = {
    durationMs: initialTimerBaseMs,
    timeRemainingMs: initialTimerBaseMs,
    currentTier: 1,
    deadlineTimestampMs: replay.startedAt + initialTimerBaseMs,
  };

  let current: ReplayPlaybackState = {
    board,
    score: 0,
    bestScore: 0,
    moveIndex: 0,
    status: 'ACTIVE',
    rngState: initial.rngState,
    timer: initialTimer,
    competitiveClass: replay.competitiveClassAtStart ?? 'PURE',
    undosUsed: 0,
    timeBoostsUsed: 0,
    highestTileEver: initialHighest,
    isPaused: false,
  };

  let matchedCheckpointsCount = 0;
  const checkpointsMap = new Map<number, ReplayCheckpointV1>();
  for (const cp of replay.checkpoints || []) {
    checkpointsMap.set(cp.moveIndex, cp);
  }

  const localHistory: FullUndoSnapshot[] = [];

  for (let eventIdx = 0; eventIdx < replay.events.length; eventIdx++) {
    const event = replay.events[eventIdx];

    if (options?.stopAtMoveIndex !== undefined && current.moveIndex >= options.stopAtMoveIndex) {
      break;
    }

    const { nextState, spawnMismatch } = applyReplayEventV1(current, event, localHistory);
    if (spawnMismatch) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'SPAWN_MISMATCH',
          moveIndex: spawnMismatch.moveIndex,
          expected: spawnMismatch.expected,
          actual: spawnMismatch.actual,
          message: spawnMismatch.message,
        },
      };
    }

    current = nextState;

    // Checkpoint validation after valid state-advancing move
    if (event.type === 'MOVE') {
      const cp = checkpointsMap.get(current.moveIndex);
      if (cp) {
        const currentHighest = getHighestTile(current.board);
        const currentHash = computeBoardHash(
          current.board,
          current.score,
          current.moveIndex,
          currentHighest
        );

        if (
          currentHash !== cp.boardHash ||
          current.score !== cp.score ||
          currentHighest !== cp.highestTile ||
          current.competitiveClass !== cp.competitiveClass
        ) {
          return {
            success: false,
            desyncDetected: true,
            finalState: current,
            matchedCheckpointsCount,
            desyncDetails: {
              type: 'CHECKPOINT_MISMATCH',
              moveIndex: current.moveIndex,
              expected: { hash: cp.boardHash, score: cp.score, compClass: cp.competitiveClass },
              actual: { hash: currentHash, score: current.score, compClass: current.competitiveClass },
              message: `Desync at move ${current.moveIndex}: checkpoint mismatch`,
            },
          };
        }
        matchedCheckpointsCount++;
      }
    }
  }

  // Comprehensive Final Summary Verification
  if (options?.stopAtMoveIndex === undefined && replay.finalSummary) {
    const fs = replay.finalSummary;

    // 1. Final Score
    if (fs.score !== current.score) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_SCORE_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.score,
          actual: current.score,
          message: `Desync at completion: expected final score ${fs.score}, got ${current.score}`,
        },
      };
    }

    // 2. Final Highest Tile
    const finalHighest = getHighestTile(current.board);
    if (fs.highestTile !== finalHighest) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_HIGHEST_TILE_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.highestTile,
          actual: finalHighest,
          message: `Desync at completion: expected highest tile ${fs.highestTile}, got ${finalHighest}`,
        },
      };
    }

    // 3. Final Total Moves
    if (fs.totalMoves !== current.moveIndex) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_MOVE_COUNT_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.totalMoves,
          actual: current.moveIndex,
          message: `Desync at completion: expected move count ${fs.totalMoves}, got ${current.moveIndex}`,
        },
      };
    }

    // 4. Final Competitive Class
    if (fs.competitiveClass !== current.competitiveClass) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_COMPETITIVE_CLASS_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.competitiveClass,
          actual: current.competitiveClass,
          message: `Desync at completion: expected competitiveClass ${fs.competitiveClass}, got ${current.competitiveClass}`,
        },
      };
    }

    // 5. Final Board Array
    const currentBoardArr = Array.from(current.board);
    const boardsMatch = fs.finalBoard.every((val, idx) => val === currentBoardArr[idx]);
    if (!boardsMatch) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_BOARD_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.finalBoard,
          actual: currentBoardArr,
          message: 'Desync at completion: final board does not match expected finalBoard',
        },
      };
    }

    // 6. Final Board Hash
    const computedFinalHash = computeBoardHash(
      current.board,
      current.score,
      current.moveIndex,
      finalHighest
    );
    if (fs.finalBoardHash !== computedFinalHash) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_BOARD_HASH_MISMATCH',
          moveIndex: current.moveIndex,
          expected: fs.finalBoardHash,
          actual: computedFinalHash,
          message: 'Desync at completion: final board hash does not match computed hash',
        },
      };
    }

    // 7. Terminal Reason
    if (fs.terminalReason === 'GAME_OVER' && !isGameOver(current.board)) {
      return {
        success: false,
        desyncDetected: true,
        finalState: current,
        matchedCheckpointsCount,
        desyncDetails: {
          type: 'FINAL_TERMINAL_REASON_MISMATCH',
          moveIndex: current.moveIndex,
          expected: 'GAME_OVER',
          actual: current.status,
          message: 'Desync: terminal reason GAME_OVER reported but board has valid moves',
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
  getCurrentState(): ReplayPlaybackState;
  getCurrentMoveIndex(): number;
  getCurrentEventIndex(): number;
  stepForward(): boolean;
  seekToMoveIndex(targetMoveIndex: number): boolean;
  isAtEnd(): boolean;
  getReplay(): ReplayV1;
}

/**
 * Creates an interactive stepping/seeking pure replay player instance.
 * Replays from start using the canonical reducer (Option 1: SEEK_STRATEGY = 'REPLAY_FROM_START'),
 * guaranteeing full semantic state preservation across all Undos, Time Boosts, and branches (§12, §13).
 */
export function createReplayPlayerV1(replay: ReplayV1): ReplayPlayerInstance {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot play invalid replay: [${validation.code}] ${validation.error}`);
  }

  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  const initialBoard = createBoardFrom(replay.initialBoard);
  const initialHighest = getHighestTile(initialBoard);
  const initialTimerBaseMs = getAdaptiveTimerStageBaseMs(initialHighest);

  const getInitialState = (): ReplayPlaybackState => ({
    board: createBoardFrom(replay.initialBoard),
    score: 0,
    bestScore: 0,
    moveIndex: 0,
    status: 'ACTIVE',
    rngState: initial.rngState,
    timer: {
      durationMs: initialTimerBaseMs,
      timeRemainingMs: initialTimerBaseMs,
      currentTier: 1,
      deadlineTimestampMs: replay.startedAt + initialTimerBaseMs,
    },
    competitiveClass: replay.competitiveClassAtStart ?? 'PURE',
    undosUsed: 0,
    timeBoostsUsed: 0,
    highestTileEver: initialHighest,
    isPaused: false,
  });

  let currentState: ReplayPlaybackState = getInitialState();
  let currentEventIndex = 0;
  const history: FullUndoSnapshot[] = [];

  function stepForward(): boolean {
    if (currentEventIndex >= replay.events.length) {
      return false;
    }

    const event = replay.events[currentEventIndex];
    currentEventIndex++;

    const { nextState } = applyReplayEventV1(currentState, event, history);
    currentState = nextState;
    return true;
  }

  function seekToMoveIndex(targetMoveIndex: number): boolean {
    if (targetMoveIndex < 0) return false;

    // Reset to start (SEEK_STRATEGY = 'REPLAY_FROM_START', §12)
    currentState = getInitialState();
    currentEventIndex = 0;
    history.length = 0;

    // Advance event by event until targetMoveIndex reached or end of events
    while (currentEventIndex < replay.events.length) {
      if (currentState.moveIndex >= targetMoveIndex && replay.events[currentEventIndex].type === 'MOVE') {
        break;
      }
      stepForward();
    }

    return true;
  }

  return {
    getCurrentState: () => ({ ...currentState }),
    getCurrentMoveIndex: () => currentState.moveIndex,
    getCurrentEventIndex: () => currentEventIndex,
    stepForward,
    seekToMoveIndex,
    isAtEnd: () => currentEventIndex >= replay.events.length,
    getReplay: () => replay,
  };
}
