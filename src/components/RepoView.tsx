import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { app, errorMessage, git } from '../lib/api';
import { relativeTime } from '../lib/format';
import { WORKTREE, type CenterView, type Selection, type Settings } from '../lib/types';
import { createActions, type CommandOutput, type RefPickRequest } from '../lib/actions';
import { useUI } from './Overlays';
import { buildRefLabels, RepoCtx, type Actions, type RepoCtxValue, type RepoData } from './RepoContext';
import { Toolbar } from './Toolbar';
import { Sidebar } from './Sidebar';
import { GraphView } from './GraphView';
import { WipPanel } from './WipPanel';
import { CommitPanel, StashPanel } from './CommitPanel';
import { DiffView } from './DiffView';
import { ConflictView } from './ConflictView';
import { BlameView, HistoryView } from './FileViews';
import { RebaseDialog } from './RebaseDialog';
import { Palette, type PaletteItem } from './Dialogs';
import { ComparePanel } from './ComparePanel';
import { FileContentView } from './FileViews';
import { Modal } from './Overlays';
import { ErrorBoundary } from './ErrorBoundary';

const PAGE = 2000;

const STATE_LABEL: Record<string, string> = {
  merging: 'Merge in progress',
  rebasing: 'Rebase in progress',
  'cherry-picking': 'Cherry-pick in progress',
  reverting: 'Revert in progress',
};

const EMPTY: RepoData = {
  commits: [],
  refs: { local: [], remote: [], tags: [], head: null, headSha: null, headDetached: false },
  status: { branch: null, upstream: null, ahead: 0, behind: 0, staged: [], unstaged: [], conflicted: [] },
  stashes: [],
  remotes: [],
  state: { state: 'clean', mergeMsg: '', mergeHead: null, gitDir: '' },
  submodules: [],
  hasMore: false,
};

