import { useCallback, useEffect, useMemo, useState } from 'react';
import { app, git } from '../lib/api';
import { basename } from '../lib/format';
import type { ManagedRepo, RepoSummary, Settings } from '../lib/types';
import { IconArrowDown, IconArrowUp, IconBranch, IconClone, IconFolder, IconInit, IconLogo, IconSearch } from './Icons';
import { useUI } from './Overlays';

const UNGROUPED = '';
const RECENT = '\u0000recent';

/**
 * Fork-style repository manager: every known repository with its branch, ahead/behind and
 * pending-change count, grouped by user-defined groups. Shown on empty tabs.
 */
export function RepoManager({
  settings,
  onOpen,
  onSettings,
  onClone,
  onInit,
}: {
  settings: Settings;
  onOpen: (dir?: string) => void;
  onSettings: (patch: Partial<Settings>) => void;
  onClone: () => void;
  onInit: () => void;
}) {
  const ui = useUI();
  const [filter, setFilter] = useState('');
  const [summaries, setSummaries] = useState<Record<string, RepoSummary>>({});

  const managed = settings.repos;
  const recentOnly = settings.recent.filter((r) => !managed.some((m) => m.path === r));
  const all = useMemo(() => [...managed.map((m) => m.path), ...recentOnly], [managed, recentOnly]);

  const refresh = useCallback(async () => {
    // A handful at a time: `git status` on dozens of repos at once would stall the machine.
    const queue = [...all];
    const worker = async () => {
      for (let p = queue.shift(); p; p = queue.shift()) {
        const s = await git.repoSummary(p);
        setSummaries((cur) => ({ ...cur, [p]: s }));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
  }, [all.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = (repos: ManagedRepo[]) => onSettings({ repos });

  const addRepo = async () => {
    const dir = await app.pickDirectory();
    if (!dir) return;
    const top = await git.isRepoPath(dir);
    if (!top) return ui.toast('error', 'Not a Git repository', dir);
    if (!managed.some((m) => m.path === top)) save([...managed, { path: top, group: UNGROUPED }]);
  };

  const scan = async () => {
    const dir = await app.pickDirectory();
    if (!dir) return;
    const found = await git.scanRepos(dir);
    const fresh = found.filter((p) => !managed.some((m) => m.path === p));
    const v = fresh.length
      ? await ui.form({
          title: `Found ${found.length} repositories`,
          message: `${fresh.length} new:\n${fresh.slice(0, 15).map((p) => '• ' + p).join('\n')}${fresh.length > 15 ? `\n… and ${fresh.length - 15} more` : ''}`,
          fields: [{ name: 'group', label: 'Add them to group (optional)', value: basename(dir) }],
          confirm: `Add ${fresh.length}`,
        })
      : null;
    if (!fresh.length) return ui.toast('info', 'No new repositories found', dir);
    if (v) save([...managed, ...fresh.map((p) => ({ path: p, group: v.group?.trim() ?? UNGROUPED }))]);
  };

  const groups = useMemo(() => {
    const f = filter.toLowerCase();
    const match = (p: string) => !f || p.toLowerCase().includes(f) || (summaries[p]?.branch ?? '').toLowerCase().includes(f);
    const map = new Map<string, string[]>();
    for (const m of managed) {
      if (!match(m.path)) continue;
      map.set(m.group, [...(map.get(m.group) ?? []), m.path]);
    }
    const recent = recentOnly.filter(match);
    if (recent.length) map.set(RECENT, recent);
    return [...map.entries()].sort(([a], [b]) => (a === RECENT ? 1 : b === RECENT ? -1 : a.localeCompare(b)));
  }, [managed, recentOnly, filter, summaries]);

  const itemMenu = (e: React.MouseEvent, p: string) => {
    const m = managed.find((x) => x.path === p);
    const existingGroups = [...new Set(managed.map((x) => x.group).filter(Boolean))];
    ui.menu(e, [
      { label: 'Open', onClick: () => onOpen(p) },
      { label: 'Reveal in Finder', onClick: () => void app.showInFolder(p) },
      { label: 'Open in Terminal', onClick: () => void app.openTerminal(p) },
      { separator: true },
      m
        ? {
            label: 'Move to group…',
            onClick: async () => {
              const v = await ui.form({
                title: `Group for ${basename(p)}`,
                message: existingGroups.length ? `Existing groups: ${existingGroups.join(', ')}` : undefined,
                fields: [{ name: 'g', label: 'Group name (empty = no group)', value: m.group }],
              });
              if (v) save(managed.map((x) => (x.path === p ? { ...x, group: v.g.trim() } : x)));
            },
          }
        : { label: 'Add to repository list', onClick: () => save([...managed, { path: p, group: UNGROUPED }]) },
      m
        ? { label: 'Remove from list', danger: true, onClick: () => save(managed.filter((x) => x.path !== p)) }
        : { label: 'Remove from recent', danger: true, onClick: () => onSettings({ recent: settings.recent.filter((r) => r !== p) }) },
    ]);
  };

  return (
    <div className="rm">
      <div className="rm-main">
        <div className="rm-head">
          <h2>
            <IconLogo /> Repositories
          </h2>
          <div className="filter" style={{ maxWidth: 280 }}>
            <IconSearch />
            <input placeholder="Filter by name or branch" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <button className="btn" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div className="welcome" style={{ background: 'none', display: 'block', flex: 'none' }}>
          <div className="actions">
            <div className="action" onClick={() => onOpen()}>
              <IconFolder />
              <b>Open a repo</b>
              <span>Open a local repository in a tab</span>
            </div>
            <div className="action" onClick={onClone}>
              <IconClone />
              <b>Clone a repo</b>
              <span>Copy a remote repository locally</span>
            </div>
            <div className="action" onClick={onInit}>
              <IconInit />
              <b>Start a local repo</b>
              <span>Initialize a new repository</span>
            </div>
          </div>
        </div>
        <div className="rm-head">
          <span style={{ flex: 1, color: 'var(--text-dim)' }}>{all.length} repositories · double-click to open, right-click for more</span>
          <button className="btn" onClick={addRepo}>
            Add repository…
          </button>
          <button className="btn" onClick={scan}>
            Scan folder…
          </button>
        </div>
        {!groups.length && <div className="rm-empty">No repositories yet. Open, clone or scan a folder to add some.</div>}
        {groups.map(([g, paths]) => (
          <div className="rm-group" key={g}>
            <h3 className="rm-group-title">
              {g === RECENT ? 'Recently opened' : g || 'Repositories'} <span>{paths.length}</span>
            </h3>
            <div className="rm-list">
              {paths.map((p) => {
                const s = summaries[p];
                return (
                  <div key={p} className="rm-item" onDoubleClick={() => onOpen(p)} onContextMenu={(e) => itemMenu(e, p)} title={p}>
                    <IconFolder />
                    <b>{basename(p)}</b>
                    <span className="br">
                      {s?.ok === false ? (
                        <span style={{ color: 'var(--red)' }}>not a Git repository</span>
                      ) : (
                        <>
                          <IconBranch /> {s?.branch ?? '…'}
                        </>
                      )}
                    </span>
                    <span className="st">
                      {s && s.changes > 0 && <span style={{ color: 'var(--orange)' }}>✎ {s.changes}</span>}
                      {s && s.behind > 0 && (
                        <span>
                          {s.behind}
                          <IconArrowDown width={10} height={10} />
                        </span>
                      )}
                      {s && s.ahead > 0 && (
                        <span>
                          {s.ahead}
                          <IconArrowUp width={10} height={10} />
                        </span>
                      )}
                    </span>
                    <span className="p">
                      <bdi>{p}</bdi>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
