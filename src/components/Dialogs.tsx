import { useEffect, useMemo, useRef, useState } from 'react';
import { app, errorMessage, git } from '../lib/api';
import type { CustomCommand, Settings } from '../lib/types';
import { Modal, useUI } from './Overlays';
import { keyLabel } from '../lib/keys';

export function CloneDialog({ settings, onClose, onOpened }: { settings: Settings; onClose: () => void; onOpened: (repo: string) => void }) {
  const ui = useUI();
  const [url, setUrl] = useState('');
  const [parent, setParent] = useState(settings.defaultCloneDir);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const guessed = useMemo(() => /([^/:]+?)(\.git)?\/?$/.exec(url.trim())?.[1] ?? '', [url]);
  const folder = name || guessed;
  const target = parent && folder ? `${parent.replace(/\/$/, '')}/${folder}` : '';

  useEffect(() => app.onProgress((p) => p.repo === target && setProgress(p.text.split(/[\r\n]/).filter(Boolean).pop() ?? '')), [target]);

  const clone = async () => {
    if (!url.trim() || !target) return;
    if (await app.exists(target)) return ui.toast('error', 'Folder already exists', target);
    setBusy(true);
    try {
      await app.clone(url.trim(), target);
      await app.setSettings({ defaultCloneDir: parent });
      const repo = await app.openRepo(target);
      if (repo) onOpened(repo);
      onClose();
    } catch (e) {
      ui.toast('error', 'Clone failed', errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Clone a repository"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <button className="btn ghost" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="btn green" disabled={busy || !url.trim() || !target} onClick={clone}>
            {busy ? 'Cloning…' : 'Clone the repo!'}
          </button>
        </>
      }
    >
      <label className="f">
        URL
        <input className="input" autoFocus placeholder="https://github.com/user/repo.git" value={url} onChange={(e) => setUrl(e.target.value)} />
      </label>
      <label className="f">
        Where to clone to
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={parent} onChange={(e) => setParent(e.target.value)} />
          <button className="btn" onClick={async () => setParent((await app.pickDirectory(parent)) ?? parent)}>
            Browse
          </button>
        </div>
      </label>
      <label className="f">
        Folder name
        <input className="input" placeholder={guessed} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {target && <div className="msg">Full path: {target}</div>}
      {busy && <div className="msg" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{progress || 'Starting…'}</div>}
    </Modal>
  );
}

export function InitDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (repo: string) => void }) {
  const ui = useUI();
  const [parent, setParent] = useState('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('main');
  const [readme, setReadme] = useState(true);
  const target = parent && name ? `${parent.replace(/\/$/, '')}/${name}` : '';

  const create = async () => {
    try {
      await app.init(target, branch || undefined);
      if (readme) {
        await git.writeWorkingFile(target, 'README.md', `# ${name}\n`);
        await git.stageAll(target);
        await git.commit(target, 'Initial commit', {});
      }
      const repo = await app.openRepo(target);
      if (repo) onOpened(repo);
      onClose();
    } catch (e) {
      ui.toast('error', 'Init failed', errorMessage(e));
    }
  };

  return (
    <Modal
      title="Initialize a repository"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn green" disabled={!target} onClick={create}>
            Create repository
          </button>
        </>
      }
    >
      <label className="f">
        Name
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="f">
        Initialize in
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input" value={parent} onChange={(e) => setParent(e.target.value)} />
          <button className="btn" onClick={async () => setParent((await app.pickDirectory()) ?? parent)}>
            Browse
          </button>
        </div>
      </label>
      <label className="f">
        Default branch
        <input className="input" value={branch} onChange={(e) => setBranch(e.target.value)} />
      </label>
      <label className="toggle-check">
        <input type="checkbox" checked={readme} onChange={(e) => setReadme(e.target.checked)} />
        Create README.md and an initial commit
      </label>
      {target && <div className="msg">Full path: {target}</div>}
    </Modal>
  );
}

