# @game2048/core

Deterministic, platform-independent 2048 game engine and replay verifier.

## Features
- **Zero Runtime Dependencies**: Pure TypeScript, runs in Node.js, Web, React Native, and Hermes.
- **Strictly Deterministic**: Mulberry32 32-bit PRNG and canonical slide/merge physics.
- **State Fingerprinting**: Built-in SHA-256 state hashing for server-side replay verification.
- **Full 2048 Feature Set**: Undo history, tier-based timer evaluation, and Time Boost extensions.

## Installation
```bash
npm install @game2048/core
```

## Basic Usage
```typescript
import { createGame, applyMove, hashState, replay } from '@game2048/core';

// Initialize a new deterministic game
const { state } = createGame({ seed: 42 });

// Apply moves
const { state: nextState, result } = applyMove(state, 'left');

// Get cryptographic fingerprint of the board state
const fingerprint = hashState(nextState);

// Verify replay
const replayed = replay(42, [
  { type: 'MOVE', direction: 'left', timestampMs: 1000 },
]);
```
