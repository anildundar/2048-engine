import { BOARD_SIZE, cloneBoard, toCoords, toIndex } from './board.js';
import type { Direction, MergedTile, MovedTile, MoveResult } from './types.js';

interface LineEntry {
  originalIndex: number;
  value: number;
}

/**
 * Executes a canonical 2048 board shift and merge in the specified direction.
 * Returns the resulting board and comprehensive semantic transition metadata.
 */
export function executeMove(board: Uint16Array, direction: Direction): MoveResult {
  const nextBoard = new Uint16Array(16);
  let totalScoreDelta = 0;
  const movedTiles: MovedTile[] = [];
  const merges: MergedTile[] = [];

  // Define line index vectors based on direction
  const lines: number[][] = [];

  if (direction === 'left') {
    for (let r = 0; r < BOARD_SIZE; r++) {
      lines.push([toIndex(r, 0), toIndex(r, 1), toIndex(r, 2), toIndex(r, 3)]);
    }
  } else if (direction === 'right') {
    for (let r = 0; r < BOARD_SIZE; r++) {
      lines.push([toIndex(r, 3), toIndex(r, 2), toIndex(r, 1), toIndex(r, 0)]);
    }
  } else if (direction === 'up') {
    for (let c = 0; c < BOARD_SIZE; c++) {
      lines.push([toIndex(0, c), toIndex(1, c), toIndex(2, c), toIndex(3, c)]);
    }
  } else if (direction === 'down') {
    for (let c = 0; c < BOARD_SIZE; c++) {
      lines.push([toIndex(3, c), toIndex(2, c), toIndex(1, c), toIndex(0, c)]);
    }
  }

  for (const line of lines) {
    const nonZeros: LineEntry[] = [];
    for (const idx of line) {
      const val = board[idx];
      if (val !== 0) {
        nonZeros.push({ originalIndex: idx, value: val });
      }
    }

    let targetSlot = 0;
    let i = 0;

    while (i < nonZeros.length) {
      const current = nonZeros[i];
      const next = nonZeros[i + 1];
      const targetIndex = line[targetSlot];
      const targetCoords = toCoords(targetIndex);

      if (next && current.value === next.value) {
        // Merge identical adjacent values
        const mergedValue = current.value * 2;
        nextBoard[targetIndex] = mergedValue;
        totalScoreDelta += mergedValue;

        const currentCoords = toCoords(current.originalIndex);
        const nextCoords = toCoords(next.originalIndex);

        movedTiles.push({
          fromIndex: current.originalIndex,
          toIndex: targetIndex,
          fromRow: currentCoords.row,
          fromCol: currentCoords.col,
          toRow: targetCoords.row,
          toCol: targetCoords.col,
          value: current.value,
        });

        movedTiles.push({
          fromIndex: next.originalIndex,
          toIndex: targetIndex,
          fromRow: nextCoords.row,
          fromCol: nextCoords.col,
          toRow: targetCoords.row,
          toCol: targetCoords.col,
          value: next.value,
        });

        merges.push({
          index: targetIndex,
          row: targetCoords.row,
          col: targetCoords.col,
          value: mergedValue,
          sourceIndices: [current.originalIndex, next.originalIndex],
        });

        targetSlot++;
        i += 2;
      } else {
        // Slide non-merged tile to next available slot
        nextBoard[targetIndex] = current.value;

        if (current.originalIndex !== targetIndex) {
          const currentCoords = toCoords(current.originalIndex);
          movedTiles.push({
            fromIndex: current.originalIndex,
            toIndex: targetIndex,
            fromRow: currentCoords.row,
            fromCol: currentCoords.col,
            toRow: targetCoords.row,
            toCol: targetCoords.col,
            value: current.value,
          });
        }

        targetSlot++;
        i++;
      }
    }
  }

  // Check if board state changed
  let changed = false;
  for (let idx = 0; idx < 16; idx++) {
    if (board[idx] !== nextBoard[idx]) {
      changed = true;
      break;
    }
  }

  return {
    changed,
    board: changed ? nextBoard : cloneBoard(board),
    scoreDelta: changed ? totalScoreDelta : 0,
    movedTiles: changed ? movedTiles : [],
    merges: changed ? merges : [],
    spawnedTile: null,
  };
}
