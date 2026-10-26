// What every part of a project tab reads: the repository data, the shared actions, selection and the
// centre view — the same shape as the desktop's RepoCtxValue, plus RN theme tokens and layout.
import { createContext, useContext } from "react";
import type { GitClient } from "../shared/core/git-client";
import type { MenuCtx, RefLabel } from "../shared/core/menus";
import type { CenterView, Selection } from "../shared/core/types";
import type { Tokens } from "./theme";

export interface RepoCtxValue extends MenuCtx {
  repo: string;
  git: GitClient;
  selection: Selection;
  center: CenterView;
  setCenter: (v: CenterView) => void;
  /** The floating diff/merge frame also covers the details panel (⤢). */
  expanded: boolean;
  toggleExpanded: () => void;
  busy: string | null;
  progress: string;
  labels: Map<string, RefLabel[]>;
  history: { undo: string | null; redo: string | null };
  t: Tokens;
  compact: boolean;
  /** Phone layout: details and the sidebar open as sheets over the graph. */
  narrow: boolean;
  openSidebar: () => void;
  /** Selects a commit and scrolls the graph to it (sidebar clicks). */
  jumpTo: (hash: string) => void;
  jump: { hash: string; seq: number } | null;
}

export const RepoCtx = createContext<RepoCtxValue>(null as unknown as RepoCtxValue);
export const useRepo = () => useContext(RepoCtx);
