// Node-only shared modules (git CLI service, undo history, custom command expansion).
export * as git from './git';
export { createHistory, type UndoEntry } from './history';
export { expandCommand, powershellQuote, shellQuote } from './custom';
