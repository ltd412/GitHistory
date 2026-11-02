import type { Settings } from './types';
import { createGitClient } from './git-client';

interface Bridge {
  git: (method: string, ...args: unknown[]) => Promise<any>;
  app: (method: string, ...args: unknown[]) => Promise<any>;
  onRepoChanged: (cb: (repo: string) => void) => () => void;
  onProgress: (cb: (p: { repo: string; text: string }) => void) => () => void;
  onMenu: (cb: (cmd: string) => void) => () => void;
  onUpdate: (cb: (state: UpdateState) => void) => () => void;
}

/** State of the in-app updater (electron/updater.cjs). */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'password' | 'installing' | 'opened' | 'error';
  version?: string;
  notesUrl?: string;
  kind?: 'deb' | 'appimage' | 'nsis' | 'dmg' | 'manual';
  progress?: number;
  error?: string;
  /** The user asked for this check (Help › Check for Updates…), so the outcome is reported. */
  manual?: boolean;
  upToDate?: boolean;
  /** The previous password was rejected (phase `password`). */
  wrong?: boolean;
  current?: string;
}

declare global {
  interface Window {
    bridge: Bridge;
  }
}

const b = () => window.bridge;

/** Electron prefixes rejected invoke() errors with the channel name; strip it for display. */
export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

export const git = createGitClient((method, args) => b().git(method, ...args));

export const app = {
  getSettings: (): Promise<Settings> => b().app('store:get'),
  setSettings: (patch: Partial<Settings>): Promise<Settings> => b().app('store:set', patch),
  openRepo: (dir: string): Promise<string | null> => b().app('openRepo', dir),
  closeRepo: (dir: string) => b().app('closeRepo', dir),
  pickDirectory: (start?: string): Promise<string | null> => b().app('pickDirectory', start),
  clone: (url: string, dir: string): Promise<string> => b().app('clone', url, dir),
  init: (dir: string, branch?: string): Promise<string> => b().app('init', dir, branch),
  undo: (r: string): Promise<string | null> => b().app('undo', r),
  redo: (r: string): Promise<string | null> => b().app('redo', r),
  history: (r: string): Promise<{ undo: string | null; redo: string | null }> => b().app('history', r),
  showInFolder: (p: string) => b().app('showInFolder', p),
  openFile: (r: string, f: string) => b().app('openFile', r, f),
  openTerminal: (p: string) => b().app('openTerminal', p),
  openExternal: (url: string) => b().app('openExternal', url),
  copy: (text: string) => b().app('copy', text),
  exists: (p: string): Promise<boolean> => b().app('exists', p),
  initialRepo: (): Promise<string | null> => b().app('initialRepo'),
  setNativeTheme: (t: 'dark' | 'light') => b().app('setNativeTheme', t),
  runCustom: (cwd: string, command: string, vars: Record<string, string | null>): Promise<{ code: number; stdout: string; stderr: string; command: string }> =>
    b().app('runCustom', cwd, command, vars),
  onRepoChanged: (cb: (repo: string) => void) => b().onRepoChanged(cb),
  onProgress: (cb: (p: { repo: string; text: string }) => void) => b().onProgress(cb),
  onMenu: (cb: (cmd: string) => void) => b().onMenu(cb),
  updateState: (): Promise<UpdateState> => b().app('update:state').catch(() => ({ phase: 'idle' }) as UpdateState),
  updateCheck: (): Promise<UpdateState> => b().app('update:check'),
  updateApply: (): Promise<UpdateState> => b().app('update:apply'),
  /** Answers the password prompt; null cancels. The password goes to sudo only. */
  updatePassword: (password: string | null) => b().app('update:password', password),
  onUpdate: (cb: (state: UpdateState) => void) => b().onUpdate(cb),
};
