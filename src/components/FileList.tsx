import { useState } from 'react';
import type { FileChange } from '../lib/types';
import { splitPath } from '../lib/format';
import { IconChevron, IconFile, IconFolder, StatusIcon } from './Icons';

export type ListMode = 'path' | 'tree';

interface Props {
  files: FileChange[];
  mode: ListMode;
  selected?: string | null;
  onClick?: (f: FileChange) => void;
  onDoubleClick?: (f: FileChange) => void;
  onContextMenu?: (e: React.MouseEvent, f: FileChange) => void;
  action?: (f: FileChange) => React.ReactNode;
  showStats?: boolean;
  /** Plain file listing (a commit's full tree): no change-status badges. */
  hideStatus?: boolean;
  /** Start with every folder collapsed (large trees). */
  startCollapsed?: boolean;
}

export function FileList(props: Props) {
  const { files, mode } = props;
  if (!files.length) return null;
  if (mode === 'path') return <div className="files">{files.map((f) => <FileRow key={f.path} f={f} depth={0} label={null} {...props} />)}</div>;
  return <div className="files"><Tree {...props} /></div>;
}

function FileRow({ f, depth, label, selected, onClick, onDoubleClick, onContextMenu, action, showStats, hideStatus }: Props & { f: FileChange; depth: number; label: string | null }) {
  const { dir, name } = splitPath(f.path);
  return (
    <div
      className={`file${selected === f.path ? ' selected' : ''}`}
      style={{ paddingLeft: 12 + depth * 14 }}
      onClick={() => onClick?.(f)}
      onDoubleClick={() => onDoubleClick?.(f)}
      onContextMenu={(e) => onContextMenu?.(e, f)}
      title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
    >
      {hideStatus ? <IconFile width={13} height={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} /> : <StatusIcon status={f.status} />}
      <span className="fp">
        <bdi>
          {label ?? (
            <>
              <span className="fdir">{dir}</span>
              {name}
            </>
          )}
        </bdi>
      </span>
      {showStats && f.additions != null && (
        <span className="stat">
          <span style={{ color: 'var(--green)' }}>+{f.additions}</span> <span style={{ color: 'var(--red)' }}>-{f.deletions}</span>
        </span>
      )}
      {action && <span className="act">{action(f)}</span>}
    </div>
  );
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: FileChange[];
}

function Tree(props: Props) {
  // Folders whose state differs from the default (open, or collapsed with startCollapsed).
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const root: Dir = { name: '', dirs: new Map(), files: [] };
  for (const f of props.files) {
    const parts = f.path.split('/');
    let d = root;
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { name: p, dirs: new Map(), files: [] });
      d = d.dirs.get(p)!;
    }
    d.files.push(f);
  }
  const out: React.ReactNode[] = [];
  const walk = (d: Dir, depth: number, prefix: string) => {
    for (const sub of [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      // Collapse single-child chains (a/b/c) into one row, as file trees usually do.
      let node = sub;
      let label = sub.name;
      while (node.dirs.size === 1 && node.files.length === 0) {
        node = [...node.dirs.values()][0];
        label += '/' + node.name;
      }
      const key = prefix + label + '/';
      const open = props.startCollapsed ? toggled.has(key) : !toggled.has(key);
      out.push(
        <div
          key={key}
          className="file"
          style={{ paddingLeft: 12 + depth * 14 }}
          onClick={() =>
            setToggled((c) => {
              const n = new Set(c);
              if (n.has(key)) n.delete(key);
              else n.add(key);
              return n;
            })
          }
        >
          <IconChevron width={10} height={10} style={{ transform: open ? undefined : 'rotate(-90deg)' }} />
          <IconFolder width={13} height={13} style={{ color: 'var(--text-dim)' }} />
          <span className="fp">
            <bdi>{label}</bdi>
          </span>
        </div>,
      );
      if (open) walk(node, depth + 1, key);
    }
    for (const f of d.files) out.push(<FileRow key={f.path} {...props} f={f} depth={depth} label={splitPath(f.path).name} />);
  };
  walk(root, 0, '');
  return <>{out}</>;
}

export function ModeToggle({ mode, onChange }: { mode: ListMode; onChange: (m: ListMode) => void }) {
  return (
    <div className="view-toggle">
      <button className={mode === 'path' ? 'on' : ''} onClick={() => onChange('path')}>
        Path
      </button>
      <button className={mode === 'tree' ? 'on' : ''} onClick={() => onChange('tree')}>
        Tree
      </button>
    </div>
  );
}