export function SettingsDialog({
  repo,
  settings,
  onChange,
  onClose,
}: {
  repo: string | null;
  settings: Settings;
  onChange: (s: Settings) => void;
  onClose: () => void;
}) {
  const ui = useUI();
  const [cfg, setCfg] = useState({ globalName: '', globalEmail: '', localName: '', localEmail: '' });
  const [s, setS] = useState(settings);
  const loaded = useRef<typeof cfg | null>(null);

  useEffect(() => {
    void git.getConfig(repo).then((c) => {
      loaded.current = c;
      setCfg(c);
    });
  }, [repo]);

  const save = async () => {
    try {
      const old = loaded.current!;
      if (cfg.globalName !== old.globalName) await git.setConfig(null, 'global', 'user.name', cfg.globalName);
      if (cfg.globalEmail !== old.globalEmail) await git.setConfig(null, 'global', 'user.email', cfg.globalEmail);
      if (repo && cfg.localName !== old.localName) await git.setConfig(repo, 'local', 'user.name', cfg.localName);
      if (repo && cfg.localEmail !== old.localEmail) await git.setConfig(repo, 'local', 'user.email', cfg.localEmail);
      const customCommands = s.customCommands.filter((c) => c.name.trim() && c.command.trim());
      onChange(await app.setSettings({ ...s, customCommands }));
      onClose();
    } catch (e) {
      ui.toast('error', 'Could not save preferences', errorMessage(e));
    }
  };

  const field = (label: string, key: keyof typeof cfg, placeholder?: string) => (
    <label className="f">
      {label}
      <input className="input" placeholder={placeholder} value={cfg[key]} onChange={(e) => setCfg({ ...cfg, [key]: e.target.value })} />
    </label>
  );

  return (
    <Modal
      title="Preferences"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn green" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <b>Git identity (global)</b>
      {field('Name', 'globalName')}
      {field('Email', 'globalEmail')}
      {repo && (
        <>
          <b>This repository only (overrides global)</b>
          {field('Name', 'localName', cfg.globalName)}
          {field('Email', 'localEmail', cfg.globalEmail)}
        </>
      )}
      <b>General</b>
      <label className="f">
        Auto-fetch interval (minutes, 0 = off)
        <input className="input" type="number" min={0} value={s.autoFetchMinutes} onChange={(e) => setS({ ...s, autoFetchMinutes: Number(e.target.value) })} />
      </label>
      <label className="f">
        Default pull behaviour
        <select className="input" value={s.pullMode} onChange={(e) => setS({ ...s, pullMode: e.target.value as Settings['pullMode'] })}>
          <option value="ff">Fast-forward if possible (merge otherwise)</option>
          <option value="ff-only">Fast-forward only</option>
          <option value="rebase">Rebase</option>
        </select>
      </label>
      <label className="f">
        Date format
        <select className="input" value={s.dateFormat} onChange={(e) => setS({ ...s, dateFormat: e.target.value as Settings['dateFormat'] })}>
          <option value="relative">Relative (3 days ago)</option>
          <option value="absolute">Absolute (2026-10-26 09:30)</option>
        </select>
      </label>
      <label className="f">
        Default clone directory
        <input className="input" value={s.defaultCloneDir} onChange={(e) => setS({ ...s, defaultCloneDir: e.target.value })} />
      </label>
      <label className="f">
        Appearance
        <select className="input" value={s.theme ?? 'dark'} onChange={(e) => setS({ ...s, theme: e.target.value as Settings['theme'] })}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
          <option value="system">Match system</option>
          <option value="schedule">Auto by time of day</option>
        </select>
      </label>
      {s.theme === 'schedule' && (
        <div style={{ display: 'flex', gap: 12 }}>
          <label className="f" style={{ flex: 1 }}>
            Light from
            <input className="input" type="time" value={s.lightFrom ?? '06:00'} onChange={(e) => setS({ ...s, lightFrom: e.target.value })} />
          </label>
          <label className="f" style={{ flex: 1 }}>
            Dark from
            <input className="input" type="time" value={s.darkFrom ?? '18:00'} onChange={(e) => setS({ ...s, darkFrom: e.target.value })} />
          </label>
        </div>
      )}
      <label className="toggle-check">
        <input type="checkbox" checked={s.compact} onChange={(e) => setS({ ...s, compact: e.target.checked })} />
        {keyLabel('Compact commit graph (denser rows, no avatars) — ⇧⌘M')}
      </label>
      <label className="toggle-check">
        <input type="checkbox" checked={s.pushAfterCommit} onChange={(e) => setS({ ...s, pushAfterCommit: e.target.checked })} />
        Push after commit by default
      </label>
      <b>Custom commands</b>
      <div className="msg">
        Run from the command palette (repository commands) or right-click menus of commits, branches and files. Variables are shell-quoted:{' '}
        <code>${'{repo}'}</code> <code>${'{sha}'}</code> <code>${'{branch}'}</code> <code>${'{file}'}</code> <code>${'{head}'}</code>
      </div>
      {s.customCommands.map((c, i) => {
        const set = (patch: Partial<CustomCommand>) =>
          setS({ ...s, customCommands: s.customCommands.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
        return (
          <div key={i} className="cc-row">
            <input className="input" placeholder="Name" value={c.name} onChange={(e) => set({ name: e.target.value })} />
            <input className="input" placeholder="npm test -- ${file}" style={{ fontFamily: 'var(--mono)' }} value={c.command} onChange={(e) => set({ command: e.target.value })} />
            <select className="input" value={c.target} onChange={(e) => set({ target: e.target.value as CustomCommand['target'] })}>
              <option value="repo">Repository</option>
              <option value="commit">Commit</option>
              <option value="branch">Branch</option>
              <option value="file">File</option>
            </select>
            <label className="toggle-check" title="Always show the command output">
              <input type="checkbox" checked={c.showOutput} onChange={(e) => set({ showOutput: e.target.checked })} />
              Output
            </label>
            <button className="btn ghost" onClick={() => setS({ ...s, customCommands: s.customCommands.filter((_, k) => k !== i) })}>
              ✕
            </button>
          </div>
        );
      })}
      <div>
        <button
          className="btn"
          onClick={() => setS({ ...s, customCommands: [...s.customCommands, { name: '', command: '', target: 'repo', showOutput: true }] })}
        >
          + Add command
        </button>
      </div>
    </Modal>
  );
}

export interface PaletteItem {
  label: string;
  hint?: string;
  run: () => void;
}

export function Palette({ items, onClose, placeholder }: { items: PaletteItem[]; onClose: () => void; placeholder?: string }) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter((it) => words.every((w) => it.label.toLowerCase().includes(w))).slice(0, 60);
  }, [q, items]);
  useEffect(() => setIdx(0), [q]);
  const exec = (it?: PaletteItem) => {
    if (!it) return;
    onClose();
    it.run();
  };
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal palette">
        <input
          className="input"
          autoFocus
          placeholder={placeholder ?? 'Type a command or branch name…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(filtered.length - 1, i + 1));
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(0, i - 1));
            if (e.key === 'Enter') exec(filtered[idx]);
          }}
        />
        <div className="palette-list">
          {filtered.map((it, i) => (
            <div key={it.label} className={`palette-item${i === idx ? ' on' : ''}`} onMouseEnter={() => setIdx(i)} onClick={() => exec(it)}>
              {it.label}
              {it.hint && <span className="k">{keyLabel(it.hint)}</span>}
            </div>
          ))}
          {!filtered.length && <div className="palette-item">No matches</div>}
        </div>
      </div>
    </div>
  );
}
