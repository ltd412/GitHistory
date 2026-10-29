// GENERATED from core-node/index.ts by scripts/sync-core.mjs — do not edit; change core-node/index.ts and run `npm run sync-core`.
// Node-only shared modules (git CLI service, undo history, custom command expansion).
export * as git from './git';
export { createHistory, type UndoEntry } from './history';
export { expandCommand, powershellQuote, shellQuote } from './custom';
export { watchTree, isNoise } from './watch-tree';
