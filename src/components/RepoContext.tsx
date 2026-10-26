import { createContext, useContext } from 'react';
import type { CenterView, Selection, Settings } from '../lib/types';
import { git } from '../lib/api';
import type { Actions, MenuCtx, MenuItem, RefLabel, RepoData } from '../lib/menus';

export * from '../lib/menus';

export interface RepoCtxValue extends MenuCtx {
  repo: string;
  data: RepoData;
  actions: Actions;
  selection: Selection;
  select: (s: Selection) => void;
  center: CenterView;
  setCenter: (v: CenterView) => void;
  settings: Settings;
  busy: string | null;
  labels: Map<string, RefLabel[]>;
}

export const RepoCtx = createContext<RepoCtxValue>(null as unknown as RepoCtxValue);
export const useRepo = () => useContext(RepoCtx);

/** Menu shown when one ref is dropped onto another (GitKraken-style drag to merge/rebase). */
export function dropMenu(ctx: RepoCtxValue, source: string, target: RefLabel): MenuItem[] {
  const { actions: a, data, repo } = ctx;
  const targetName = target.local?.name ?? target.name;
  const items: MenuItem[] = [];
  if (target.current) {
    items.push({ label: `Merge ${source} into ${targetName}`, onClick: () => a.merge(source) });
    items.push({ label: `Rebase ${targetName} onto ${source}`, onClick: () => a.rebase(source) });
  } else if (target.local) {
    const local = target.local;
    items.push({
      label: `Fast-forward ${targetName} to ${source}`,
      onClick: () => a.run(`Fast-forward ${targetName}`, () => git.fastForward(repo, local.name, source)),
    });
    items.push({
      label: `Checkout ${targetName} and merge ${source}`,
      onClick: () =>
        a.run(`Merge ${source}`, async () => {
          await git.checkout(repo, local.name);
          await git.merge(repo, source);
        }),
    });
  }
  const sourceLocal = data.refs.local.find((b) => b.name === source);
  if (sourceLocal?.current && target.local && !target.current)
    items.push({ label: `Rebase ${source} onto ${targetName}`, onClick: () => a.rebase(targetName) });
  if (!items.length) items.push({ label: 'No actions available', onClick: () => {}, disabled: true });
  return items;
}
