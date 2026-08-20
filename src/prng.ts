/**
 * Mulberry32 deterministic 32-bit PRNG.
 * Entirely self-contained, serializable state, zero platform APIs, zero Math.random().
 */

export interface PRNGResult {
  value: number; // Float in range [0, 1)
  nextState: number; // 32-bit unsigned integer state
}

/**
 * Initializes PRNG state from any numeric seed.
 */
export function initPRNG(seed: number): number {
  return (seed >>> 0) || 1;
}

/**
 * Advances PRNG state by 1 step and returns a float in [0, 1).
 */
export function nextPRNG(state: number): PRNGResult {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let z = nextState;
  z = Math.imul(z ^ (z >>> 15), z | 1);
  z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
  const value = ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  return { value, nextState };
}

/**
 * Generates an integer in [min, max] inclusive.
 */
export function nextInt(state: number, min: number, max: number): { value: number; nextState: number } {
  if (min >= max) return { value: min, nextState: state };
  const { value, nextState } = nextPRNG(state);
  const intVal = Math.floor(value * (max - min + 1)) + min;
  return { value: intVal, nextState };
}

/**
 * Deterministically chooses one index from a list of empty cell indices.
 */
export function chooseRandomEmptyCell(
  state: number,
  emptyIndices: number[]
): { cellIndex: number; nextState: number } {
  if (emptyIndices.length === 0) {
    throw new Error('Cannot choose empty cell from an empty list');
  }
  if (emptyIndices.length === 1) {
    return { cellIndex: emptyIndices[0], nextState: state };
  }
  const { value: selectedIdx, nextState } = nextInt(state, 0, emptyIndices.length - 1);
  return { cellIndex: emptyIndices[selectedIdx], nextState };
}

/**
 * Deterministically decides tile spawn value (90% chance of 2, 10% chance of 4 by default).
 */
export function determineSpawnValue(
  state: number,
  p4Probability = 0.1
): { value: 2 | 4; nextState: number } {
  const { value, nextState } = nextPRNG(state);
  const spawnValue: 2 | 4 = value < p4Probability ? 4 : 2;
  return { value: spawnValue, nextState };
}
