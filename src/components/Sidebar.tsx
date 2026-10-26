import { useState } from 'react';
import { app, git } from '../lib/api';
import type { LocalBranch, RemoteBranch } from '../lib/types';
import {
  IconArrowDown,
  IconArrowUp,
  IconBranch,
  IconCheck,
  IconChevron,
  IconLaptop,
  IconPlus,
  IconRemote,
  IconSearch,
  IconStash,
  IconSubmodule,
  IconTag,
  IconFolder,
} from './Icons';
import { useUI } from './Overlays';
import { localBranchMenu, remoteBranchMenu, stashMenu, tagMenu, useRepo } from './RepoContext';

interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  leaf?: LocalBranch | RemoteBranch;
}

/** Branch names with slashes (feature/x) are shown as folders, like GitKraken does. */
function buildTree<T extends LocalBranch | RemoteBranch>(items: T[], name: (t: T) => string): TreeNode {
  const root: TreeNode = { name: '', path: '', children: new Map() };
  for (const it of items) {
    const parts = name(it).split('/');
    let node = root;
    parts.forEach((p, i) => {
      const path = parts.slice(0, i + 1).join('/');
      if (!node.children.has(p)) node.children.set(p, { name: p, path, children: new Map() });
      node = node.children.get(p)!;
      if (i === parts.length - 1) node.leaf = it;
    });
  }
  return root;
}

