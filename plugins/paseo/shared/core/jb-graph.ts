// GENERATED from core/jb-graph.ts by scripts/sync-core.mjs — do not edit; change core/jb-graph.ts and run `npm run sync-core`.
// Commit graph of the JetBrains-style log: lane assignment per row and long-edge hiding, ported from the
// OpenIDEA project (src/features/vcs/graph.ts, Apache License 2.0 — https://github.com/l0ng-ai/openidea,
// see NOTICE). Pure and UI-agnostic; the desktop draws it as SVG paths, the plugin as per-row SVG strings.
// Input is newest first with parents after their children (`git log --date-order`).

export interface JbGraphSegment {
  /** Lane at the segment's start (top edge for `up`, node level for `down`). */
  from: number;
  /** Lane at the segment's end (node level for `up`, bottom edge for `down`). */
  to: number;
  color: number;
  /** Stands for collapsed commits (Collapse Linear Branches). */
  dashed?: true;
  /** A long edge continues out of sight in this direction (Show Long Edges off). */
  arrow?: 'up' | 'down';
}

export interface JbGraphRow {
  /** Lane of the commit's node. */
  lane: number;
  color: number;
  /** Top half of the row: lines entering from the previous row. */
  up: JbGraphSegment[];
  /** Bottom half: lines leaving towards the next row. */
  down: JbGraphSegment[];
  /** Number of lane slots this row spans. */
  width: number;
}

interface Lane {
  id: string;
  color: number;
  dashed?: true;
}

export interface JbGraphState {
  lanes: Array<Lane | null>;
  nextColor: number;
}

export interface JbGraphCommit {
  id: string;
  parents: readonly string[];
  /** Per parent: the link skips collapsed commits. */
  dashed?: readonly boolean[];
}

export const emptyJbGraphState = (): JbGraphState => ({ lanes: [], nextColor: 0 });

const firstFree = (lanes: Array<Lane | null>) => {
  const i = lanes.indexOf(null);
  return i < 0 ? lanes.length : i;
};

const seg = (from: number, to: number, color: number, dashed?: boolean): JbGraphSegment =>
  dashed ? { from, to, color, dashed: true } : { from, to, color };

const laneOf = (id: string, color: number, dashed: boolean): Lane =>
  dashed ? { id, color, dashed: true } : { id, color };

/**
 * Lays out `commits` (continuing from `state`, so pages can be appended).
 * Each lane keeps its position while it lives; freed slots are reused.
 */
export function computeJbGraph(
  commits: ReadonlyArray<JbGraphCommit>,
  state: JbGraphState = emptyJbGraphState(),
): { rows: JbGraphRow[]; state: JbGraphState } {
  const lanes = [...state.lanes];
  let nextColor = state.nextColor;
  const rows: JbGraphRow[] = [];

  for (const c of commits) {
    const matching: number[] = [];
    lanes.forEach((l, i) => {
      if (l?.id === c.id) matching.push(i);
    });
    let lane: number;
    let color: number;
    if (matching.length) {
      lane = matching[0]!;
      color = lanes[lane]!.color;
    } else {
      lane = firstFree(lanes);
      color = nextColor++;
    }
    const widthBefore = lanes.length;

    const up: JbGraphSegment[] = [];
    lanes.forEach((l, i) => {
      if (!l) return;
      up.push(seg(i, l.id === c.id ? lane : i, l.color, l.dashed));
    });
    for (const m of matching) lanes[m] = null;
    if (lane >= lanes.length) lanes.length = lane + 1;
    lanes[lane] = null;

    const down: JbGraphSegment[] = [];
    lanes.forEach((l, i) => {
      if (l) down.push(seg(i, i, l.color, l.dashed));
    });

    c.parents.forEach((p, k) => {
      const dashed = !!c.dashed?.[k];
      // The first parent continues this lane even if another lane also leads to it
      // (both lines then converge at the parent's node, like `git log --graph`).
      if (k === 0) {
        lanes[lane] = laneOf(p, color, dashed);
        down.push(seg(lane, lane, color, dashed));
        return;
      }
      const existing = lanes.findIndex((l) => l?.id === p);
      if (existing >= 0) {
        down.push(seg(lane, existing, lanes[existing]!.color, dashed));
        return;
      }
      const slot = firstFree(lanes);
      const col = nextColor++;
      lanes[slot] = laneOf(p, col, dashed);
      down.push(seg(lane, slot, col, dashed));
    });

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    const widthAfter = Math.max(0, ...down.map((s) => s.to + 1));
    rows.push({ lane, color, up, down, width: Math.max(widthBefore, widthAfter, lane + 1) });
  }
  return { rows, state: { lanes, nextColor } };
}

