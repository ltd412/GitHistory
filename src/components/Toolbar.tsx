import { useEffect, useState } from 'react';
import { app } from '../lib/api';
import { basename } from '../lib/format';
import {
  IconBranch,
  IconChevron,
  IconFetch,
  IconPop,
  IconPull,
  IconPush,
  IconRedo,
  IconStash,
  IconTerminal,
  IconUndo,
  IconFolder,
} from './Icons';
import { useUI, type MenuItem } from './Overlays';
import { localBranchMenu, useRepo } from './RepoContext';
import { keyLabel } from '../lib/keys';

export function Toolbar({ progress }: { progress: string }) {
  const ctx = useRepo();
  const { repo, data, actions: a, busy } = ctx;
  const ui = useUI();
  const [hist, setHist] = useState<{ undo: string | null; redo: string | null }>({ undo: null, redo: null });

  useEffect(() => {
    void app.history(repo).then(setHist);
  }, [repo, data]);

  const current = data.refs.local.find((b) => b.current);
  const branchLabel = data.refs.headDetached
    ? `${data.refs.headSha?.slice(0, 7)} (detached)`
    : (data.refs.head ?? '—');

  const branchPicker = (e: React.MouseEvent) => {
    const items: MenuItem[] = [{ header: 'Local branches' }];
    for (const b of data.refs.local)
      items.push({ label: (b.current ? '✓ ' : '   ') + b.name, onClick: () => !b.current && a.checkout(b.name) });
    items.push({ separator: true }, { label: 'Create branch…', onClick: () => a.createBranch() });
    if (current) items.push({ separator: true }, ...localBranchMenu(ctx, current));
    ui.menu({ clientX: e.currentTarget.getBoundingClientRect().left, clientY: 56 + 38 }, items);
  };

  const pullMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    ui.menu({ clientX: e.clientX, clientY: e.clientY }, [
      { label: 'Fetch all', onClick: a.fetch },
      { label: 'Pull (fast-forward if possible)', onClick: () => a.pull('ff') },
      { label: 'Pull (fast-forward only)', onClick: () => a.pull('ff-only') },
      { label: 'Pull (rebase)', onClick: () => a.pull('rebase') },
    ]);
  };

  const pushMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    ui.menu({ clientX: e.clientX, clientY: e.clientY }, [
      { label: 'Push', onClick: () => a.push() },
      { label: 'Force push (--force-with-lease)', onClick: () => a.push({ force: true }), danger: true },
    ]);
  };

  const isBusy = (l: string) => busy === l;
  // The undo history lives in memory only; after a restart Undo can still take back a merge
  // sitting at the tip of the checked-out branch.
  const tipCommit = current ? data.commits.find((c) => c.hash === current.target) : undefined;
  const mergeTip = tipCommit && tipCommit.parents.length > 1 && data.state.state === 'clean' ? tipCommit : undefined;


  return (
    <div className="toolbar" style={{ position: 'relative' }}>
      <div className="tb-picker" onClick={() => void app.showInFolder(repo)} title={repo}>
        <span className="lbl">repository</span>
        <span className="val">
          <IconFolder width={13} height={13} /> {basename(repo)}
        </span>
      </div>
      <IconChevron width={12} height={12} style={{ color: 'var(--text-faint)', transform: 'rotate(-90deg)' }} />
      <div className="tb-picker" onClick={branchPicker}>
        <span className="lbl">branch</span>
        <span className="val">
          <IconBranch width={13} height={13} /> {branchLabel}
          <IconChevron width={10} height={10} />
        </span>
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <button
          className="tb-btn"
          disabled={(!hist.undo && !mergeTip) || !!busy}
          onClick={() => (hist.undo ? a.undo() : mergeTip && a.undoMerge(mergeTip))}
          title={hist.undo ? `Undo ${hist.undo}` : mergeTip ? `Undo merge: ${mergeTip.subject}` : 'Nothing to undo'}
        >
          <IconUndo />
          <span>Undo</span>
        </button>
        <button className="tb-btn" disabled={!hist.redo || !!busy} onClick={a.redo} title={hist.redo ? `Redo ${hist.redo}` : 'Nothing to redo'}>
          <IconRedo />
          <span>Redo</span>
        </button>
      </div>
      <div className="tb-sep" />
      <div className="tb-group">
        <button
          className={`tb-btn${isBusy('Pull') || isBusy('Fetch') ? ' busy' : ''}`}
          disabled={!data.remotes.length || !!busy}
          onClick={() => a.pull()}
          onContextMenu={pullMenu}
          title={current?.behind ? `${current.behind} commits behind` : 'Pull'}
        >
          {isBusy('Fetch') ? <IconFetch /> : <IconPull />}
          <span>Pull{current?.behind ? ` ${current.behind}` : ''}</span>
          <IconChevron className="caret" onClick={pullMenu} />
        </button>
        <button
          className={`tb-btn${isBusy('Push') ? ' busy' : ''}`}
          disabled={!data.remotes.length || !!busy}
          onClick={() => a.push()}
          onContextMenu={pushMenu}
          title={current?.ahead ? `${current.ahead} commits ahead` : 'Push'}
        >
          <IconPush />
          <span>Push{current?.ahead ? ` ${current.ahead}` : ''}</span>
          <IconChevron className="caret" onClick={pushMenu} />
        </button>
        <button className="tb-btn" disabled={!!busy} onClick={() => a.createBranch()}>
          <IconBranch />
          <span>Branch</span>
        </button>
        <button className="tb-btn" disabled={!!busy} onClick={a.stash} title={keyLabel('Stash uncommitted changes (⇧⌘S)')}>
          <IconStash />
          <span>Stash</span>
        </button>
        <button
          className="tb-btn"
          disabled={!!busy || !data.stashes.length}
          onClick={a.pop}
          title={data.stashes.length ? `Pop ${data.stashes[0].ref}: ${data.stashes[0].message}` : 'No stashes in this repository — Stash saves your changes first'}
        >
          <IconPop />
          <span>Pop</span>
        </button>
      </div>
      <div className="tb-spacer" />
      <div className="tb-group">
        <button className="tb-btn" onClick={() => void app.openTerminal(repo)}>
          <IconTerminal />
          <span>Terminal</span>
        </button>
        <button className={`tb-btn${isBusy('Fetch') ? ' busy' : ''}`} disabled={!data.remotes.length || !!busy} onClick={a.fetch}>
          <IconFetch />
          <span>Fetch</span>
        </button>
      </div>
      {busy && (
        <div style={{ position: 'absolute', right: 12, bottom: 4, fontSize: 10, color: 'var(--text-dim)', maxWidth: 400, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          {busy}… {progress}
        </div>
      )}
      {busy && <div className="progress-bar" />}
    </div>
  );
}
