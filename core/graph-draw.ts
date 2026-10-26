// Geometry and drawing of the commit graph, shared by the desktop graph (one SVG overlay over the visible
// rows) and the Paseo plugin (one small SVG per row, since React Native has no DOM). Both call the same
// edgePath, so lanes, corners and nodes look identical everywhere.
import type { GraphEdge, GraphLayout, GraphNode, GraphRow } from './graph.ts';
import { avatarColor, initials, laneColor } from './format.ts';

/** Row/lane geometry; compact mode (Fork-style dense list) shrinks rows and drops avatars. */
export interface Metrics {
  row: number;
  lane: number;
  pad: number;
  compact: boolean;
}
export const NORMAL: Metrics = { row: 28, lane: 24, pad: 14, compact: false };
export const COMPACT: Metrics = { row: 22, lane: 16, pad: 10, compact: true };

export const laneX = (m: Metrics, lane: number) => m.pad + lane * m.lane;

export const AUTHOR_W = 140;
export const DATE_W = 130;
export const SHA_W = 70;
export const MIN_MSG = 220;

export interface Columns {
  refs: number;
  graph: number;
  author: boolean;
  date: boolean;
  sha: boolean;
}

/**
 * Fits the columns into the available width, like a native table would: the commit message
 * keeps at least MIN_MSG; when space runs out the SHA, date and author columns drop first,
 * then the graph and branch columns narrow (lanes past the edge fade out). Every cell and the
 * graph overlay use these numbers, so lines can never be drawn over the message text.
 */
export function fitColumns(view: number, refs: number, graph: number, minMsg = MIN_MSG): Columns {
  const c: Columns = { refs, graph, author: true, date: true, sha: true };
  const used = () => c.refs + c.graph + (c.author ? AUTHOR_W : 0) + (c.date ? DATE_W : 0) + (c.sha ? SHA_W : 0);
  for (const k of ['sha', 'date', 'author'] as const) if (view - used() < minMsg) c[k] = false;
  let over = used() + minMsg - view;
  if (over > 0) {
    const g = Math.min(over, c.graph - 80);
    if (g > 0) c.graph -= g;
    over -= Math.max(g, 0);
  }
  if (over > 0) c.refs = Math.max(90, c.refs - over);
  return c;
}

/** Fraction of the radius used for cubic control points so a corner reads as a quarter circle. */
const K = 0.552;

/** Corner from a downward run at x into a horizontal run heading in direction s, ending at (x + s·r, y). */
const downToSide = (x: number, y: number, s: number, r: number) => `C${x} ${y - r + K * r} ${x + s * r - s * K * r} ${y} ${x + s * r} ${y}`;
/** Corner from a horizontal run heading in direction s into a downward run at x, ending at (x, y + r). */
const sideToDown = (x: number, y: number, s: number, r: number) => `C${x - s * r + s * K * r} ${y} ${x} ${y + r - K * r} ${x} ${y + r}`;

/**
 * Path for one edge, drawn like GitKraken: it runs vertically in its lane and changes column
 * with a straight horizontal run and a rounded corner of about half a row — a merge bends out
 * of the merge commit, a branch turns into its parent at the parent's row.
 *
 * `avoidOut` / `avoidIn`: the node at that end carries a ref label whose connector comes in
 * horizontally from the left. A turn toward the left would retrace it, so there the curve
 * leaves/enters the node vertically (a small S) instead.
 */
