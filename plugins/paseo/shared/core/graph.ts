// GENERATED from core/graph.ts by scripts/sync-core.mjs — do not edit; change core/graph.ts and run `npm run sync-core`.
import type { Commit } from './types';

export const WIP_HASH = '__WIP__';

export interface GraphRow {
  hash: string;
  col: number;
  color: number;
  /** Number of lanes in use at this row, for sizing the graph column. */
  width: number;
}

/**
 * One child→parent connection, drawn as a single continuous path. Between its two rows the
 * edge runs vertically in `lane`; it bends out of the child's column and into the parent's
 * column only where those differ from `lane`.
 */
export interface GraphEdge {
  from: number;
  to: number;
  fromCol: number;
  toCol: number;
  lane: number;
  color: number;
  /** Dashed edges connect the WIP node and stashes to their base commit. */
  dashed: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  edges: GraphEdge[];
  /** Widest lane count over all rows. */
  maxWidth: number;
}

export interface GraphNode extends Commit {
  kind?: 'commit' | 'wip' | 'stash';
  stashIndex?: number;
}

/**
 * Assigns each commit a lane and connects it to its parents, the way GitKraken lays out its graph:
 *
 * - The checked-out branch's first-parent chain (`mainChain`) owns lane 0 for its whole length,
 *   so the branch you work on is always the straight line on the left.
 * - A commit's first parent continues in the commit's own lane, even if another lane already
 *   waits for it; such lanes run straight down and converge at the fork point.
 * - A merge's other parent: if its branch already has a lane, the line runs up that lane and
 *   curves into the merge commit at the merge row; otherwise it opens a lane to the right.
 *
 * Lanes never shift sideways, so each edge occupies one lane between its endpoints.
 * Input must be in topological order (children before parents).
 */
export function layoutGraph(nodes: GraphNode[], opts: { mainChain?: Set<string> } = {}): GraphLayout {
  const main = opts.mainChain ?? new Set<string>();
  const reserve = main.size > 0 ? 1 : 0;
  const lanes: (string | null)[] = [];
  const laneColor: number[] = [];
  const waitingFor = new Map<string, GraphEdge[]>();
  const edges: GraphEdge[] = [];
  const rows: GraphRow[] = [];
  let nextColor = reserve; // colour 0 belongs to the main chain
  let maxWidth = 1;

  /** First free lane at or after `from` (lane 0 stays reserved for the main chain). */
  const openLane = (hash: string, from: number) => {
    let k = Math.max(from, reserve);
    while (k < lanes.length && lanes[k] != null) k++;
    while (lanes.length < k) lanes.push(null);
    lanes[k] = hash;
    laneColor[k] = nextColor++;
    return k;
  };
  const wait = (hash: string, e: GraphEdge) => waitingFor.set(hash, [...(waitingFor.get(hash) ?? []), e]);

  nodes.forEach((node, r) => {
    let col: number;
    if (main.has(node.hash)) {
      col = 0;
      if (lanes.length === 0) lanes.push(null);
      lanes[0] = node.hash;
      laneColor[0] = 0;
    } else {
      col = lanes.indexOf(node.hash);
      if (col === -1) col = openLane(node.hash, reserve);
    }
    const color = laneColor[col];

    // Every edge waiting for this commit ends here; the lanes that carried them are free.
    for (const e of waitingFor.get(node.hash) ?? []) {
      e.to = r;
      e.toCol = col;
      edges.push(e);
    }
    waitingFor.delete(node.hash);
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === node.hash && i !== col) lanes[i] = null;

    const dashed = node.kind === 'wip' || node.kind === 'stash';
    const [first, ...others] = node.parents;
    if (first == null) lanes[col] = null;
    else {
      lanes[col] = first;
      wait(first, { from: r, to: -1, fromCol: col, toCol: col, lane: col, color, dashed });
    }
    for (const p of others) {
      // The merged branch's line extends up its own lane and curves into the merge commit;
      // a branch without a lane yet gets one to the right.
      const k = lanes.indexOf(p);
      const lane = k !== -1 ? k : openLane(p, col + 1);
      wait(p, { from: r, to: -1, fromCol: col, toCol: lane, lane, color: laneColor[k !== -1 ? k : lane] ?? color, dashed });
    }

    maxWidth = Math.max(maxWidth, lanes.length, col + 1);
    while (lanes.length > reserve && lanes[lanes.length - 1] == null) lanes.pop();
    rows.push({ hash: node.hash, col, color, width: Math.max(lanes.length, col + 1) });
  });

  // Parents beyond the loaded page: the edge runs off the bottom in its lane.
  for (const list of waitingFor.values()) for (const e of list) edges.push({ ...e, to: nodes.length, toCol: e.lane });
  return { rows, edges, maxWidth };
}

/** The first-parent chain from `start` (HEAD, or the WIP node above it) through the loaded commits. */
export function firstParentChain(nodes: GraphNode[], start: string | null): Set<string> {
  const byHash = new Map(nodes.map((n) => [n.hash, n]));
  const chain = new Set<string>();
  for (let cur = start ? byHash.get(start) : undefined; cur && !chain.has(cur.hash); cur = byHash.get(cur.parents[0])) chain.add(cur.hash);
  return chain;
}

/**
 * Builds the row list shown in the graph: an optional WIP node on top of HEAD and stash
 * nodes inserted just above their base commit.
 */
export function buildNodes(
  commits: Commit[],
  opts: {
    headSha: string | null;
    mergeHead?: string | null;
    wip: boolean;
    stashes: { hash: string; base: string; index: number; message: string; time: number }[];
  },
): GraphNode[] {
  const nodes: GraphNode[] = [];
  const stashByBase = new Map<string, GraphNode[]>();
  const known = new Set(commits.map((c) => c.hash));
  const orphanStashes: GraphNode[] = [];
  for (const s of opts.stashes) {
    const n: GraphNode = {
      hash: s.hash,
      parents: [s.base],
      author: '',
      email: '',
      time: s.time,
      subject: s.message,
      kind: 'stash',
      stashIndex: s.index,
    };
    if (known.has(s.base)) {
      const list = stashByBase.get(s.base) ?? [];
      list.push(n);
      stashByBase.set(s.base, list);
    } else orphanStashes.push({ ...n, parents: [] });
  }
  if (opts.wip) {
    nodes.push({
      hash: WIP_HASH,
      parents: [opts.headSha, opts.mergeHead].filter((p): p is string => !!p && known.has(p)),
      author: '',
      email: '',
      time: Date.now() / 1000,
      subject: '// WIP',
      kind: 'wip',
    });
  }
  for (const c of commits) {
    const s = stashByBase.get(c.hash);
    if (s) nodes.push(...s);
    nodes.push(c);
  }
  nodes.push(...orphanStashes);
  return nodes;
}
