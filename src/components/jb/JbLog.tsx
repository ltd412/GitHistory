// JetBrains-style Git log, laid out like the OpenIDEA / PyCharm one: a filter bar over a header-less table
// whose first column is the commit graph followed by the subject and the reference labels, then Author and
// Date (Hash optional). Same data, selection and menus as the Kraken graph; only the presentation differs.
import { useEffect, useMemo, useRef, useState } from 'react';
import { git } from '../../lib/api';
import { buildNodes, WIP_HASH, type GraphNode } from '../../lib/graph';
import {
  DATE_FILTERS,
  JB_ROW,
  NO_FILTER,
  applyLogFilter,
  authorsOf,
  computeJbGraph,
  hideLongEdges,
  isFiltering,
  jbRefLabels,
  jbTime,
  reachableIds,
  type JbRefLabel,
} from '../../lib/jb';
import { IconChevron, IconSearch, IconSettings, IconStash, IconX } from '../Icons';
import { Palette } from '../Dialogs';
import { useUI } from '../Overlays';
import { labelMenu, rowMenu, stashMenu, useRepo } from '../RepoContext';
import { JbGraphCell } from './JbGraphCell';
import { useJbFilter } from './JbFilter';
import { setJbOptions, useJbOptions } from './options';

const OVERSCAN = 20;