export function edgePath(m: Metrics, e: GraphEdge, y1: number, y2: number, avoidOut: boolean, avoidIn: boolean): string {
  const x1 = laneX(m, e.fromCol);
  const xl = laneX(m, e.lane);
  const x2 = laneX(m, e.toCol);
  const span = y2 - y1;
  const outTurn = xl !== x1;
  const inTurn = xl !== x2;
  const radius = m.compact ? 9 : 14;
  // Corners share the vertical span when both ends turn.
  const maxR = Math.min(radius, outTurn && inTurn ? span / 2 : span);
  const aOut = avoidOut && outTurn && xl < x1;
  const aIn = avoidIn && inTurn && xl < x2;
  let d = `M${x1} ${y1}`;
  let y = y1;
  if (outTurn) {
    const s = Math.sign(xl - x1);
    if (aOut) {
      const h = Math.min(m.row * 0.6, maxR * 2);
      d += `C${x1} ${y1 + h / 2} ${xl} ${y1 + h / 2} ${xl} ${y1 + h}`;
      y = y1 + h;
    } else {
      const r = Math.min(Math.abs(xl - x1), maxR);
      if (xl - s * r !== x1) d += `H${xl - s * r}`;
      d += sideToDown(xl, y1, s, r);
      y = y1 + r;
    }
  }
  if (inTurn) {
    const s = Math.sign(x2 - xl);
    if (aIn) {
      const h = Math.min(m.row * 0.6, maxR * 2);
      if (y2 - h > y) d += `V${y2 - h}`;
      d += `C${xl} ${y2 - h / 2} ${x2} ${y2 - h / 2} ${x2} ${y2}`;
    } else {
      const r = Math.min(Math.abs(x2 - xl), maxR);
      if (y2 - r > y) d += `V${y2 - r}`;
      d += downToSide(xl, y2, s, r);
      if (xl + s * r !== x2) d += `H${x2}`;
    }
  } else d += `V${y2}`;
  return d;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** SVG markup of one node (same shapes as the desktop's Node component). `bg` is the graph background. */
export function nodeSvg(m: Metrics, node: GraphNode, row: GraphRow, y: number, bg: string, dim: boolean): string {
  const cx = laneX(m, row.col);
  const color = laneColor(row.color);
  const op = dim ? ' opacity="0.35"' : '';
  if (m.compact) {
    if (node.kind === 'wip' || node.kind === 'stash')
      return `<circle cx="${cx}" cy="${y}" r="4.5" fill="${bg}" stroke="${color}" stroke-width="1.5" stroke-dasharray="2 1.5"${op}/>`;
    return `<circle cx="${cx}" cy="${y}" r="${node.parents.length > 1 ? 3 : 4.5}" fill="${color}" stroke="${bg}" stroke-width="1"${op}/>`;
  }
  if (node.kind === 'wip') return `<circle cx="${cx}" cy="${y}" r="9" fill="${bg}" stroke="${color}" stroke-width="2" stroke-dasharray="3 2.5"${op}/>`;
  if (node.kind === 'stash')
    return `<rect x="${cx - 8}" y="${y - 8}" width="16" height="16" rx="3" fill="${bg}" stroke="${color}" stroke-width="2" stroke-dasharray="3 2.5"${op}/>`;
  if (node.parents.length > 1) return `<circle cx="${cx}" cy="${y}" r="5.5" fill="${color}" stroke="${bg}" stroke-width="1.5"${op}/>`;
  return (
    `<g${op}><circle cx="${cx}" cy="${y}" r="11" fill="${color}"/>` +
    `<circle cx="${cx}" cy="${y}" r="9" fill="${avatarColor(node.email || node.author)}"/>` +
    `<text x="${cx}" y="${y + 3}" text-anchor="middle" font-size="8" font-weight="700" font-family="sans-serif" fill="#fff">${esc(initials(node.author))}</text></g>`
  );
}

export interface RowSvgOptions {
  m: Metrics;
  /** Width of the graph column. */
  width: number;
  /** Horizontal scroll of the lanes inside the column (whole lanes). */
  scrollX: number;
  /** Full width of all lanes. */
  contentW: number;
  bg: string;
  /** Whether the node at a row carries the checked-out branch label (gets a connector, curves avoid it). */
  labelled: (hash: string) => boolean;
  dimmed?: (hash: string) => boolean;
}

/**
 * One row of the graph as a self-contained SVG (`width` × `m.row`): the edge pieces that cross the row,
 * the ref connector and the node. Edges are drawn whole and clipped by the row's viewport, so stacked rows
 * join seamlessly. No scripts, styles or external references: it passes Paseo's inline-icon validation.
 */
export function rowSvg(layout: GraphLayout, nodes: GraphNode[], i: number, o: RowSvgOptions): string {
  const { m, width, scrollX } = o;
  const H = m.row;
  const yOf = (r: number) => (r - i) * m.row + m.row / 2;
  const parts: string[] = [];
  const n = nodes[i];
  const row = layout.rows[i];
  if (o.labelled(n.hash)) {
    const x2 = laneX(m, row.col) - scrollX;
    if (x2 >= 0) parts.push(`<line x1="0" y1="${yOf(i)}" x2="${Math.min(x2, width)}" y2="${yOf(i)}" stroke="${laneColor(row.color)}" stroke-width="2"/>`);
  }
  const edges: string[] = [];
  for (const e of layout.edges) {
    if (e.from > i || e.to < i) continue;
    const y2 = e.to >= nodes.length ? yOf(nodes.length) + m.row : yOf(e.to);
    const d = edgePath(m, e, yOf(e.from), y2, o.labelled(nodes[e.from].hash), e.to < nodes.length && o.labelled(nodes[e.to].hash));
    edges.push(
      `<path d="${d}" stroke="${laneColor(e.color)}" stroke-width="${m.compact ? 1.5 : 2}" stroke-linecap="round" stroke-linejoin="round" fill="none"${e.dashed ? ' stroke-dasharray="3 4"' : ''}/>`,
    );
  }
  const node = nodeSvg(m, n, row, yOf(i), o.bg, !!o.dimmed?.(n.hash));
  // WHY no mask/gradient here: many row SVGs share one page on web, and `url(#id)` resolves to the first
  // element with that id anywhere in the document — rows ended up masked by another row's mask and drew
  // nothing once scrolled. The host clips the row to the column instead.
  parts.push(`<g transform="translate(${-scrollX} 0)">${edges.join('')}${node}</g>`);
  // xMinYMin meet keeps a 1:1 scale whether the host sizes the icon to the row (web) or to a
  // width × width square (native): the row sits at the top-left either way.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" preserveAspectRatio="xMinYMin meet">${parts.join('')}</svg>`;
}

/**
 * Row SVGs for a whole layout, built on demand and kept: edges are bucketed by the rows they cross once
 * (instead of scanning every edge for every row), and a row's markup never changes while the layout,
 * metrics and colours stay the same. Draw at the full lane width and scroll by moving the image: a
 * horizontal scroll then costs no SVG work at all.
 */
export function createRowSvgCache(layout: GraphLayout, nodes: GraphNode[], o: Omit<RowSvgOptions, 'scrollX' | 'width'>) {
  const width = o.contentW;
  const buckets: number[][] = nodes.map(() => []);
  layout.edges.forEach((e, k) => {
    for (let r = Math.max(0, e.from); r <= Math.min(e.to, nodes.length - 1); r++) buckets[r].push(k);
  });
  const sub: GraphLayout = { ...layout, edges: [] };
  const cache = new Map<number, string>();
  return (i: number): string => {
    let svg = cache.get(i);
    if (svg == null) {
      sub.edges = buckets[i].map((k) => layout.edges[k]);
      svg = rowSvg(sub, nodes, i, { ...o, width, scrollX: 0 });
      cache.set(i, svg);
    }
    return svg;
  };
}

// ---------------------------------------------------------------- SVG-free rendering

/** A straight stroke in row coordinates. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  dashed: boolean;
}

/** A node as plain shapes, for hosts that cannot draw SVG. */
export interface NodeShape {
  x: number;
  y: number;
  color: string;
  kind: 'avatar' | 'merge' | 'dot' | 'wip' | 'stash';
  r: number;
  fill: string;
  initials: string;
}

const CURVE_STEPS = 6;

/** Flattens an edgePath (M/H/V/C only) into straight pieces; cubic curves become CURVE_STEPS chords. */
export function flattenPath(d: string): [number, number][][] {
  const tokens = d.match(/[MHVC]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const lines: [number, number][][] = [];
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      x = num();
      y = num();
    } else if (cmd === 'H') {
      const nx = num();
      lines.push([[x, y], [nx, y]]);
      x = nx;
    } else if (cmd === 'V') {
      const ny = num();
      lines.push([[x, y], [x, ny]]);
      y = ny;
    } else if (cmd === 'C') {
      const [c1x, c1y, c2x, c2y, ex, ey] = [num(), num(), num(), num(), num(), num()];
      const pts: [number, number][] = [[x, y]];
      for (let s = 1; s <= CURVE_STEPS; s++) {
        const t = s / CURVE_STEPS;
        const u = 1 - t;
        pts.push([
          u * u * u * x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
          u * u * u * y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey,
        ]);
      }
      for (let k = 1; k < pts.length; k++) lines.push([pts[k - 1], pts[k]]);
      x = ex;
      y = ey;
    } else throw new Error(`Unexpected path command ${cmd}`);
  }
  return lines;
}

/** Clips a segment to the horizontal band 0 ≤ y ≤ h; null when it lies outside. */
function clipToBand([[x1, y1], [x2, y2]]: [number, number][], h: number): [number, number, number, number] | null {
  if ((y1 < 0 && y2 < 0) || (y1 > h && y2 > h)) return null;
  const at = (y: number) => (y2 === y1 ? x1 : x1 + ((x2 - x1) * (y - y1)) / (y2 - y1));
  const ya = Math.max(0, Math.min(h, y1));
  const yb = Math.max(0, Math.min(h, y2));
  return [y1 === ya ? x1 : at(ya), ya, y2 === yb ? x2 : at(yb), yb];
}

/**
 * One row as straight segments and node shapes — the same geometry as rowSvg (it flattens the very same
 * edgePath), for Paseo versions whose icons cannot be SVG. Built per layout on demand and kept, like
 * createRowSvgCache; drawn at the full lane width (scroll by moving it).
 */
export function createRowShapesCache(layout: GraphLayout, nodes: GraphNode[], o: Omit<RowSvgOptions, 'scrollX' | 'width'>) {
  const { m } = o;
  const buckets: number[][] = nodes.map(() => []);
  layout.edges.forEach((e, k) => {
    for (let r = Math.max(0, e.from); r <= Math.min(e.to, nodes.length - 1); r++) buckets[r].push(k);
  });
  const cache = new Map<number, { segments: Segment[]; node: NodeShape }>();
  return (i: number) => {
    let out = cache.get(i);
    if (out) return out;
    const H = m.row;
    const yOf = (r: number) => (r - i) * m.row + m.row / 2;
    const segments: Segment[] = [];
    const n = nodes[i];
    const row = layout.rows[i];
    if (o.labelled(n.hash)) segments.push({ x1: 0, y1: yOf(i), x2: laneX(m, row.col), y2: yOf(i), color: laneColor(row.color), width: 2, dashed: false });
    for (const k of buckets[i]) {
      const e = layout.edges[k];
      const y2 = e.to >= nodes.length ? yOf(nodes.length) + m.row : yOf(e.to);
      const d = edgePath(m, e, yOf(e.from), y2, o.labelled(nodes[e.from].hash), e.to < nodes.length && o.labelled(nodes[e.to].hash));
      for (const piece of flattenPath(d)) {
        const c = clipToBand(piece, H);
        if (c && (c[0] !== c[2] || c[1] !== c[3]))
          segments.push({ x1: c[0], y1: c[1], x2: c[2], y2: c[3], color: laneColor(e.color), width: m.compact ? 1.5 : 2, dashed: !!e.dashed });
      }
    }
    const x = laneX(m, row.col);
    const color = laneColor(row.color);
    const kind: NodeShape['kind'] = n.kind === 'wip' ? 'wip' : n.kind === 'stash' ? 'stash' : n.parents.length > 1 ? 'merge' : m.compact ? 'dot' : 'avatar';
    const r = kind === 'avatar' ? 11 : kind === 'merge' ? (m.compact ? 3 : 5.5) : kind === 'wip' ? (m.compact ? 4.5 : 9) : kind === 'stash' ? (m.compact ? 4.5 : 8) : 4.5;
    out = { segments, node: { x, y: yOf(i), color, kind, r, fill: avatarColor(n.email || n.author), initials: initials(n.author) } };
    cache.set(i, out);
    return out;
  };
}
