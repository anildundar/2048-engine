export const BOARD_SIZE = 4;
export const BOARD_CELL_COUNT = 16;

/**
 * Creates a blank 4x4 board (16 zeroes in Uint16Array).
 */
export function createEmptyBoard(): Uint16Array {
  return new Uint16Array(BOARD_CELL_COUNT);
}

/**
 * Creates a board from an array of 16 numbers.
 */
export function createBoardFrom(values: number[] | Uint16Array): Uint16Array {
  if (values.length !== BOARD_CELL_COUNT) {
    throw new Error(`Board values must contain exactly ${BOARD_CELL_COUNT} elements`);
  }
  const board = new Uint16Array(BOARD_CELL_COUNT);
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    board[i] = values[i];
  }
  return board;
}

/**
 * Returns a deep copy of a board.
 */
export function cloneBoard(board: Uint16Array): Uint16Array {
  return new Uint16Array(board);
}

/**
 * Compares two boards for exact cell-by-cell equality.
 */
export function boardsEqual(a: Uint16Array, b: Uint16Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Row/Col (0-3) to linear index (0-15).
 */
export function toIndex(row: number, col: number): number {
  return row * BOARD_SIZE + col;
}

/**
 * Linear index (0-15) to Row/Col coordinates (0-3).
 */
export function toCoords(index: number): { row: number; col: number } {
  return {
    row: Math.floor(index / BOARD_SIZE),
    col: index % BOARD_SIZE,
  };
}

/**
 * Returns an array of indices where board[i] === 0.
 */
export function getEmptyCellIndices(board: Uint16Array): number[] {
  const empty: number[] = [];
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    if (board[i] === 0) {
      empty.push(i);
    }
  }
  return empty;
}

/**
 * Returns true if at least one cell is empty (0).
 */
export function hasEmptyCell(board: Uint16Array): boolean {
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    if (board[i] === 0) return true;
  }
  return false;
}

/**
 * Returns true if any adjacent horizontal or vertical cells share identical non-zero values.
 */
export function hasAvailableMerge(board: Uint16Array): boolean {
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const current = board[toIndex(row, col)];
      if (current === 0) continue;

      // Check right neighbor
      if (col < BOARD_SIZE - 1) {
        const right = board[toIndex(row, col + 1)];
        if (current === right) return true;
      }

      // Check down neighbor
      if (row < BOARD_SIZE - 1) {
        const down = board[toIndex(row + 1, col)];
        if (current === down) return true;
      }
    }
  }
  return false;
}

/**
 * Game over occurs when no cells are empty AND no valid merges remain.
 */
export function isGameOver(board: Uint16Array): boolean {
  if (hasEmptyCell(board)) return false;
  return !hasAvailableMerge(board);
}

/**
 * Returns the highest numeric tile value on the board.
 */
export function getHighestTile(board: Uint16Array): number {
  let max = 0;
  for (let i = 0; i < BOARD_CELL_COUNT; i++) {
    if (board[i] > max) {
      max = board[i];
    }
  }
  return max;
}
