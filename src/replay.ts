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
import type { Direction, GameStatus, TimerState } from './types.js';

export const REPLAY_SCHEMA_VERSION = 1;
export const RULESET_VERSION = 'classic-v1';
export const DEFAULT_CHECKPOINT_CADENCE = 50;
export const MAX_REPLAY_EVENTS_LIMIT = 50_000;
export const MAX_REPLAY_CHECKPOINTS_LIMIT = 2_000;
export const MAX_REPLAY_SERIALIZED_BYTES_LIMIT = 1_500_000; // ~1.5MB ceiling

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
  boardHash: string; // 64-char SHA-256 hex
  rngState?: number;
  eventIndex?: number; // Canonical event cursor position for deterministic seek
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
      if (ev.spawn) {
        if (typeof ev.spawn.index !== 'number' || ev.spawn.index < 0 || ev.spawn.index >= BOARD_CELL_COUNT) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn cell: ${String(ev.spawn?.index)}` };
        }
        if (ev.spawn.value !== 2 && ev.spawn.value !== 4) {
          return { valid: false, code: 'MALFORMED_EVENT', error: `MOVE event at index ${i} has invalid spawn value: ${String(ev.spawn?.value)}` };
        }
      }
    } else if (ev.type === 'TIME_BOOST' || ev.type === 'RESCUE_TIMEOUT') {
      if (ev.addedSeconds !== undefined && (typeof ev.addedSeconds !== 'number' || ev.addedSeconds <= 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `${ev.type} at index ${i} has non-positive addedSeconds` };
      }
    } else if (ev.type === 'RESUME') {
      if (ev.pauseDurationMs !== undefined && (typeof ev.pauseDurationMs !== 'number' || ev.pauseDurationMs < 0)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `RESUME at index ${i} has negative pauseDurationMs` };
      }
    } else if (ev.type === 'UNDO') {
      if (ev.restoredBoard && !isValidBoardArray(ev.restoredBoard)) {
        return { valid: false, code: 'MALFORMED_EVENT', error: `UNDO event at index ${i} has invalid restoredBoard` };
      }
    }
  }

  // 5. Checkpoints Array & Limits
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

  let lastCheckpointMoveIndex = -1;
  for (let j = 0; j < replay.checkpoints.length; j++) {
    const cp = replay.checkpoints[j];
    if (!cp || typeof cp !== 'object') {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} is not an object` };
    }
    if (typeof cp.moveIndex !== 'number' || cp.moveIndex < 0) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid moveIndex` };
    }
    if (cp.moveIndex <= lastCheckpointMoveIndex) {
      return {
        valid: false,
        code: 'MALFORMED_CHECKPOINT',
        error: `Checkpoint at index ${j} moveIndex (${cp.moveIndex}) is not strictly increasing`,
      };
    }
    lastCheckpointMoveIndex = cp.moveIndex;

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
    if (typeof cp.boardHash !== 'string' || cp.boardHash.length !== 64) {
      return { valid: false, code: 'MALFORMED_CHECKPOINT', error: `Checkpoint at index ${j} has invalid boardHash (expected 64-char hex)` };
    }
  }

  // 6. Final Summary Integrity
  if (!replay.finalSummary || typeof replay.finalSummary !== 'object') {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'Missing or malformed finalSummary' };
  }

  const fs = replay.finalSummary;
  if (!isValidBoardArray(fs.finalBoard)) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid finalBoard' };
  }
  if (typeof fs.finalBoardHash !== 'string' || fs.finalBoardHash.length !== 64) {
    return { valid: false, code: 'MALFORMED_FINAL_SUMMARY', error: 'finalSummary has invalid finalBoardHash' };
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
  isPaused: boolean;
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

interface FullUndoSnapshot {
  board: Uint16Array;
  score: number;
  moveIndex: number;
  status: GameStatus;
  rngState: number;
  timer: TimerState;
  competitiveClass: 'PURE' | 'ASSISTED';
  highestTile: number;
}

/**
 * Executes a deterministic playback of a Replay V1 payload, enforcing complete event semantics:
 * Time Boost timer mutation, Assisted transition, Undo full state restoration, and final integrity checks.
 */
export function playReplayV1(
  replay: ReplayV1,
  options?: { stopAtMoveIndex?: number }
): ReplayPlaybackResult {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot play invalid replay: [${validation.code}] ${validation.error}`);
  }

  // Initialize game state with provided initial board & seed
  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  const board = createBoardFrom(replay.initialBoard);

  let current: ReplayPlaybackState = {
    board,
    score: 0,
    bestScore: 0,
    moveIndex: 0,
    status: 'ACTIVE',
    rngState: initial.rngState,
    timer: { ...initial.timer },
    competitiveClass: replay.competitiveClassAtStart ?? 'PURE',
    undosUsed: 0,
    timeBoostsUsed: 0,
    isPaused: false,
  };

  let matchedCheckpointsCount = 0;
  const checkpointsMap = new Map<number, ReplayCheckpointV1>();
  for (const cp of replay.checkpoints || []) {
    checkpointsMap.set(cp.moveIndex, cp);
  }

  // Full snapshot history stack for complete Undo reconstruction
  const localHistory: FullUndoSnapshot[] = [];

  for (let eventIdx = 0; eventIdx < replay.events.length; eventIdx++) {
    const event = replay.events[eventIdx];

    if (options?.stopAtMoveIndex !== undefined && current.moveIndex >= options.stopAtMoveIndex) {
      break;
    }

    switch (event.type) {
      case 'RUN_START': {
        // Run initialized
        break;
      }

      case 'MOVE': {
        if (!event.direction) break;

        // 1. Capture comprehensive snapshot before valid move
        const preMoveSnapshot: FullUndoSnapshot = {
          board: cloneBoard(current.board),
          score: current.score,
          moveIndex: current.moveIndex,
          status: current.status,
          rngState: current.rngState,
          timer: { ...current.timer },
          competitiveClass: current.competitiveClass,
          highestTile: getHighestTile(current.board),
        };

        // 2. Execute move shift & merge
        const moveRes = executeMove(current.board, event.direction);

        if (moveRes.changed) {
          localHistory.push(preMoveSnapshot);

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
          const nextMoveIndex = current.moveIndex + 1;
          const gameOver = isGameOver(moveRes.board);

          current = {
            ...current,
            board: moveRes.board,
            score: nextScore,
            bestScore: Math.max(current.bestScore, nextScore),
            moveIndex: nextMoveIndex,
            status: gameOver ? 'GAME_OVER' : 'ACTIVE',
          };

          // 3. Verify periodic checkpoint if present at this moveIndex
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
        } else {
          // No-op move: board unchanged, snapshot discarded
        }
        break;
      }

      case 'PAUSE': {
        current = {
          ...current,
          isPaused: true,
        };
        break;
      }

      case 'RESUME': {
        current = {
          ...current,
          isPaused: false,
        };
        break;
      }

      case 'TIME_BOOST': {
        const addedSec = event.addedSeconds ?? 5;
        const addedMs = addedSec * 1000;
        current = {
          ...current,
          timeBoostsUsed: current.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          timer: {
            ...current.timer,
            deadlineTimestampMs: current.timer.deadlineTimestampMs + addedMs,
            timeRemainingMs: current.timer.timeRemainingMs + addedMs,
          },
        };
        break;
      }

      case 'ASSISTED_TRANSITION': {
        current = {
          ...current,
          competitiveClass: 'ASSISTED',
        };
        break;
      }

      case 'RESCUE_TIMEOUT': {
        const addedSec = event.addedSeconds ?? 5;
        const addedMs = addedSec * 1000;
        current = {
          ...current,
          timeBoostsUsed: current.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          status: 'ACTIVE',
          timer: {
            ...current.timer,
            deadlineTimestampMs: current.timer.deadlineTimestampMs + addedMs,
            timeRemainingMs: addedMs,
          },
        };
        break;
      }

      case 'RESCUE_UNDO': {
        current = {
          ...current,
          undosUsed: current.undosUsed + 1,
          competitiveClass: 'ASSISTED',
        };
        const prior = localHistory.pop();
        if (prior) {
          current = {
            ...current,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            status: 'ACTIVE',
          };
        }
        break;
      }

      case 'UNDO': {
        current = {
          ...current,
          undosUsed: current.undosUsed + 1,
        };
        const prior = localHistory.pop();
        if (prior) {
          current = {
            ...current,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            // Keep current competitiveClass if it has been marked ASSISTED
            competitiveClass:
              current.competitiveClass === 'ASSISTED' ? 'ASSISTED' : prior.competitiveClass,
          };
        } else if (event.restoredBoard && event.restoredScore !== undefined && event.restoredMoveIndex !== undefined) {
          current = {
            ...current,
            board: createBoardFrom(event.restoredBoard),
            score: event.restoredScore,
            moveIndex: event.restoredMoveIndex,
          };
        }
        break;
      }

      case 'RUN_TERMINAL': {
        if (event.reason === 'TIME_EXPIRED') {
          current = { ...current, status: 'TIME_EXPIRED' };
        } else if (event.reason === 'GAME_OVER') {
          current = { ...current, status: 'GAME_OVER' };
        }
        break;
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

    // 5. Final Board Array Verification
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

    // 6. Final Board Hash Verification
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

    // 7. Terminal Reason Verification (if deterministically checkable)
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
 * Creates an interactive stepping/seeking pure replay player instance with explicit canonical timeline indexing.
 * Resolves Option B: builds canonical playback index from actual applied state transitions,
 * ensuring seeking through no-ops, Undos, and branched paths lands on the authentic final state.
 */
export function createReplayPlayerV1(replay: ReplayV1): ReplayPlayerInstance {
  const validation = validateReplayV1(replay);
  if (!validation.valid) {
    throw new Error(`Cannot play invalid replay: [${validation.code}] ${validation.error}`);
  }

  const { state: initial } = createGame({ seed: replay.seed, currentTimeMs: 0 });
  const initialState: ReplayPlaybackState = {
    board: createBoardFrom(replay.initialBoard),
    score: 0,
    bestScore: 0,
    moveIndex: 0,
    status: 'ACTIVE',
    rngState: initial.rngState,
    timer: { ...initial.timer },
    competitiveClass: replay.competitiveClassAtStart ?? 'PURE',
    undosUsed: 0,
    timeBoostsUsed: 0,
    isPaused: false,
  };

  // Build canonical playback timeline
  // timeline[0] corresponds to state before any event (at eventIndex 0)
  // timeline[i] corresponds to state after applying replay.events[i - 1]
  const timeline: ReplayPlaybackState[] = [initialState];
  const history: FullUndoSnapshot[] = [];
  let runner = { ...initialState };

  for (let i = 0; i < replay.events.length; i++) {
    const event = replay.events[i];
    switch (event.type) {
      case 'MOVE': {
        if (event.direction) {
          const preSnapshot: FullUndoSnapshot = {
            board: cloneBoard(runner.board),
            score: runner.score,
            moveIndex: runner.moveIndex,
            status: runner.status,
            rngState: runner.rngState,
            timer: { ...runner.timer },
            competitiveClass: runner.competitiveClass,
            highestTile: getHighestTile(runner.board),
          };

          const moveRes = executeMove(runner.board, event.direction);
          if (moveRes.changed) {
            history.push(preSnapshot);
            if (event.spawn && moveRes.board[event.spawn.index] === 0) {
              moveRes.board[event.spawn.index] = event.spawn.value;
            }
            const nextScore = runner.score + moveRes.scoreDelta;
            runner = {
              ...runner,
              board: moveRes.board,
              score: nextScore,
              bestScore: Math.max(runner.bestScore, nextScore),
              moveIndex: runner.moveIndex + 1,
              status: isGameOver(moveRes.board) ? 'GAME_OVER' : 'ACTIVE',
            };
          }
        }
        break;
      }

      case 'PAUSE': {
        runner = { ...runner, isPaused: true };
        break;
      }

      case 'RESUME': {
        runner = { ...runner, isPaused: false };
        break;
      }

      case 'TIME_BOOST': {
        const addedMs = (event.addedSeconds ?? 5) * 1000;
        runner = {
          ...runner,
          timeBoostsUsed: runner.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          timer: {
            ...runner.timer,
            deadlineTimestampMs: runner.timer.deadlineTimestampMs + addedMs,
            timeRemainingMs: runner.timer.timeRemainingMs + addedMs,
          },
        };
        break;
      }

      case 'ASSISTED_TRANSITION': {
        runner = { ...runner, competitiveClass: 'ASSISTED' };
        break;
      }

      case 'RESCUE_TIMEOUT': {
        const addedMs = (event.addedSeconds ?? 5) * 1000;
        runner = {
          ...runner,
          timeBoostsUsed: runner.timeBoostsUsed + 1,
          competitiveClass: 'ASSISTED',
          status: 'ACTIVE',
          timer: {
            ...runner.timer,
            deadlineTimestampMs: runner.timer.deadlineTimestampMs + addedMs,
            timeRemainingMs: addedMs,
          },
        };
        break;
      }

      case 'RESCUE_UNDO': {
        runner = {
          ...runner,
          undosUsed: runner.undosUsed + 1,
          competitiveClass: 'ASSISTED',
        };
        const prior = history.pop();
        if (prior) {
          runner = {
            ...runner,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            status: 'ACTIVE',
          };
        }
        break;
      }

      case 'UNDO': {
        runner = {
          ...runner,
          undosUsed: runner.undosUsed + 1,
        };
        const prior = history.pop();
        if (prior) {
          runner = {
            ...runner,
            board: prior.board,
            score: prior.score,
            moveIndex: prior.moveIndex,
            rngState: prior.rngState,
            timer: { ...prior.timer },
            competitiveClass:
              runner.competitiveClass === 'ASSISTED' ? 'ASSISTED' : prior.competitiveClass,
          };
        } else if (event.restoredBoard && event.restoredScore !== undefined && event.restoredMoveIndex !== undefined) {
          runner = {
            ...runner,
            board: createBoardFrom(event.restoredBoard),
            score: event.restoredScore,
            moveIndex: event.restoredMoveIndex,
          };
        }
        break;
      }

      case 'RUN_TERMINAL': {
        if (event.reason === 'TIME_EXPIRED') {
          runner = { ...runner, status: 'TIME_EXPIRED' };
        } else if (event.reason === 'GAME_OVER') {
          runner = { ...runner, status: 'GAME_OVER' };
        }
        break;
      }
    }

    timeline.push({ ...runner });
  }

  // Canonical moveIndex to timelineIndex mapping:
  // Tracks the authentic final event index for each moveIndex along the non-reverted trajectory
  const moveIndexToTimelineIndex = new Map<number, number>();
  for (let idx = 0; idx < timeline.length; idx++) {
    const st = timeline[idx];
    moveIndexToTimelineIndex.set(st.moveIndex, idx);
  }

  let currentTimelineIndex = 0;

  function stepForward(): boolean {
    if (currentTimelineIndex >= replay.events.length) {
      return false;
    }
    currentTimelineIndex++;
    return true;
  }

  function seekToMoveIndex(targetMoveIndex: number): boolean {
    if (targetMoveIndex < 0) return false;

    const targetTimelineIdx = moveIndexToTimelineIndex.get(targetMoveIndex);
    if (targetTimelineIdx !== undefined) {
      currentTimelineIndex = targetTimelineIdx;
      return true;
    }

    // If exact targetMoveIndex not found in canonical map, find closest prior
    let closestIdx = 0;
    for (const [mIdx, tIdx] of moveIndexToTimelineIndex.entries()) {
      if (mIdx <= targetMoveIndex && tIdx > closestIdx) {
        closestIdx = tIdx;
      }
    }
    currentTimelineIndex = closestIdx;
    return true;
  }

  return {
    getCurrentState: () => ({ ...timeline[currentTimelineIndex] }),
    getCurrentMoveIndex: () => timeline[currentTimelineIndex].moveIndex,
    getCurrentEventIndex: () => currentTimelineIndex,
    stepForward,
    seekToMoveIndex,
    isAtEnd: () => currentTimelineIndex >= replay.events.length,
    getReplay: () => replay,
  };
}
