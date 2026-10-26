import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { git } from '../lib/api';
import { buildNodes, firstParentChain, layoutGraph, WIP_HASH, type GraphLayout, type GraphNode, type GraphRow } from '../lib/graph';
import { absoluteTime, avatarColor, bandAlpha, formatTime, initials, laneColor, relativeTime } from '../lib/format';
import { IconCheck, IconCloud, IconLaptop, IconSearch, IconTag, IconX, IconStash } from './Icons';
import { useUI } from './Overlays';
import { AUTHOR_W, COMPACT, DATE_W, NORMAL, SHA_W, edgePath, fitColumns, laneX, type Columns, type Metrics } from '../lib/graph-draw';
import { dropMenu, labelMenu, refDisplayName, rowMenu, stashMenu, useRepo, type RefLabel } from './RepoContext';

const OVERSCAN = 12;

export function GraphView({ findSeq }: { findSeq: number }) {
  const ctx = useRepo();
  const { repo, data, selection, select, labels, settings, actions: a } = ctx;
  const ui = useUI();
  const m = settings.compact ? COMPACT : NORMAL;
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollX, setScrollXRaw] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [viewW, setViewW] = useState(1000);
  const [refW, setRefW] = useState(190);
  const [graphW, setGraphW] = useState<number | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState('');
  const findInput = useRef<HTMLInputElement>(null);

  const st = data.status;
  const wipCount = st.staged.length + st.unstaged.length + st.conflicted.length;
  const nodes = useMemo(
    () => buildNodes(data.commits, {
        headSha: data.refs.headSha,
        mergeHead: data.state.mergeHead,
        wip: wipCount > 0 || data.state.state !== 'clean',
        stashes: data.stashes,
      }),
    [data.commits, data.refs.headSha, data.state.mergeHead, wipCount, data.state.state, data.stashes],
  );
  // The checked-out branch keeps lane 0 (from the WIP node, or HEAD when the tree is clean).
  const layout = useMemo(() => {
    const start = nodes[0]?.kind === 'wip' ? WIP_HASH : data.refs.headSha;
    return layoutGraph(nodes, { mainChain: firstParentChain(nodes, start) });
  }, [nodes, data.refs.headSha]);
  const rows = layout.rows;
  const maxLanes = layout.maxWidth;
  // Wide enough for every lane up to ~35% of the view; beyond that the lanes scroll horizontally
  // and the column can be dragged wider.
  const autoGraphW = Math.min(Math.max(maxLanes * m.lane + m.pad * 2, 60), Math.max(240, viewW * 0.35));
  const wantGraphW = graphW ?? autoGraphW;
  const cols = fitColumns(viewW, refW, wantGraphW);
  const gW = cols.graph;
  // Like GitKraken, lanes wider than the column scroll horizontally inside it.
  const contentW = maxLanes * m.lane + m.pad * 2;
  const maxScrollX = Math.max(0, contentW - gW);
  // WHY: the offset snaps to whole lanes so a lane is either fully visible or hidden — a
  // fractional offset leaves half-cut nodes and stubs of curves at the left edge.
  const maxSnap = Math.ceil(maxScrollX / m.lane) * m.lane;
  const sx = Math.min(Math.round(scrollX / m.lane) * m.lane, maxSnap);
  const setScrollX = (v: number) => setScrollXRaw(Math.max(0, Math.min(maxSnap, v)));

  // ------------------------------------------------------------ search

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    const set = new Set<string>();
    for (const n of nodes) {
      if (n.subject.toLowerCase().includes(q) || n.author.toLowerCase().includes(q) || n.hash.startsWith(q)) set.add(n.hash);
    }
    return set;
  }, [q, nodes]);

  useEffect(() => {
    if (!findSeq) return;
    setFindOpen(true);
    setTimeout(() => findInput.current?.select(), 0);
  }, [findSeq]);

  const jumpToMatch = (dir: 1 | -1) => {
    if (!matches?.size) return;
    const list = nodes.map((n, i) => [n.hash, i] as const).filter(([h]) => matches.has(h));
    const cur = selection?.kind === 'commit' ? nodes.findIndex((n) => n.hash === selection.hash) : -1;
    const next = dir === 1 ? (list.find(([, i]) => i > cur) ?? list[0]) : ([...list].reverse().find(([, i]) => i < cur) ?? list[list.length - 1]);
    selectNode(nodes[next[1]]);
    scrollToIndex(next[1]);
  };

  // ------------------------------------------------------------ scrolling

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setHeight(el.clientHeight);
      setViewW(el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToIndex = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = i * m.row;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - m.row * 2) el.scrollTop = top - el.clientHeight / 3;
  };

  useEffect(() => {
    const onScrollTo = (e: Event) => {
      const hash = (e as CustomEvent<string>).detail;
      const i = nodes.findIndex((n) => n.hash === hash);
      if (i !== -1) scrollToIndex(i);
    };
    window.addEventListener('gitkrane:scrollTo', onScrollTo);
    return () => window.removeEventListener('gitkrane:scrollTo', onScrollTo);
  });

  const onScroll = () => {
    hideHover();
    const el = scroller.current!;
    setScrollTop(el.scrollTop);
    if (data.hasMore && el.scrollTop + el.clientHeight > el.scrollHeight - m.row * 50) a.loadMore();
  };

  const first = Math.max(0, Math.floor(scrollTop / m.row) - OVERSCAN);
  const last = Math.min(nodes.length, Math.ceil((scrollTop + height) / m.row) + OVERSCAN);

  // ------------------------------------------------------------ selection

  const selectNode = (n: GraphNode) => {
    if (n.kind === 'wip') select({ kind: 'wip' });
    else if (n.kind === 'stash') {
      const s = data.stashes.find((x) => x.hash === n.hash);
      if (s) select({ kind: 'stash', stash: s });
    } else select({ kind: 'commit', hash: n.hash });
  };
  const selectedHash =
    selection?.kind === 'wip' ? WIP_HASH : selection?.kind === 'commit' ? selection.hash : selection?.kind === 'stash' ? selection.stash.hash : null;
  const compared = selection?.kind === 'compare' ? new Set([selection.from, selection.to]) : null;

  /** ⌘/Ctrl-click a second commit to compare it with the selected one (older side first). */
  const clickNode = (n: GraphNode, e: React.MouseEvent) => {
    const anchorHash =
      selection?.kind === 'commit' ? selection.hash : selection?.kind === 'compare' && /^[0-9a-f]{40}$/.test(selection.to) ? selection.to : null;
    if ((e.metaKey || e.ctrlKey) && !n.kind && anchorHash && anchorHash !== n.hash) {
      const ia = nodes.findIndex((x) => x.hash === anchorHash);
      const ib = nodes.findIndex((x) => x.hash === n.hash);
      const [older, newer] = ia > ib ? [anchorHash, n.hash] : [n.hash, anchorHash];
      select({ kind: 'compare', from: older, to: newer });
      return;
    }
    selectNode(n);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const cur = nodes.findIndex((n) => n.hash === selectedHash);
    const next = Math.max(0, Math.min(nodes.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)));
    if (nodes[next]) {
      selectNode(nodes[next]);
      scrollToIndex(next);
    }
  };

  // Horizontal wheel / trackpad swipe (or Shift+wheel) over the graph column scrolls the lanes.
  // Native listener: React's wheel handler is passive and cannot prevent the page scroll.
  const wheelState = useRef({ left: 0, width: 0, max: 0, x: 0 });
  wheelState.current = { left: cols.refs, width: gW, max: maxSnap, x: scrollX };
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const w = wheelState.current;
      if (!w.max) return;
      const x = e.clientX - el.getBoundingClientRect().left;
      if (x < w.left || x > w.left + w.width) return;
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY)) return;
      e.preventDefault();
      setScrollXRaw(Math.max(0, Math.min(w.max, w.x + dx)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keep the selected node's lane in view.
  useEffect(() => {
    const i = nodes.findIndex((n) => n.hash === selectedHash);
    if (i === -1 || !rows[i]) return;
    const x = laneX(m, rows[i].col);
    // Prefer the unscrolled view whenever the node fits in it.
    if (x <= gW - 24) setScrollX(0);
    else if (x - sx < 16 || x - sx > gW - 24) setScrollX(x - gW + 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHash]);

  const dragThumb = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const start = sx;
    const ratio = contentW / gW;
    const move = (ev: MouseEvent) => setScrollX(start + (ev.clientX - x0) * ratio);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  // ------------------------------------------------------------ hover card

  const [hover, setHover] = useState<{ node: GraphNode; x: number; y: number } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const bodies = useRef(new Map<string, string>());
  const [, bump] = useState(0);
  const hideHover = () => {
    window.clearTimeout(hoverTimer.current);
    setHover(null);
  };
  const showHoverLater = (n: GraphNode, e: React.MouseEvent) => {
    window.clearTimeout(hoverTimer.current);
    if (n.kind === 'wip') return setHover(null);
    const rowRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    hoverTimer.current = window.setTimeout(() => {
      setHover({ node: n, x, y: rowRect.bottom });
      // Bodies are fetched on demand: loading them for 2,000 commits up front would slow the graph.
      if (!n.kind && !bodies.current.has(n.hash)) {
        git
          .commitMessage(repo, n.hash)
          .then((msg) => {
            bodies.current.set(n.hash, msg);
            bump((v) => v + 1);
          })
          .catch(() => {});
      }
    }, 500);
  };
  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const colResize = (setter: (n: number) => void, start: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const move = (ev: MouseEvent) => setter(Math.max(40, Math.min(2000, start + ev.clientX - x0)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  return (
    <div className="graph" style={{ position: 'relative' }}>
      {maxScrollX > 0 && (
        <div className="graph-hbar" style={{ left: cols.refs, width: gW }} title="Scroll lanes (trackpad swipe or Shift+wheel over the graph)">
          <div className="graph-hbar-thumb" style={{ left: (sx / contentW) * gW, width: Math.max(24, (gW / contentW) * gW) }} onMouseDown={dragThumb} />
        </div>
      )}
      {findOpen && (
        <div className="lp-header" style={{ background: 'var(--bg-panel)' }}>
          <div className="filter">
            <IconSearch />
            <input
              ref={findInput}
              autoFocus
              placeholder="Search commits (message, author, SHA)…  Enter = next, Shift+Enter = previous"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') jumpToMatch(e.shiftKey ? -1 : 1);
                if (e.key === 'Escape') {
                  setFindOpen(false);
                  setQuery('');
                }
              }}
            />
            {matches && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{matches.size} matches</span>}
          </div>
          <span
            className="btn ghost"
            onClick={() => {
              setFindOpen(false);
              setQuery('');
            }}
          >
            <IconX />
          </span>
        </div>
      )}
      <div className="graph-head">
        <div style={{ width: cols.refs }}>
          Branch / Tag
          <Resizer onMouseDown={colResize(setRefW, refW)} />
        </div>
        <div style={{ width: gW, padding: 0, textAlign: 'center' }}>
          Graph
          <Resizer onMouseDown={colResize((n) => setGraphW(n), gW)} />
        </div>
        <div style={{ flex: 1 }}>Commit message</div>
        {cols.author && <div style={{ width: AUTHOR_W }}>Author</div>}
        {cols.date && <div style={{ width: DATE_W }}>Date / Time</div>}
        {cols.sha && <div style={{ width: SHA_W }}>SHA</div>}
      </div>
      <div
        className="graph-scroll"
        ref={scroller}
        onScroll={onScroll}
        tabIndex={0}
        onKeyDown={onKeyDown}
        // Any menu or press (including on a ref pill, which stops propagation) hides the hover card.
        onContextMenuCapture={hideHover}
        onMouseDownCapture={hideHover}
        style={{ outline: 'none' }}
      >
        <div style={{ height: nodes.length * m.row + (data.hasMore ? m.row * 2 : 0), position: 'relative' }}>
          {nodes.slice(first, last).map((n, k) => {
            const i = first + k;
            const row = rows[i];
            return (
              <Row
                key={n.hash}
                top={i * m.row}
                node={n}
                row={row}
                cols={cols}
                labels={labels.get(n.hash) ?? []}
                selected={selectedHash === n.hash || !!compared?.has(n.hash)}
                height={m.row}
                dim={matches != null && !matches.has(n.hash)}
                isHead={n.hash === data.refs.headSha}
                wipCounts={n.kind === 'wip' ? { staged: st.staged.length, unstaged: st.unstaged.length, conflicted: st.conflicted.length } : null}
                dateMode={settings.dateFormat}
                onClick={(e) => {
                  hideHover();
                  clickNode(n, e);
                }}
                onMouseEnter={(e) => showHoverLater(n, e)}
                onMouseLeave={hideHover}
                onContextMenu={(e) => {
                  hideHover();
                  selectNode(n);
                  if (n.kind === 'stash') {
                    const s = data.stashes.find((x) => x.hash === n.hash);
                    if (s) ui.menu(e, stashMenu(ctx, s));
                  } else if (n.kind === 'wip') {
                    ui.menu(e, [
                      { label: 'Stash all changes', onClick: a.stash },
                      { label: 'Create branch here', onClick: () => a.createBranch() },
                    ]);
                  } else ui.menu(e, rowMenu(ctx, n, labels.get(n.hash) ?? []));
                }}
              />
            );
          })}
          <GraphOverlay
            m={m}
            nodes={nodes}
            layout={layout}
            first={first}
            last={last}
            left={cols.refs}
            width={gW}
            scrollX={sx}
            contentW={contentW}
            labelled={(h) => !!labels.get(h)?.some((l) => l.current)}
            dimmed={(h) => matches != null && !matches.has(h)}
          />
          {data.hasMore && (
            <div className="graph-loadmore" style={{ top: nodes.length * m.row }}>
              Loading more commits…
            </div>
          )}
        </div>
        {hover && <HoverCard node={hover.node} x={hover.x} y={hover.y} labels={labels.get(hover.node.hash) ?? []} body={bodies.current.get(hover.node.hash)} remoteCount={data.remotes.length} />}
        {nodes.length === 0 && <div className="diff-msg">This repository has no commits yet. Make your first commit from the panel on the right.</div>}
      </div>
    </div>
  );
}

/** Full commit details on hover, without changing the selection (like Fork's commit tooltip). */
function HoverCard({
  node,
  x,
  y,
  labels,
  body,
  remoteCount,
}: {
  node: GraphNode;
  x: number;
  y: number;
  labels: RefLabel[];
  body?: string;
  remoteCount: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x + 12, top: y + 4 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Keep it on screen: flip above the row when there is no room below.
    const top = y + 4 + r.height > window.innerHeight - 8 ? Math.max(8, y - 4 - 28 - r.height) : y + 4;
    setPos({ left: Math.max(8, Math.min(x + 12, window.innerWidth - r.width - 8)), top });
  }, [x, y, body]);
  const [subject, ...rest] = (body ?? node.subject).split('\n');
  const text = rest.join('\n').trim();
  const isStash = node.kind === 'stash';
  return (
    <div ref={ref} className="hover-card" style={pos}>
      <div className="hc-subject">{isStash ? node.subject : subject}</div>
      {!isStash && body == null && <div className="hc-body hc-dim">Loading message…</div>}
      {text && <div className="hc-body">{text}</div>}
      {labels.length > 0 && (
        <div className="hc-refs">
          {labels.map((l) => (
            <span key={l.key} className="hc-ref">
              {l.kind === 'tag' ? <IconTag width={10} height={10} /> : l.remotes.length && !l.local ? <IconCloud width={10} height={10} /> : <IconLaptop width={10} height={10} />}
              {refDisplayName(l, remoteCount)}
            </span>
          ))}
        </div>
      )}
      <div className="hc-meta">
        {!isStash && (
          <span className="avatar" style={{ width: 22, height: 22, fontSize: 8, background: avatarColor(node.email || node.author) }}>
            {initials(node.author)}
          </span>
        )}
        <div>
          {!isStash && (
            <div>
              <b>{node.author}</b> <span className="hc-dim">&lt;{node.email}&gt;</span>
            </div>
          )}
          <div className="hc-dim">
            {absoluteTime(node.time)} · {relativeTime(node.time)}
            {!isStash && (
              <>
                {' · '}
                <code>{node.hash.slice(0, 10)}</code>
              </>
            )}
            {node.parents.length > 1 && ` · merge of ${node.parents.length} parents`}
          </div>
        </div>
      </div>
    </div>
  );
}

function Resizer({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return <span onMouseDown={onMouseDown} style={{ position: 'absolute', right: 0, top: 4, bottom: 4, width: 5, cursor: 'col-resize', borderRight: '1px solid var(--border)' }} />;
}

// ---------------------------------------------------------------- row

interface RowProps {
  top: number;
  height: number;
  node: GraphNode;
  row: GraphRow;
  cols: Columns;
  labels: RefLabel[];
  selected: boolean;
  dim: boolean;
  isHead: boolean;
  wipCounts: { staged: number; unstaged: number; conflicted: number } | null;
  dateMode: 'relative' | 'absolute';
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onMouseEnter: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
}

function Row({ top, height, node, row, cols, labels, selected, dim, wipCounts, dateMode, onClick, onContextMenu, onMouseEnter, onMouseLeave }: RowProps) {
  const color = laneColor(row.color);
  // GitKraken-style row band in the lane colour across the ref and graph columns; rows that
  // carry refs are a bit stronger so the label reads as attached to its commit.
  const band = `${color}${bandAlpha(labels.length > 0)}`;
  return (
    <div
      className={`grow${selected ? ' selected' : ''}${dim ? ' dim' : ''}`}
      style={{ top, height }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="gcell refs" style={{ width: cols.refs, background: band }}>
        <RefPills labels={labels} color={color} />
        {labels.some((l) => l.current) && <span className="ref-connector" style={{ background: color }} />}
      </div>
      <div className="gcell graphcell" style={{ width: cols.graph, background: band }}>
      </div>
      <div className="gcell msg">
        {node.kind === 'wip' ? (
          <>
            <span className="wip-msg">// WIP</span>
            <span className="wip-counts">
              {wipCounts!.conflicted > 0 && <span style={{ color: 'var(--red)' }}>⚠ {wipCounts!.conflicted}</span>}
              {wipCounts!.unstaged > 0 && <span style={{ color: 'var(--orange)' }}>✎ {wipCounts!.unstaged}</span>}
              {wipCounts!.staged > 0 && <span style={{ color: 'var(--green)' }}>✓ {wipCounts!.staged}</span>}
            </span>
          </>
        ) : node.kind === 'stash' ? (
          <span className="stash-msg">
            <IconStash width={12} height={12} style={{ verticalAlign: -2, marginRight: 6 }} />
            {node.subject}
          </span>
        ) : (
          <span className="subject">{node.subject}</span>
        )}
      </div>
      {cols.author && (
        <div className="gcell author" style={{ width: AUTHOR_W }}>
          {node.author}
        </div>
      )}
      {cols.date && (
        <div className="gcell date" style={{ width: DATE_W }}>
          {node.kind === 'wip' ? '' : formatTime(node.time, dateMode)}
        </div>
      )}
      {cols.sha && (
        <div className="gcell sha" style={{ width: SHA_W }}>
          {node.kind ? '' : node.hash.slice(0, 7)}
        </div>
      )}
    </div>
  );
}

function RefPills({ labels, color }: { labels: RefLabel[]; color: string }) {
  const ctx = useRepo();
  const ui = useUI();
  const [dropOn, setDropOn] = useState<string | null>(null);
  if (!labels.length) return null;
  const [firstL, ...rest] = labels;
  const pill = (l: RefLabel) => (
    <span
      key={l.key}
      className={`ref-pill${l.current ? ' head' : ''}${l.kind === 'branch' && !l.current ? ' muted' : ''}${dropOn === l.key ? ' drop' : ''}`}
      // Tinted like GitKraken: the checked-out branch is solid, every other ref a muted wash
      // (the mix ratio comes from the theme, see .ref-pill.muted).
      style={{ background: l.kind === 'tag' ? '#6b7385' : color, ['--pill' as string]: color }}
      title={describe(l)}
      draggable={l.kind === 'branch'}
      onDragStart={(e) => e.dataTransfer.setData('text/gitkrane-ref', l.local?.name ?? l.name)}
      onDragOver={(e) => {
        if (l.kind !== 'branch') return;
        e.preventDefault();
        setDropOn(l.key);
      }}
      onDragLeave={() => setDropOn(null)}
      onDrop={(e) => {
        setDropOn(null);
        const src = e.dataTransfer.getData('text/gitkrane-ref');
        if (src && src !== (l.local?.name ?? l.name)) ui.menu(e, dropMenu(ctx, src, l));
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (l.local && !l.current) ctx.actions.checkout(l.local.name);
        else if (!l.local && l.remotes[0]) ctx.actions.checkoutRemote(l.remotes[0]);
        else if (l.tag) ctx.actions.checkout(`tags/${l.tag.name}`);
      }}

    >
      {l.current && <IconCheck />}
      {l.kind === 'tag' && <IconTag />}
      <span className="rn">{refDisplayName(l, ctx.data.remotes.length)}</span>
      {l.local && <IconLaptop />}
      {l.remotes.length > 0 && <IconCloud />}
    </span>
  );
  return (
    <>
      {pill(firstL)}
      {rest.length > 0 && (
        <span
          className="ref-more"
          title={rest.map((l) => l.name).join('\n')}
          onClick={(e) => {
            e.stopPropagation();
            ui.menu(e, rest.map((l) => ({ label: `${l.kind === 'tag' ? 'Tag' : 'Branch'} ${refDisplayName(l, ctx.data.remotes.length)}`, submenu: labelMenu(ctx, l) })));
          }}
        >
          +{rest.length}
        </span>
      )}
    </>
  );
}

function describe(l: RefLabel): string {
  if (l.tag) return `Tag ${l.tag.name}${l.tag.annotated ? ' (annotated)' : ''}`;
  const parts = [l.local ? `Local: ${l.local.name}` : null, ...l.remotes.map((r) => `Remote: ${r.name}`)].filter(Boolean);
  if (l.local?.ahead || l.local?.behind) parts.push(`↑${l.local.ahead} ↓${l.local.behind}`);
  return parts.join('\n');
}

// ---------------------------------------------------------------- graph overlay

function GraphOverlay({
  m,
  nodes,
  layout,
  first,
  last,
  left,
  width,
  scrollX,
  contentW,
  labelled,
  dimmed,
}: {
  m: Metrics;
  nodes: GraphNode[];
  layout: GraphLayout;
  first: number;
  last: number;
  left: number;
  width: number;
  /** Horizontal scroll of the lanes inside the graph column. */
  scrollX: number;
  contentW: number;
  labelled: (hash: string) => boolean;
  dimmed: (hash: string) => boolean;
}) {
  const top = first * m.row;
  const yOf = (row: number) => row * m.row + m.row / 2 - top;
  const visible = layout.edges.filter((e) => e.from <= last && e.to >= first);
  const fadeR = scrollX + width < contentW;
  return (
    <svg
      width={width + left}
      height={(last - first) * m.row}
      style={{ position: 'absolute', left: 0, top, pointerEvents: 'none', overflow: 'hidden' }}
    >
      <defs>
        {/* Lanes hidden past the right edge fade out; the left edge is always a whole-lane boundary. */}
        <linearGradient id="graph-fade" x1="0" x2="1" y1="0" y2="0">
          <stop offset={fadeR ? Math.max(0, (width - 26) / width) : 1} stopColor="#fff" stopOpacity={1} />
          <stop offset={1} stopColor="#fff" stopOpacity={fadeR ? 0 : 1} />
        </linearGradient>
        <mask id="graph-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={width} height={(last - first) * m.row}>
          {/* When scrolled, start 3px in so corners of the hidden lane do not leave slivers. */}
          <rect x={scrollX > 0 ? 3 : 0} y={0} width={width} height={(last - first) * m.row} fill="url(#graph-fade)" />
        </mask>
      </defs>
      {/* Connector from each ref pill to its node: outside the mask so it always meets the pill. */}
      <g transform={`translate(${left} 0)`}>
        {nodes.slice(first, last).map((n, k) => {
          // Like GitKraken, only the checked-out branch gets a solid connector; other refs are
          // tied to their commit by the tinted row band instead of a line across the lanes.
          if (!labelled(n.hash)) return null;
          const row = layout.rows[first + k];
          const x2 = laneX(m, row.col) - scrollX;
          if (x2 < 0) return null;
          const y = yOf(first + k);
          return <line key={`c${n.hash}`} x1={0} y1={y} x2={Math.min(x2, width)} y2={y} stroke={laneColor(row.color)} strokeWidth={2} />;
        })}
      </g>
      <g transform={`translate(${left} 0)`} mask="url(#graph-mask)">
      <g transform={`translate(${-scrollX} 0)`}>
        {visible.map((e, i) => (
          <path
            key={i}
            d={edgePath(
              m,
              e,
              yOf(e.from),
              e.to >= nodes.length ? (last - first + 1) * m.row : yOf(e.to),
              labelled(nodes[e.from].hash),
              e.to < nodes.length && labelled(nodes[e.to].hash),
            )}
            stroke={laneColor(e.color)}
            strokeWidth={m.compact ? 1.5 : 2}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={e.dashed ? '3 4' : undefined}
          />
        ))}
        {nodes.slice(first, last).map((n, k) => (
          <Node key={n.hash} m={m} node={n} row={layout.rows[first + k]} y={yOf(first + k)} dim={dimmed(n.hash)} />
        ))}
      </g>
      </g>
    </svg>
  );
}

function Node({ m, node, row, y, dim }: { m: Metrics; node: GraphNode; row: GraphRow; y: number; dim: boolean }) {
  const cx = laneX(m, row.col);
  const color = laneColor(row.color);
  const opacity = dim ? 0.35 : 1;
  if (m.compact) {
    // Dense mode: small dots only, like Fork's commit list.
    if (node.kind === 'wip' || node.kind === 'stash')
      return <circle cx={cx} cy={y} r={4.5} fill="var(--bg)" stroke={color} strokeWidth={1.5} strokeDasharray="2 1.5" opacity={opacity} />;
    return <circle cx={cx} cy={y} r={node.parents.length > 1 ? 3 : 4.5} fill={color} stroke="var(--bg)" strokeWidth={1} opacity={opacity} />;
  }
  if (node.kind === 'wip')
    return <circle cx={cx} cy={y} r={9} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2.5" opacity={opacity} />;
  if (node.kind === 'stash')
    return <rect x={cx - 8} y={y - 8} width={16} height={16} rx={3} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2.5" opacity={opacity} />;
  if (node.parents.length > 1)
    return <circle cx={cx} cy={y} r={5.5} fill={color} stroke="var(--bg)" strokeWidth={1.5} opacity={opacity} />;
  return (
    <g opacity={opacity}>
      <circle cx={cx} cy={y} r={11} fill={color} />
      <circle cx={cx} cy={y} r={9} fill={avatarColor(node.email || node.author)} />
      <text x={cx} y={y + 3} textAnchor="middle" fontSize={8} fontWeight={700} fill="#fff">
        {initials(node.author)}
      </text>
    </g>
  );
}
