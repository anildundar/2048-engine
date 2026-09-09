import type { TimerConfig, TimerState } from './types.js';

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  tier1DurationMs: 15_000,
  tier2DurationMs: 12_000,
  tier3DurationMs: 10_000,
  timeBoostAmountMs: 10_000,
};

export const ADAPTIVE_INITIAL_TIMER_MS = 10_000;
export const ADAPTIVE_FLOOR_TIMER_MS = 3_000;
export const TIME_BOOST_INCREMENT_MS = 5_000;

/**
 * Resolves the canonical adaptive per-move duration base in milliseconds
 * based on highestTileEver reached in run (§21, §33).
 */
export function getAdaptiveTimerStageBaseMs(highestTileEver: number): number {
  if (highestTileEver >= 8192) return 3_000;
  if (highestTileEver >= 4096) return 4_000;
  if (highestTileEver >= 2048) return 5_000;
  if (highestTileEver >= 1024) return 6_000;
  if (highestTileEver >= 512) return 7_000;
  if (highestTileEver >= 256) return 8_000;
  if (highestTileEver >= 128) return 9_000;
  return 10_000;
}

/**
 * Calculates the maximum cap for a Time Boost at a specific adaptive stage.
 * Cap = stageBaseMs + 5000ms.
 */
export function getAdaptiveTimerMaxCapMs(stageBaseMs: number): number {
  return stageBaseMs + TIME_BOOST_INCREMENT_MS;
}

/**
 * Returns tier duration based on the active tier.
 */
export function getTierDuration(tier: number, config: TimerConfig = DEFAULT_TIMER_CONFIG): number {
  if (tier <= 1) return config.tier1DurationMs;
  if (tier === 2) return config.tier2DurationMs;
  return config.tier3DurationMs;
}

/**
 * Initializes a new timer state starting at tier 1.
 */
export function createTimerState(
  currentTimeMs: number,
  config: TimerConfig = DEFAULT_TIMER_CONFIG
): TimerState {
  const durationMs = getTierDuration(1, config);
  return {
    deadlineTimestampMs: currentTimeMs + durationMs,
    currentTier: 1,
    durationMs,
    timeRemainingMs: durationMs,
  };
}

/**
 * Resets the timer budget upon a valid move.
 */
export function resetTimerOnValidMove(
  timer: TimerState,
  currentTimeMs: number,
  nextTier: number,
  config: TimerConfig = DEFAULT_TIMER_CONFIG
): TimerState {
  const durationMs = getTierDuration(nextTier, config);
  return {
    deadlineTimestampMs: currentTimeMs + durationMs,
    currentTier: nextTier,
    durationMs,
    timeRemainingMs: durationMs,
  };
}

/**
 * Extends the deadline by adding the configured boost duration.
 */
export function applyTimeBoostToTimer(
  timer: TimerState,
  currentTimeMs: number,
  config: TimerConfig = DEFAULT_TIMER_CONFIG
): TimerState {
  const boostAmount = config.timeBoostAmountMs;
  const baseTimestamp = Math.max(timer.deadlineTimestampMs, currentTimeMs);
  const newDeadline = baseTimestamp + boostAmount;
  const newRemaining = Math.max(0, newDeadline - currentTimeMs);

  return {
    ...timer,
    deadlineTimestampMs: newDeadline,
    timeRemainingMs: newRemaining,
  };
}

/**
 * Evaluates current expiry and remaining duration against supplied timestamp.
 */
export function evaluateTimer(
  timer: TimerState,
  currentTimeMs: number
): { isExpired: boolean; remainingMs: number } {
  const remainingMs = Math.max(0, timer.deadlineTimestampMs - currentTimeMs);
  return {
    isExpired: remainingMs === 0,
    remainingMs,
  };
}