/** Ids of the loaded commits reachable from `head` (log order: children before parents). */
export function reachableIds(
  commits: ReadonlyArray<{ id: string; parents: readonly string[] }>,
  head: string | null,
): Set<string> {
  const out = new Set<string>();
  if (!head) return out;
  out.add(head);
  for (const c of commits) if (out.has(c.id)) for (const p of c.parents) out.add(p);
  return out;
}

/** Edges running straight through at least this many rows are long. */
export const LONG_EDGE = 30;
/** Rows of a hidden long edge still drawn next to each of its ends. */
const LONG_EDGE_STUB = 2;

const onLane = (i: number) => (s: JbGraphSegment) => s.from === i && s.to === i;

const passes = (row: JbGraphRow, i: number) => row.lane !== i && row.up.some(onLane(i)) && row.down.some(onLane(i));

/**
 * Show Long Edges off: the middle of a straight run of a lane through `minLength` or
 * more rows is not drawn; the visible stubs end in arrows (IDEA's long-edge arrows).
 */
export function hideLongEdges(rows: readonly JbGraphRow[], minLength = LONG_EDGE): JbGraphRow[] {
  const out = rows.slice();
  const width = Math.max(0, ...rows.map((r) => r.width));
  const edit = (r: number, fn: (row: JbGraphRow) => JbGraphRow) => {
    out[r] = fn(out[r]!);
  };
  for (let i = 0; i < width; i++) {
    const lane = onLane(i);
    let start = -1;
    for (let r = 0; r <= rows.length; r++) {
      if (r < rows.length && passes(rows[r]!, i)) {
        if (start < 0) start = r;
        continue;
      }
      if (start >= 0 && r - start >= minLength) {
        const from = start + LONG_EDGE_STUB;
        const to = r - 1 - LONG_EDGE_STUB;
        for (let k = from; k <= to; k++) {
          edit(k, (row) => ({ ...row, up: row.up.filter((s) => !lane(s)), down: row.down.filter((s) => !lane(s)) }));
        }
        edit(from - 1, (row) => ({ ...row, down: row.down.map((s) => (lane(s) ? { ...s, arrow: 'down' } : s)) }));
        edit(to + 1, (row) => ({ ...row, up: row.up.map((s) => (lane(s) ? { ...s, arrow: 'up' } : s)) }));
      }
      start = -1;
    }
  }
  return out;
}


/** Lane colours, cycled by colour index: theme tokens on the desktop. */
export const JB_LANE_VARS = [
  'var(--accent)',
  'var(--vcs-added)',
  'var(--vcs-modified)',
  'var(--syn-annotation)',
  'var(--syn-number)',
  'var(--syn-string)',
  'var(--syn-type)',
  'var(--danger)',
];
export const jbLaneVar = (i: number) => JB_LANE_VARS[i % JB_LANE_VARS.length]!;

/** The same palette as hex for hosts without CSS variables (the Paseo plugin), per theme. */
export const JB_LANE_HEX = {
  dark: ['#4a78cf', '#6fae75', '#7aa6e6', '#aaa564', '#3e9fa9', '#6a9f72', '#a9acb2', '#e3797f'],
  light: ['#3871e1', '#3f8a4e', '#3f6fc4', '#8a7a1f', '#1f8f99', '#4d8a5a', '#6c707e', '#c54e58'],
} as const;
export const jbLaneHex = (theme: 'dark' | 'light', i: number) => JB_LANE_HEX[theme][i % JB_LANE_HEX[theme].length]!;

// Row geometry of the graph cell (OpenIDEA GitLog.tsx): 14 px lanes in a 26 px row.
export const JB_ROW = 26;
export const JB_LANE = 14;
export const jbLaneX = (lane: number) => JB_LANE / 2 + lane * JB_LANE;
/** Lanes drawn at most; wider graphs are clipped. */
export const JB_MAX_LANES = 24;

/** SVG path of one segment from (fromX, fromY) to (toX, toY): straight, or an S-curve through mid-height. */
export function jbSegPath(fromX: number, fromY: number, toX: number, toY: number): string {
  if (fromX === toX) return `M${fromX} ${fromY}L${toX} ${toY}`;
  const mid = (fromY + toY) / 2;
  return `M${fromX} ${fromY}C${fromX} ${mid} ${toX} ${mid} ${toX} ${toY}`;
}

/** Arrow head at (px, py) pointing up (dir -1) or down (1): a long edge continues. */
export function jbArrowHead(px: number, py: number, dir: 1 | -1): string {
  const back = py - dir * 4;
  return `M${px - 3} ${back}L${px} ${py}L${px + 3} ${back}`;
}

// ---------------------------------------------------------------- rendering for hosts without CSS variables
// The Paseo plugin (React Native) draws each row as one inline SVG string, or as plain shapes on Paseo
// versions whose icons cannot be SVG. Both follow the desktop's JbGraphCell: same paths, same nodes.

