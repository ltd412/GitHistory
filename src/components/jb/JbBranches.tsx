// Branches pane of the JetBrains-style log (OpenIDEA BranchesPanel): a vertical icon toolbar and a searchable
// tree of HEAD, local branches (folders by "/"), remotes and tags. Click selects, double-click switches the
// log to that ref, the context menu is the one the Kraken sidebar uses plus "Show only this branch".
import { useMemo, useState } from 'react';
import { buildBranchTree, refTarget, type BranchNode } from '../../lib/jb';
import { IconArrowDown, IconArrowUp, IconBranch, IconChevron, IconCloud, IconFetch, IconFolder, IconPlus, IconPull, IconSearch, IconTag } from '../Icons';
import { useUI } from '../Overlays';
import { localBranchMenu, remoteBranchMenu, tagMenu, useRepo } from '../RepoContext';
import { useJbFilter } from './JbFilter';

const Locate = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </svg>
);

export function JbBranches() {
  const ctx = useRepo();
  const { data, actions: a, select, busy } = ctx;
  const ui = useUI();
  const { filter, setFilter } = useJbFilter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const tree = useMemo(() => buildBranchTree(data.refs, query), [data.refs, query]);
  const q = query.trim();

  const toggle = (id: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Selects the ref's commit and scrolls the log to it. */
  const locate = (n: BranchNode | undefined) => {
    const target = n?.ref ? refTarget(data.refs, n.ref) : data.refs.headSha;
    if (!target) return;
    select({ kind: 'commit', hash: target });
    window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: target }));
  };
  const find = (list: BranchNode[], id: string | null): BranchNode | undefined => {
    for (const n of list) {
      if (n.id === id) return n;
      const c = find(n.children, id);
      if (c) return c;
    }
    return undefined;
  };
  const current = find(tree, selected);
  const showOnly = (n: BranchNode) => setFilter({ ...filter, branch: n.ref ?? null });
  const menu = (n: BranchNode, e: React.MouseEvent) => {
    const only = { label: 'Show Only This Branch in the Log', onClick: () => showOnly(n) };
    if (n.local) ui.menu(e, [only, { separator: true }, ...localBranchMenu(ctx, n.local)]);
    else if (n.remote) ui.menu(e, [only, { separator: true }, ...remoteBranchMenu(ctx, n.remote)]);
    else if (n.tag) ui.menu(e, [only, { separator: true }, ...tagMenu(ctx, n.tag)]);
    else if (n.id === 'head') ui.menu(e, [only]);
  };

  const row = (n: BranchNode, depth: number): React.ReactNode => {
    const expandable = n.children.length > 0;
    const expanded = !closed.has(n.id) || !!q;
    const shown = !!filter.branch && n.ref === filter.branch;
    return (
      <div key={n.id}>
        <div
          className={`jb-bnode${selected === n.id ? ' selected' : ''}${n.current && n.kind !== 'group' ? ' current' : ''}${shown ? ' shown' : ''}`}
          style={{ paddingLeft: 6 + depth * 16 }}
          onClick={() => setSelected(n.id)}
          onDoubleClick={() => (n.ref ? showOnly(n) : expandable && toggle(n.id))}
          onContextMenu={(e) => {
            e.preventDefault();
            setSelected(n.id);
            menu(n, e);
          }}
          title={n.ref}
        >
          <span
            className="jb-twisty"
            onClick={(e) => {
              if (!expandable) return;
              e.stopPropagation();
              toggle(n.id);
            }}
          >
            {expandable && <IconChevron width={10} height={10} style={{ transform: expanded ? undefined : 'rotate(-90deg)' }} />}
          </span>
          {n.kind === 'tag' ? <IconTag width={14} height={14} /> : n.kind === 'remote' ? <IconCloud width={14} height={14} /> : n.kind === 'folder' ? <IconFolder width={14} height={14} /> : n.kind === 'group' && n.id !== 'head' ? null : <IconBranch width={14} height={14} className={n.current ? 'jb-cur' : undefined} />}
          <span className="jb-nm">{n.label}</span>
          {n.local && (n.local.behind > 0 || n.local.ahead > 0) && (
            <span className="jb-detail">
              {n.local.behind > 0 && (
                <>
                  <IconArrowDown width={9} height={9} />
                  {n.local.behind}{' '}
                </>
              )}
              {n.local.ahead > 0 && (
                <>
                  <IconArrowUp width={9} height={9} />
                  {n.local.ahead}
                </>
              )}
            </span>
          )}
        </div>
        {expandable && expanded && n.children.map((c) => row(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="jb-branches">
      <div className="jb-btools">
        <button className="jb-ibtn" title="New Branch…" onClick={() => a.createBranch()}>
          <IconPlus width={14} height={14} />
        </button>
        <button className="jb-ibtn" title="Fetch" disabled={!data.remotes.length || !!busy} onClick={a.fetch}>
          <IconPull width={14} height={14} />
        </button>
        <button className="jb-ibtn" title="Refresh" onClick={() => void a.refresh(true)}>
          <IconFetch width={14} height={14} />
        </button>
        <button className="jb-ibtn" title="Navigate Log to Selected Branch" onClick={() => locate(current)}>
          <Locate />
        </button>
      </div>
      <div className="jb-bmain">
        <div className="jb-bbar">
          <div className="jb-search jb-grow">
            <IconSearch width={12} height={12} />
            <input placeholder="Branch or tag" aria-label="Filter branches and tags" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
        <div className="jb-btree" role="tree" aria-label="Branches">
          {tree.map((n) => row(n, 0))}
          {!tree.length && <div className="jb-message">No matching branches</div>}
        </div>
      </div>
    </div>
  );
}