export function JbLog({ findSeq }: { findSeq: number }) {
  const ctx = useRepo();
  const { repo, data, selection, select, labels, actions: a } = ctx;
  const ui = useUI();
  const opts = useJbOptions();
  const { filter, setFilter } = useJbFilter();
  const scroller = useRef<HTMLDivElement>(null);
  const textInput = useRef<HTMLInputElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(600);
  const [pick, setPick] = useState<'branch' | 'user' | null>(null);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    git
      .getConfig(repo)
      .then((c: { localEmail?: string; globalEmail?: string }) => setMe((c.localEmail || c.globalEmail || '').toLowerCase() || null))
      .catch(() => setMe(null));
  }, [repo]);

  const filtered = isFiltering(filter);
  const commits = useMemo(() => applyLogFilter(data.commits, filter, data.refs), [data.commits, filter, data.refs]);
  const st = data.status;
  const wipCount = st.staged.length + st.unstaged.length + st.conflicted.length;
  const nodes = useMemo(
    () =>
      buildNodes(commits, {
        headSha: data.refs.headSha,
        mergeHead: data.state.mergeHead,
        // Uncommitted changes and stashes belong to the whole repository, not to a filtered view of it.
        wip: !filtered && (wipCount > 0 || data.state.state !== 'clean'),
        stashes: filtered ? [] : data.stashes,
      }),
    [commits, filtered, data.refs.headSha, data.state.mergeHead, wipCount, data.state.state, data.stashes],
  );
  // The WIP node is a normal graph node (parent: HEAD), so its lane joins the checked-out branch.
  const graphRows = useMemo(() => hideLongEdges(computeJbGraph(nodes.map((n) => ({ id: n.hash, parents: n.parents }))).rows), [nodes]);
  // Commits reachable from HEAD are tinted (View Options › Highlight › Current Branch), unless the log only
  // shows that branch anyway.
  const onlyCurrent = filter.branch === 'HEAD' || (!!filter.branch && filter.branch === data.refs.head);
  const onBranch = useMemo(
    () => (opts.highlightCurrentBranch && !onlyCurrent ? reachableIds(nodes.map((n) => ({ id: n.hash, parents: n.parents })), data.refs.headSha) : null),
    [nodes, opts.highlightCurrentBranch, onlyCurrent, data.refs.headSha],
  );

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scrollToIndex = (i: number, center = true) => {
    const el = scroller.current;
    if (!el) return;
    const top = i * JB_ROW;
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - JB_ROW * 2) el.scrollTop = Math.max(0, center ? top - el.clientHeight / 3 : top);
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
  useEffect(() => {
    if (findSeq) textInput.current?.select();
  }, [findSeq]);

  const onScroll = () => {
    const el = scroller.current!;
    setScrollTop(el.scrollTop);
    if (data.hasMore && !filtered && el.scrollTop + el.clientHeight > el.scrollHeight - JB_ROW * 50) a.loadMore();
  };
  const first = Math.max(0, Math.floor(scrollTop / JB_ROW) - OVERSCAN);
  const last = Math.min(nodes.length, Math.ceil((scrollTop + height) / JB_ROW) + OVERSCAN);

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

  /** Ctrl/⌘-click a second commit to compare it with the selected one (older side first). */
  const clickNode = (n: GraphNode, e: React.MouseEvent) => {
    const anchor = selection?.kind === 'commit' ? selection.hash : selection?.kind === 'compare' && /^[0-9a-f]{40}$/.test(selection.to) ? selection.to : null;
    if ((e.metaKey || e.ctrlKey) && !n.kind && anchor && anchor !== n.hash) {
      const ia = nodes.findIndex((x) => x.hash === anchor);
      const ib = nodes.findIndex((x) => x.hash === n.hash);
      const [older, newer] = ia > ib ? [anchor, n.hash] : [n.hash, anchor];
      select({ kind: 'compare', from: older, to: newer });
      return;
    }
    selectNode(n);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = nodes.findIndex((n) => n.hash === selectedHash);
    let next: number;
    if (e.key === 'ArrowDown') next = cur + 1;
    else if (e.key === 'ArrowUp') next = cur - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = nodes.length - 1;
    else if (e.key === 'PageDown') next = cur + 20;
    else if (e.key === 'PageUp') next = cur - 20;
    else return;
    e.preventDefault();
    next = Math.max(0, Math.min(nodes.length - 1, next));
    if (nodes[next]) {
      selectNode(nodes[next]);
      scrollToIndex(next, false);
    }
  };
  const onContextMenu = (n: GraphNode, e: React.MouseEvent) => {
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
  };

  // ------------------------------------------------------------ filter bar

  const authors = useMemo(() => authorsOf(data.commits), [data.commits]);
  const branchItems = useMemo(
    () => [
      { label: 'All branches', hint: '', run: () => setFilter({ ...filter, branch: null }) },
      { label: 'HEAD (Current Branch)', hint: '', run: () => setFilter({ ...filter, branch: 'HEAD' }) },
      ...data.refs.local.map((b) => ({ label: b.name, hint: b.current ? 'current' : 'local', run: () => setFilter({ ...filter, branch: b.name }) })),
      ...data.refs.remote.filter((r) => r.branch !== 'HEAD').map((r) => ({ label: r.name, hint: 'remote', run: () => setFilter({ ...filter, branch: r.name }) })),
      ...data.refs.tags.map((t) => ({ label: t.name, hint: 'tag', run: () => setFilter({ ...filter, branch: t.name }) })),
    ],
    [data.refs, filter, setFilter],
  );
  const userItems = useMemo(
    () => [
      { label: 'Anyone', hint: '', run: () => setFilter({ ...filter, author: null }) },
      ...authors.map((u) => ({ label: u.name, hint: `${u.count}`, run: () => setFilter({ ...filter, author: u.email || u.name }) })),
    ],
    [authors, filter, setFilter],
  );
  const dateMenu = (e: React.MouseEvent) =>
    ui.menu(e, DATE_FILTERS.map((d) => ({ label: `${filter.days === d.days ? '✓  ' : '     '}${d.label}`, onClick: () => setFilter({ ...filter, days: d.days }) })));
  const optionsMenu = (e: React.MouseEvent) => {
    const t = (label: string, key: keyof typeof opts) => ({ label: `${opts[key] ? '✓  ' : '     '}${label}`, onClick: () => setJbOptions({ [key]: !opts[key] }) });
    ui.menu(e, [
      { header: 'Show' },
      t('Compact References View', 'compactRefs'),
      t('Tag Names', 'tagNames'),
      t('References on the Left', 'refsOnLeft'),
      { label: 'Columns', submenu: [t('Author', 'showAuthor'), t('Date', 'showDate'), t('Hash', 'showHash')] },
      t('Branches Pane', 'showBranches'),
      { separator: true },
      { header: 'Highlight' },
      t('My Commits', 'highlightMine'),
      t('Merge Commits', 'highlightMerges'),
      t('Current Branch', 'highlightCurrentBranch'),
    ]);
  };
  const authorLabel = filter.author ? (authors.find((u) => (u.email || u.name) === filter.author)?.name ?? filter.author) : null;
  const dateLabel = filter.days == null ? null : (DATE_FILTERS.find((d) => d.days === filter.days)?.label ?? `${filter.days} days`);

  return (
    <div className="jb-log">
      <div className="jb-filters">
        <div className="jb-search jb-textfilter">
          <IconSearch width={12} height={12} />
          <input
            ref={textInput}
            placeholder="Text or hash"
            value={filter.text}
            onChange={(e) => setFilter({ ...filter, text: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && setFilter({ ...filter, text: '' })}
          />
          {filter.text && (
            <span className="jb-x" onClick={() => setFilter({ ...filter, text: '' })} title="Clear">
              <IconX width={10} height={10} />
            </span>
          )}
        </div>
        <span className="jb-filtergroup">
          <FilterButton label="Branch" value={filter.branch} onOpen={() => setPick('branch')} onClear={() => setFilter({ ...filter, branch: null })} />
          <FilterButton label="User" value={authorLabel} onOpen={() => setPick('user')} onClear={() => setFilter({ ...filter, author: null })} />
          <FilterButton label="Date" value={dateLabel} onOpen={dateMenu} onClear={() => setFilter({ ...filter, days: null })} />
        </span>
        <span className="jb-grow" />
        {filtered && (
          <>
            <span className="jb-count">
              {commits.length} of {data.commits.length}
            </span>
            <button className="jb-link" onClick={() => setFilter(NO_FILTER)}>
              Reset
            </button>
          </>
        )}
        <button className="jb-ibtn" title="View options" onClick={optionsMenu}>
          <IconSettings width={14} height={14} />
        </button>
      </div>
      <div className="jb-listwrap">
        <div className="jb-list" ref={scroller} onScroll={onScroll} tabIndex={0} onKeyDown={onKeyDown} role="listbox" aria-label="Commits">
          {nodes.length === 0 && (
            <div className="jb-message">{filtered ? 'No commits match the filters' : 'No commits yet'}</div>
          )}
          <div style={{ height: nodes.length * JB_ROW, position: 'relative' }}>
            {nodes.slice(first, last).map((n, k) => {
              const i = first + k;
              const selected = selectedHash === n.hash || !!compared?.has(n.hash);
              const head = n.hash === data.refs.headSha && !n.kind;
              const merge = opts.highlightMerges && !n.kind && n.parents.length > 1;
              const mine = opts.highlightMine && !n.kind && !!me && n.email.toLowerCase() === me;
              const refs = n.kind ? [] : jbRefLabels(labels.get(n.hash) ?? [], { compact: opts.compactRefs, tagNames: opts.tagNames }, head && data.refs.headDetached);
              const refEl = refs.length > 0 && <Refs refs={refs} left={opts.refsOnLeft} labelsOf={() => labels.get(n.hash) ?? []} />;
              return (
                <div
                  key={n.hash}
                  role="option"
                  aria-selected={selected}
                  className={`jb-row${selected ? ' selected' : ''}${onBranch?.has(n.hash) ? ' current-branch' : ''}`}
                  style={{ top: i * JB_ROW }}
                  onClick={(e) => clickNode(n, e)}
                  onContextMenu={(e) => onContextMenu(n, e)}
                >
                  <span className="jb-colsubject">
                    <JbGraphCell row={graphRows[i]!} head={head} dashedNode={!!n.kind} />
                    {opts.refsOnLeft && refEl}
                    {n.kind === 'wip' ? (
                      <span className="jb-subject jb-wip">
                        Uncommitted changes
                        <span className="jb-wipc">
                          {st.conflicted.length > 0 && <span style={{ color: 'var(--danger)' }}>⚠ {st.conflicted.length}</span>}
                          {st.unstaged.length > 0 && <span style={{ color: 'var(--warning)' }}>✎ {st.unstaged.length}</span>}
                          {st.staged.length > 0 && <span style={{ color: 'var(--vcs-added)' }}>✓ {st.staged.length}</span>}
                        </span>
                      </span>
                    ) : n.kind === 'stash' ? (
                      <span className="jb-subject jb-muted">
                        <IconStash width={12} height={12} style={{ verticalAlign: -2, marginRight: 5 }} />
                        {n.subject}
                      </span>
                    ) : (
                      <span className={`jb-subject${head ? ' head' : ''}${merge ? ' merge' : ''}`} title={n.subject}>
                        {n.subject}
                      </span>
                    )}
                    {!opts.refsOnLeft && refEl}
                  </span>
                  {opts.showAuthor && (
                    <span className={`jb-colauthor jb-muted${mine ? ' mine' : ''}`} title={n.kind ? undefined : `${n.author} <${n.email}>`}>
                      {n.kind ? '' : n.author}
                    </span>
                  )}
                  {opts.showDate && <span className="jb-coldate jb-muted">{n.kind === 'wip' ? '' : jbTime(n.time)}</span>}
                  {opts.showHash && <span className="jb-colhash jb-muted">{n.kind ? '' : n.hash.slice(0, 8)}</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {pick === 'branch' && <Palette placeholder="Filter by branch or tag — type to search" items={branchItems} onClose={() => setPick(null)} />}
      {pick === 'user' && <Palette placeholder="Filter by author — type to search" items={userItems} onClose={() => setPick(null)} />}
    </div>
  );
}

function FilterButton({ label, value, onOpen, onClear }: { label: string; value: string | null; onOpen: (e: React.MouseEvent) => void; onClear: () => void }) {
  return (
    <span className={`jb-filterbtn${value ? ' active' : ''}`}>
      <button className="jb-filtermain" onClick={onOpen}>
        {label}
        {value && <span className="jb-filtervalue">{value}</span>}
        <IconChevron width={10} height={10} className="jb-chevron" />
      </button>
      {value && (
        <button className="jb-filterclear" onClick={onClear} title={`Clear ${label.toLowerCase()} filter`}>
          <IconX width={9} height={9} />
        </button>
      )}
    </span>
  );
}

const KIND_CLASS = { head: 'ref-head', local: 'ref-local', remote: 'ref-remote', tag: 'ref-tag' } as const;

function Refs({ refs, left, labelsOf }: { refs: JbRefLabel[]; left: boolean; labelsOf: () => import('../RepoContext').RefLabel[] }) {
  const ctx = useRepo();
  const ui = useUI();
  return (
    <span
      className={`jb-refs${left ? ' left' : ''}`}
      onContextMenu={(e) => {
        const ls = labelsOf();
        if (!ls.length) return;
        e.preventDefault();
        e.stopPropagation();
        ui.menu(e, ls.length === 1 ? labelMenu(ctx, ls[0]) : ls.map((l) => ({ label: `${l.kind === 'tag' ? 'Tag' : 'Branch'} ${l.name}`, submenu: labelMenu(ctx, l) })));
      }}
    >
      {refs.map((r, i) => (
        <span key={i} className={`jb-ref ${KIND_CLASS[r.kind]}`} title={r.title}>
          {r.text}
        </span>
      ))}
    </span>
  );
}