export function RepoView({
  repo,
  active,
  settings,
  menuCommand,
  onAppCommand,
  onSettings,
  extraPalette,
}: {
  repo: string;
  active: boolean;
  settings: Settings;
  menuCommand: { cmd: string; seq: number } | null;
  onAppCommand: (cmd: 'open' | 'clone' | 'init' | 'prefs') => void;
  onSettings: (patch: Partial<Settings>) => void;
  /** Items contributed by the app shell (switching to other repositories). */
  extraPalette: PaletteItem[];
}) {
  const ui = useUI();
  const [data, setData] = useState<RepoData>(EMPTY);
  const [selection, setSelection] = useState<Selection>(null);
  const [center, setCenter] = useState<CenterView>({ kind: 'graph' });
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftW, setLeftW] = useState(260);
  const [rightW, setRightW] = useState(380);
  const [rebaseBase, setRebaseBase] = useState<string | null | undefined>(undefined);
  const [findSeq, setFindSeq] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Picker of refs: 'all' (branches + tags), 'branches' only, or 'revisions' (commits from history). */
  const [refPick, setRefPick] = useState<RefPickRequest | null>(null);
  const [cmdOutput, setCmdOutput] = useState<CommandOutput | null>(null);
  const limit = useRef(PAGE);
  const loading = useRef(false);
  const pending = useRef(false);

  // ------------------------------------------------------------ loading

  const refresh = useCallback(
    async (full = true) => {
      // Coalesce bursts of watcher events into at most one queued reload.
      if (loading.current) {
        pending.current = true;
        return;
      }
      loading.current = true;
      try {
        const [refs, status, stashes, state] = await Promise.all([
          git.refs(repo),
          git.status(repo),
          git.stashes(repo),
          git.repoState(repo),
        ]);
        let next: Partial<RepoData> = { refs, status, stashes, state };
        if (full) {
          const [commits, remotes, submodules] = await Promise.all([
            git.log(repo, { limit: limit.current }),
            git.remotes(repo),
            git.submodules(repo),
          ]);
          next = { ...next, commits, remotes, submodules, hasMore: commits.length >= limit.current };
        }
        setData((d) => ({ ...d, ...next }));
      } catch (e) {
        ui.toast('error', 'Failed to load repository', errorMessage(e));
      } finally {
        loading.current = false;
        if (pending.current) {
          pending.current = false;
          void refresh(true);
        }
      }
    },
    [repo, ui],
  );

  useEffect(() => {
    void refresh(true);
    const off = app.onRepoChanged((r) => r === repo && refresh(true));
    const offP = app.onProgress((p) => {
      if (p.repo !== repo) return;
      const line = p.text.split(/[\r\n]/).filter((l) => l.trim()).pop();
      if (line) setProgress(line.trim());
    });
    return () => {
      off();
      offP();
    };
  }, [repo, refresh]);

  // Auto-fetch in the background, quietly.
  useEffect(() => {
    if (!settings.autoFetchMinutes || !data.remotes.length) return;
    const t = setInterval(() => {
      git.fetch(repo, { prune: true }).then(() => refresh(true)).catch(() => {});
    }, settings.autoFetchMinutes * 60000);
    return () => clearInterval(t);
  }, [repo, settings.autoFetchMinutes, data.remotes.length, refresh]);

  // Selecting WIP by default when there are changes and nothing else is selected.
  const wipCount = data.status.staged.length + data.status.unstaged.length + data.status.conflicted.length;
  useEffect(() => {
    if (selection == null && wipCount > 0) setSelection({ kind: 'wip' });
  }, [wipCount, selection]);

  // ------------------------------------------------------------ actions

  const run = useCallback<Actions['run']>(
    async (label, fn, opts) => {
      setBusy(label);
      setProgress('');
      try {
        await fn();
        if (opts?.success) ui.toast('success', opts.success);
        return true;
      } catch (e) {
        const msg = errorMessage(e);
        // A conflict is not a failure: the operation is paused for the user to resolve it.
        if (/CONFLICT|could not apply|after resolving the conflicts/i.test(msg)) {
          const files = [...msg.matchAll(/Merge conflict in (.+)/g)].map((m) => m[1]);
          ui.toast(
            'info',
            `${label}: conflicts to resolve`,
            `${files.length ? files.join(', ') + '\n' : ''}Click "Resolve conflicts" in the orange bar, or "Abort" to go back.`,
          );
        } else ui.toast('error', `${label} failed`, msg);
        return false;
      } finally {
        setBusy(null);
        setProgress('');
        await refresh(true);
      }
    },
    [ui, refresh],
  );

  const actions = useMemo<Actions>(
    () =>
      createActions({
        repo,
        data,
        git,
        ui,
        app,
        errorMessage,
        pullMode: settings.pullMode,
        wipCount,
        selection,
        centerKind: center.kind,
        refresh,
        run,
        loadMore: () => {
          limit.current += PAGE;
          void refresh(true);
        },
        setSelection,
        setCenter,
        setRebaseBase,
        setRefPick,
        setBusy,
        setCmdOutput,
      }),
    [data, repo, run, refresh, ui, settings.pullMode, wipCount, selection, center.kind]);

  // "Expand" from a diff: hide both side panels, or bring them back if they are already hidden.
  useEffect(() => {
    if (!active) return;
    const h = () => {
      const anyOpen = leftOpen || rightOpen;
      setLeftOpen(!anyOpen);
      setRightOpen(!anyOpen);
    };
    window.addEventListener('gitkrane:focusCenter', h);
    return () => window.removeEventListener('gitkrane:focusCenter', h);
  }, [active, leftOpen, rightOpen]);

  // ------------------------------------------------------------ menu commands

  const lastSeq = useRef(0);
  useEffect(() => {
    if (!active || !menuCommand || menuCommand.seq === lastSeq.current) return;
    lastSeq.current = menuCommand.seq;
    const map: Record<string, () => void> = {
      fetch: actions.fetch,
      pull: () => actions.pull(),
      push: () => actions.push(),
      branch: () => actions.createBranch(),
      stash: actions.stash,
      pop: actions.pop,
      undo: actions.undo,
      redo: actions.redo,
      terminal: () => void app.openTerminal(repo),
      reveal: () => void app.showInFolder(repo),
      toggleLeft: () => setLeftOpen((v) => !v),
      toggleRight: () => setRightOpen((v) => !v),
      find: () => {
        setCenter({ kind: 'graph' });
        setFindSeq((n) => n + 1);
      },
      stageAll: () => void run('Stage all', () => git.stageAll(repo)),
      commit: () => window.dispatchEvent(new CustomEvent('gitkrane:commit', { detail: repo })),
      palette: () => setPaletteOpen(true),
      compact: () => onSettings({ compact: !settings.compact }),
    };
    map[menuCommand.cmd]?.();
  }, [menuCommand, active, actions, repo, run, onSettings, settings.compact]);

  const labels = useMemo(() => buildRefLabels(data.refs), [data.refs]);

  const paletteItems = useMemo<PaletteItem[]>(
    () => [
      { label: 'Fetch all', hint: '⇧⌘F', run: actions.fetch },
      { label: 'Pull', hint: '⇧⌘L', run: () => actions.pull() },
      { label: 'Pull (rebase)', run: () => actions.pull('rebase') },
      { label: 'Push', hint: '⇧⌘P', run: () => actions.push() },
      { label: 'Force push', run: () => actions.push({ force: true }) },
      { label: 'Create branch', hint: '⌘B', run: () => actions.createBranch() },
      { label: 'Stash changes', hint: '⇧⌘S', run: actions.stash },
      { label: 'Pop stash', hint: '⇧⌘O', run: actions.pop },
      { label: 'Stage all changes', hint: '⇧⌘A', run: () => void run('Stage all', () => git.stageAll(repo)) },
      { label: 'Unstage all changes', run: () => void run('Unstage all', () => git.unstageAll(repo)) },
      { label: 'Undo', hint: '⌘Z', run: actions.undo },
      { label: 'Redo', hint: '⇧⌘Z', run: actions.redo },
      { label: 'Add remote', run: actions.addRemote },
      {
        label: 'Compare branches…',
        run: () =>
          actions.pickRef('Compare: choose the first branch (from)', (a1) =>
            setTimeout(() => actions.pickRef(`Compare ${a1} with… (to)`, (b1) => setSelection({ kind: 'compare', from: a1, to: b1 }), { worktree: true }), 0),
          ),
      },
      { label: 'Interactive rebase (from upstream)', run: () => actions.interactiveRebase(data.status.upstream) },
      { label: 'Open in Terminal', hint: '⌥T', run: () => void app.openTerminal(repo) },
      { label: 'Reveal in Finder', run: () => void app.showInFolder(repo) },
      { label: 'Open repository…', hint: '⌘O', run: () => onAppCommand('open') },
      { label: 'Clone repository…', hint: '⌘N', run: () => onAppCommand('clone') },
      { label: 'Init repository…', run: () => onAppCommand('init') },
      { label: 'Preferences', hint: '⌘,', run: () => onAppCommand('prefs') },
      ...data.refs.local.filter((b) => !b.current).map((b) => ({ label: `Checkout ${b.name}`, run: () => actions.checkout(b.name) })),
      ...data.refs.local.filter((b) => !b.current).map((b) => ({ label: `Merge ${b.name} into current`, run: () => actions.merge(b.name) })),
      ...data.refs.remote.map((rb) => ({ label: `Checkout ${rb.name}`, run: () => actions.checkoutRemote(rb) })),
      { label: settings.compact ? 'Compact mode: off' : 'Compact mode: on', hint: '⇧⌘M', run: () => onSettings({ compact: !settings.compact }) },
      ...settings.customCommands.filter((c) => c.target === 'repo').map((c) => ({ label: `Run: ${c.name}`, run: () => actions.runCustom(c, {}) })),
      ...extraPalette,
    ],
    [actions, data.refs, data.status.upstream, repo, run, onAppCommand, onSettings, settings.compact, settings.customCommands, extraPalette],
  );

  const ctx: RepoCtxValue = {
    repo,
    data,
    actions,
    selection,
    select: (s) => {
      setSelection(s);
      // Picking another node closes a file view that belonged to the previous one.
      if (center.kind === 'diff') setCenter({ kind: 'graph' });
    },
    center,
    setCenter,
    settings,
    busy,
    labels,
  };

  const startDrag = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    const startX = e.clientX;
    const start = side === 'left' ? leftW : rightW;
    const move = (ev: MouseEvent) => {
      const d = ev.clientX - startX;
      if (side === 'left') setLeftW(Math.max(180, Math.min(500, start + d)));
      else setRightW(Math.max(300, Math.min(700, start - d)));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!active) return null;

  return (
    <RepoCtx.Provider value={ctx}>
      <Toolbar progress={busy ? progress : ''} />
      <div className="workspace">
        {leftOpen && (
          <>
            <div className="panel-left" style={{ width: leftW }}>
              <Sidebar />
            </div>
            <div className="resizer" onMouseDown={startDrag('left')} />
          </>
        )}
        <div className="center">
          {data.state.state !== 'clean' && (
            // Always visible while an operation is in progress, whatever is selected — the way out
            // (Abort) must never depend on which panel happens to be open.
            <div className="state-bar">
              <span className="flex">
                <b>{STATE_LABEL[data.state.state]}</b>
                {data.status.conflicted.length
                  ? ` — ${data.status.conflicted.length} conflicted file${data.status.conflicted.length > 1 ? 's' : ''}`
                  : ' — no conflicts left, commit or continue to finish'}
              </span>
              {data.status.conflicted.length > 0 && (
                <button className="btn" onClick={() => setCenter({ kind: 'conflict', file: data.status.conflicted[0].path })}>
                  Resolve conflicts
                </button>
              )}
              {data.state.state === 'rebasing' && (
                <button className="btn" onClick={actions.skip}>
                  Skip commit
                </button>
              )}
              {data.status.conflicted.length === 0 &&
                (data.state.state === 'merging' ? (
                  <button className="btn green" onClick={() => setSelection({ kind: 'wip' })}>
                    Commit merge…
                  </button>
                ) : (
                  <button className="btn green" onClick={actions.continueOp}>
                    Continue
                  </button>
                ))}
              <button className="btn red" onClick={actions.abort}>
                Abort {data.state.state === 'merging' ? 'merge' : data.state.state === 'rebasing' ? 'rebase' : data.state.state === 'cherry-picking' ? 'cherry-pick' : 'revert'}
              </button>
            </div>
          )}
          <ErrorBoundary resetKey={JSON.stringify(center)} onReset={() => setCenter({ kind: 'graph' })}>
          {center.kind === 'graph' && <GraphView findSeq={findSeq} />}
          {center.kind === 'diff' && <DiffView key={`${center.file.path}:${JSON.stringify(center.source)}`} view={center} />}
          {center.kind === 'conflict' && <ConflictView key={center.file} file={center.file} />}
          {center.kind === 'history' && <HistoryView key={center.file} file={center.file} />}
          {center.kind === 'blame' && <BlameView key={center.file + center.rev} file={center.file} rev={center.rev} />}
          {center.kind === 'file' && <FileContentView key={center.file + center.rev} file={center.file} rev={center.rev} />}
          </ErrorBoundary>
        </div>
        {rightOpen && (
          <>
            <div className="resizer" onMouseDown={startDrag('right')} />
            <div className="panel-right" style={{ width: rightW }}>
              {selection?.kind === 'wip' || (selection == null && data.state.state !== 'clean') ? (
                <WipPanel />
              ) : selection?.kind === 'commit' ? (
                <CommitPanel key={selection.hash} hash={selection.hash} />
              ) : selection?.kind === 'stash' ? (
                <StashPanel key={selection.stash.hash} stash={selection.stash} />
              ) : selection?.kind === 'compare' ? (
                <ComparePanel key={selection.from + selection.to} from={selection.from} to={selection.to} />
              ) : (
                <div className="empty-files" style={{ padding: 20 }}>
                  Select a commit to view its details.
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="statusbar">
        <span className="flex">{repo}</span>
        {data.state.state !== 'clean' && <span style={{ color: 'var(--orange)' }}>{data.state.state.toUpperCase()}</span>}
        <span>{data.commits.length} commits</span>
        <span>
          {data.refs.local.length} branches · {data.refs.tags.length} tags
        </span>
      </div>
      {cmdOutput && (
        <Modal
          title={`${cmdOutput.name} — exit code ${cmdOutput.code}`}
          wide
          onClose={() => setCmdOutput(null)}
          footer={
            <button className="btn green" onClick={() => setCmdOutput(null)}>
              Close
            </button>
          }
        >
          <div className="msg" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>
            $ {cmdOutput.command}
          </div>
          <div className="cmd-output">
            {cmdOutput.stdout || (!cmdOutput.stderr && '(no output)')}
            {cmdOutput.stderr && <span className="err">{cmdOutput.stderr}</span>}
          </div>
        </Modal>
      )}
      {paletteOpen && <Palette items={paletteItems} onClose={() => setPaletteOpen(false)} />}
      {refPick && (
        <Palette
          placeholder={`${refPick.title}  — ${refPick.kind === 'revisions' ? 'type message, author or SHA' : 'type to filter'}`}
          onClose={() => setRefPick(null)}
          items={
            refPick.kind === 'revisions'
              ? data.commits
                  .filter((c) => c.hash !== refPick.exclude)
                  .map((c) => ({
                    label: `${c.hash.slice(0, 7)}  ${c.subject}`,
                    hint: `${c.author} · ${relativeTime(c.time)}`,
                    run: () => refPick.onPick(c.hash),
                  }))
              : [
                  ...(refPick.worktree ? [{ label: 'Working tree (uncommitted changes)', hint: 'worktree', run: () => refPick.onPick(WORKTREE) }] : []),
                  ...data.refs.local.map((b) => ({ label: b.name, hint: b.current ? 'checked out' : 'local', run: () => refPick.onPick(b.name) })),
                  ...data.refs.remote.map((r) => ({ label: r.name, hint: 'remote', run: () => refPick.onPick(r.name) })),
                  ...(refPick.kind === 'branches'
                    ? []
                    : data.refs.tags.map((t) => ({ label: t.name, hint: 'tag', run: () => refPick.onPick(`tags/${t.name}`) }))),
                ].filter((it) => it.label !== refPick.exclude && `tags/${it.label}` !== refPick.exclude)
          }
        />
      )}
      {rebaseBase !== undefined && <RebaseDialog base={rebaseBase} onClose={() => setRebaseBase(undefined)} />}
    </RepoCtx.Provider>
  );
}