export function Sidebar() {
  const ctx = useRepo();
  const { data, actions: a, repo, selection, select } = ctx;
  const ui = useUI();
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const f = filter.toLowerCase();
  const match = (s: string) => !f || s.toLowerCase().includes(f);
  // Flip what is shown, starting from the section's default: a closed-by-default section must
  // open on the first click (toggling the raw flag from `undefined` would just re-close it).
  const toggle = (k: string, def = true) => setCollapsed((c) => ({ ...c, [k]: c[k] === undefined ? def : !c[k] }));
  const isOpen = (k: string, def = true) => (collapsed[k] === undefined ? def : !collapsed[k]);

  const jumpTo = (hash: string) => {
    select({ kind: 'commit', hash });
    window.dispatchEvent(new CustomEvent('gitkrane:scrollTo', { detail: hash }));
  };

  const locals = data.refs.local.filter((b) => match(b.name));
  const remoteNames = data.remotes.map((r) => r.name);
  const tags = data.refs.tags.filter((t) => match(t.name));
  const stashes = data.stashes.filter((s) => match(s.message));

  const renderTree = (node: TreeNode, depth: number, kind: 'local' | 'remote', prefix: string): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const entries = [...node.children.values()].sort((x, y) => Number(!!x.leaf && !x.children.size) - Number(!!y.leaf && !y.children.size) || x.name.localeCompare(y.name));
    for (const child of entries) {
      const key = `${prefix}/${child.path}`;
      if (child.children.size) {
        out.push(
          <div key={key} className="lp-item" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => toggle(key)}>
            <IconChevron style={{ transform: isOpen(key) ? undefined : 'rotate(-90deg)' }} />
            <IconFolder />
            <span className="nm">{child.name}</span>
          </div>,
        );
        if (isOpen(key)) out.push(...renderTree(child, depth + 1, kind, prefix));
      }
      if (child.leaf) {
        if (kind === 'local') {
          const b = child.leaf as LocalBranch;
          out.push(
            <div
              key={key + ':leaf'}
              className={`lp-item${b.current ? ' current' : ''}${selection?.kind === 'commit' && selection.hash === b.target ? ' selected' : ''}`}
              style={{ paddingLeft: 26 + depth * 14 }}
              onClick={() => jumpTo(b.target)}
              onDoubleClick={() => !b.current && a.checkout(b.name)}
              onContextMenu={(e) => ui.menu(e, localBranchMenu(ctx, b))}
              title={b.upstream ? `${b.name} → ${b.upstream}` : b.name}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/gitkrane-ref', b.name)}
            >
              {b.current ? <IconCheck className="check" /> : <IconBranch />}
              <span className="nm">{child.name}</span>
              <span className="ab">
                {b.behind > 0 && (
                  <b>
                    {b.behind}
                    <IconArrowDown />
                  </b>
                )}
                {b.ahead > 0 && (
                  <b>
                    {b.ahead}
                    <IconArrowUp />
                  </b>
                )}
              </span>
            </div>,
          );
        } else {
          const rb = child.leaf as RemoteBranch;
          out.push(
            <div
              key={key + ':leaf'}
              className="lp-item"
              style={{ paddingLeft: 26 + depth * 14 }}
              onClick={() => jumpTo(rb.target)}
              onDoubleClick={() => a.checkoutRemote(rb)}
              onContextMenu={(e) => ui.menu(e, remoteBranchMenu(ctx, rb))}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/gitkrane-ref', rb.name)}
            >
              <IconBranch />
              <span className="nm">{child.name}</span>
            </div>,
          );
        }
      }
    }
    return out;
  };

  const Section = ({
    id,
    title,
    icon,
    count,
    onAdd,
    children,
    defaultOpen = true,
  }: {
    id: string;
    title: string;
    icon: React.ReactNode;
    count: number;
    onAdd?: () => void;
    children: React.ReactNode;
    defaultOpen?: boolean;
  }) => (
    <div className="lp-section">
      <div className={`lp-title${isOpen(id, defaultOpen) ? '' : ' collapsed'}`} onClick={() => toggle(id, defaultOpen)}>
        <IconChevron className="chev" />
        {icon}
        {title}
        <span className="count">{count}</span>
        {onAdd && (
          <span
            className="add"
            title={`Add ${title.toLowerCase()}`}
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <IconPlus width={12} height={12} />
          </span>
        )}
      </div>
      {isOpen(id, defaultOpen) && children}
    </div>
  );

  return (
    <>
      <div className="lp-header">
        <div className="filter">
          <IconSearch />
          <input placeholder="Filter (branches, tags, stashes)" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      </div>
      <div className="lp-scroll">
        <Section id="local" title="Local" icon={<IconLaptop className="ic" />} count={data.refs.local.length} onAdd={() => a.createBranch()}>
          {renderTree(buildTree(locals, (b) => b.name), 0, 'local', 'local')}
        </Section>
        <Section id="remote" title="Remote" icon={<IconRemote className="ic" />} count={data.remotes.length} onAdd={a.addRemote}>
          {remoteNames.map((rn) => {
            const key = `remote:${rn}`;
            const branches = data.refs.remote.filter((r) => r.remote === rn && match(r.name));
            const remote = data.remotes.find((r) => r.name === rn)!;
            return (
              <div key={rn}>
                <div
                  className="lp-item"
                  style={{ paddingLeft: 12 }}
                  onClick={() => toggle(key, false)}
                  onContextMenu={(e) =>
                    ui.menu(e, [
                      { label: `Fetch ${rn}`, onClick: () => a.run(`Fetch ${rn}`, () => git.fetch(repo, { remote: rn })) },
                      { label: 'Edit remote…', onClick: () => a.editRemote(remote) },
                      { label: 'Copy remote URL', onClick: () => a.copy(remote.fetchUrl, 'URL') },
                      { label: 'Open in browser', onClick: () => void app.openExternal(webUrl(remote.fetchUrl)) },
                      { separator: true },
                      { label: `Remove ${rn}`, onClick: () => a.removeRemote(remote), danger: true },
                    ])
                  }
                  title={remote.fetchUrl}
                >
                  <IconChevron style={{ transform: isOpen(key, false) ? undefined : 'rotate(-90deg)' }} />
                  <IconRemote />
                  <span className="nm">{rn}</span>
                  <span className="count" style={{ color: 'var(--text-faint)' }}>{branches.length}</span>
                </div>
                {isOpen(key, false) && renderTree(buildTree(branches, (r) => r.branch), 1, 'remote', key)}
              </div>
            );
          })}
        </Section>
        <Section id="tags" title="Tags" icon={<IconTag className="ic" />} count={data.refs.tags.length} defaultOpen={false}>
          {tags.map((t) => (
            <div
              key={t.name}
              className="lp-item"
              style={{ paddingLeft: 26 }}
              onClick={() => jumpTo(t.target)}
              onContextMenu={(e) => ui.menu(e, tagMenu(ctx, t))}
            >
              <IconTag />
              <span className="nm">{t.name}</span>
            </div>
          ))}
        </Section>
        <Section id="stashes" title="Stashes" icon={<IconStash className="ic" />} count={data.stashes.length}>
          {stashes.map((s) => (
            <div
              key={s.hash}
              className={`lp-item${selection?.kind === 'stash' && selection.stash.hash === s.hash ? ' selected' : ''}`}
              style={{ paddingLeft: 26 }}
              onClick={() => select({ kind: 'stash', stash: s })}
              onDoubleClick={() => a.stashApply(s, false)}
              onContextMenu={(e) => ui.menu(e, stashMenu(ctx, s))}
              title={s.message}
            >
              <IconStash />
              <span className="nm">{s.message}</span>
            </div>
          ))}
        </Section>
        <Section id="submodules" title="Submodules" icon={<IconSubmodule className="ic" />} count={data.submodules.length} defaultOpen={false}>
          {data.submodules.map((s) => (
            <div key={s.path} className="lp-item" style={{ paddingLeft: 26 }} onDoubleClick={() => void app.showInFolder(`${repo}/${s.path}`)} title={s.hash}>
              <IconSubmodule />
              <span className="nm">{s.path}</span>
              {s.state === '-' && <span className="ab">not initialized</span>}
              {s.state === '+' && <span className="ab">modified</span>}
            </div>
          ))}
        </Section>
      </div>
    </>
  );
}

/** Turns git@host:owner/repo.git or https://host/owner/repo.git into a browsable URL. */
function webUrl(url: string): string {
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+?)(?:\.git)?$/.exec(url);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return url.replace(/\.git$/, '');
}