export interface JbRowOptions {
  /** HEAD gets a ringed node. */
  head?: boolean;
  /** WIP / stash nodes are dashed rings. */
  dashedNode?: boolean;
  theme: 'dark' | 'light';
  /** Row background: the ring's fill, so lines do not show through it. */
  bg: string;
}

/** Width of the graph cell of a row, in px (at most JB_MAX_LANES lanes). */
export const jbRowWidth = (row: JbGraphRow) => Math.min(row.width, JB_MAX_LANES) * JB_LANE;

/** One row as a self-contained SVG string (no scripts, styles or external references). */
export function jbRowSvg(row: JbGraphRow, o: JbRowOptions): string {
  const width = Math.max(jbRowWidth(row), JB_LANE);
  const cy = JB_ROW / 2;
  const x = jbLaneX;
  const hex = (c: number) => jbLaneHex(o.theme, c);
  const path = (d: string, color: number, dashed?: boolean) =>
    `<path d="${d}" stroke="${hex(color)}" stroke-width="1.6" fill="none" stroke-linecap="${dashed ? 'butt' : 'square'}"${dashed ? ' stroke-dasharray="2 2"' : ''}/>`;
  const parts: string[] = [];
  for (const s of row.up) parts.push(path(jbSegPath(x(s.from), 0, x(s.to), cy) + (s.arrow ? jbArrowHead(x(s.from), 0, -1) : ''), s.color, s.dashed));
  for (const s of row.down) parts.push(path(jbSegPath(x(s.from), cy, x(s.to), JB_ROW) + (s.arrow ? jbArrowHead(x(s.to), JB_ROW, 1) : ''), s.color, s.dashed));
  const nx = x(row.lane);
  const color = hex(row.color);
  if (o.dashedNode) parts.push(`<circle cx="${nx}" cy="${cy}" r="3.8" fill="${o.bg}" stroke="${color}" stroke-width="1.4" stroke-dasharray="2 1.6"/>`);
  else if (o.head) parts.push(`<circle cx="${nx}" cy="${cy}" r="5" fill="${o.bg}" stroke="${color}" stroke-width="1.5"/><circle cx="${nx}" cy="${cy}" r="2.5" fill="${color}"/>`);
  else parts.push(`<circle cx="${nx}" cy="${cy}" r="3.8" fill="${color}"/>`);
  // xMinYMin meet: a 1:1 scale whether the host sizes the icon to the row or to a width × width square.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${JB_ROW}" viewBox="0 0 ${width} ${JB_ROW}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`;
}

/** A straight stroke in row coordinates (same shape as graph-draw's Segment). */
export interface JbSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dashed: boolean;
}
export interface JbNodeShape {
  x: number;
  y: number;
  color: string;
  r: number;
  ring: boolean;
  dashed: boolean;
}

const CURVE_STEPS = 6;

/** The same row as straight strokes plus a node, for hosts that cannot draw SVG; curves become chords. */
export function jbRowShapes(row: JbGraphRow, o: JbRowOptions): { segments: JbSegment[]; node: JbNodeShape } {
  const cy = JB_ROW / 2;
  const segments: JbSegment[] = [];
  const add = (x1: number, y1: number, x2: number, y2: number, color: number, dashed?: boolean) => {
    const c = jbLaneHex(o.theme, color);
    if (x1 === x2) {
      segments.push({ x1, y1, x2, y2, color: c, width: 1.6, dashed: !!dashed });
      return;
    }
    // Cubic from (x1, y1) to (x2, y2) with both control points at mid height (see jbSegPath).
    const mid = (y1 + y2) / 2;
    let px = x1;
    let py = y1;
    for (let s = 1; s <= CURVE_STEPS; s++) {
      const t = s / CURVE_STEPS;
      const u = 1 - t;
      const qx = u * u * u * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x2;
      const qy = u * u * u * y1 + 3 * u * u * t * mid + 3 * u * t * t * mid + t * t * t * y2;
      segments.push({ x1: px, y1: py, x2: qx, y2: qy, color: c, width: 1.6, dashed: !!dashed });
      px = qx;
      py = qy;
    }
  };
  for (const s of row.up) add(jbLaneX(s.from), 0, jbLaneX(s.to), cy, s.color, s.dashed);
  for (const s of row.down) add(jbLaneX(s.from), cy, jbLaneX(s.to), JB_ROW, s.color, s.dashed);
  return {
    segments,
    node: { x: jbLaneX(row.lane), y: cy, color: jbLaneHex(o.theme, row.color), r: o.head ? 5 : 3.8, ring: !!o.head, dashed: !!o.dashedNode },
  };
}
