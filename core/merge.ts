import type { ConflictChunk } from './diff';

export type SideName = 'ours' | 'theirs';
export type SideState = 'pending' | 'applied' | 'ignored';

/** Resolution of one conflict, PyCharm-style: each side is applied (»/«) or ignored (×). */
export interface Resolution {
  ours: SideState;
  theirs: SideState;
  /** Applied sides in the order they were applied: both applied → concatenated in that order. */
  order: SideName[];
  /** Hand-edited result text; overrides the side choices. */
  manual: string | null;
}

export const initialResolutions = (chunks: ConflictChunk[]): Resolution[] =>
  chunks.filter((c) => c.kind === 'conflict').map(() => ({ ours: 'pending', theirs: 'pending', order: [], manual: null }));

export function applySide(r: Resolution, side: SideName): Resolution {
  return { ...r, [side]: 'applied', order: r.order.includes(side) ? r.order : [...r.order, side], manual: null };
}

export function ignoreSide(r: Resolution, side: SideName): Resolution {
  return { ...r, [side]: 'ignored', order: r.order.filter((s) => s !== side), manual: null };
}

export function acceptAll(rs: Resolution[], side: SideName): Resolution[] {
  return rs.map(() =>
    side === 'ours'
      ? { ours: 'applied', theirs: 'ignored', order: ['ours'], manual: null }
      : { ours: 'ignored', theirs: 'applied', order: ['theirs'], manual: null },
  );
}

export const isResolved = (r: Resolution) => r.manual != null || (r.ours !== 'pending' && r.theirs !== 'pending');

/**
 * Lines the result holds for one conflict. With nothing applied it shows the common ancestor
 * (like PyCharm's centre pane); without a known base it shows nothing yet.
 */
export function resultLines(c: ConflictChunk, r: Resolution): string[] {
  if (r.manual != null) return r.manual === '' ? [] : r.manual.split('\n');
  if (r.order.length) return r.order.flatMap((s) => c[s] ?? []);
  return c.base ?? [];
}

const PENDING: Resolution = { ours: 'pending', theirs: 'pending', order: [], manual: null };

export function buildOutput(chunks: ConflictChunk[], rs: Resolution[]): string {
  let i = 0;
  const out: string[] = [];
  for (const c of chunks) {
    if (c.kind === 'common') out.push(...c.lines!);
    // A missing entry (resolutions not yet initialised for these chunks) counts as untouched.
    else out.push(...resultLines(c, rs[i++] ?? PENDING));
  }
  return out.join('\n');
}
