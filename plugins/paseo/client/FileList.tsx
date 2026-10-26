// File lists of the right panel (desktop FileList): Path or Tree mode, coloured status badges, +/- stats.
import { Icon } from "./ui/sdk";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { splitPath } from "../shared/core/format";
import type { FileChange } from "../shared/core/types";
import { active, type Tokens } from "./theme";

export type ListMode = "path" | "tree";

const STATUS: Record<string, { icon: string; dark: [string, string]; light: [string, string] }> = {
  A: { icon: "Plus", dark: ["#2f6e46", "#8ff0b0"], light: ["#dafbe1", "#1a7f37"] },
  M: { icon: "Circle", dark: ["#7a5b1e", "#ffd27a"], light: ["#fff1c2", "#8a5a00"] },
  D: { icon: "Minus", dark: ["#7b2e35", "#ffb3ba"], light: ["#ffe1e1", "#c0202c"] },
  R: { icon: "ArrowRight", dark: ["#2b5574", "#9fd6ff"], light: ["#ddeeff", "#1f5fa8"] },
  U: { icon: "AlertCircle", dark: ["#7b2e35", "#ffb3ba"], light: ["#ffe1e1", "#c0202c"] },
};

export function StatusIcon({ t, status }: { t: Tokens; status: string }) {
  const k = status === "?" ? "A" : status === "T" ? "M" : status === "C" ? "R" : status;
  const s = STATUS[k] ?? STATUS.M;
  const [bg, fg] = t.light ? s.light : s.dark;
  return (
    <View style={{ width: 16, height: 16, borderRadius: 3, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Icon name={s.icon} size={10} color={fg} />
    </View>
  );
}

interface Props {
  t: Tokens;
  files: FileChange[];
  mode: ListMode;
  selected?: string | null;
  onPress?: (f: FileChange) => void;
  onMenu?: (f: FileChange) => void;
  action?: (f: FileChange) => ReactNode;
  showStats?: boolean;
  hideStatus?: boolean;
  startCollapsed?: boolean;
}

const contextMenu = (fn: () => void) => ({ onContextMenu: (e: { preventDefault?: () => void }) => (e.preventDefault?.(), fn()) }) as object;

function FileRow(p: Props & { f: FileChange; depth: number; label: string | null }) {
  const { t, f } = p;
  const { dir, name } = splitPath(f.path);
  return (
    <Pressable
      onPress={() => p.onPress?.(f)}
      onLongPress={p.onMenu && (() => p.onMenu!(f))}
      {...(p.onMenu ? contextMenu(() => p.onMenu!(f)) : {})}
      style={(st) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingLeft: 12 + p.depth * 14,
        paddingRight: 10,
        minHeight: 26,
        backgroundColor: p.selected === f.path ? t.select : active(st) ? t.hover : "transparent",
      })}
    >
      {p.hideStatus ? <Icon name="File" size={13} color={t.dim} /> : <StatusIcon t={t} status={f.status} />}
      <Text style={{ color: t.text, fontSize: 12, flex: 1 }} numberOfLines={1} ellipsizeMode="head">
        {p.label ?? (
          <>
            <Text style={{ color: t.dim }}>{dir}</Text>
            {name}
          </>
        )}
      </Text>
      {p.showStats && f.additions != null && (
        <Text style={{ fontSize: 11 }}>
          <Text style={{ color: t.green }}>+{f.additions}</Text> <Text style={{ color: t.red }}>-{f.deletions}</Text>
        </Text>
      )}
      {p.action?.(f)}
    </Pressable>
  );
}

interface Dir {
  name: string;
  dirs: Map<string, Dir>;
  files: FileChange[];
}

export function FileList(props: Props) {
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  if (!props.files.length) return null;
  if (props.mode === "path") return <View>{props.files.map((f) => <FileRow key={f.path} {...props} f={f} depth={0} label={null} />)}</View>;
  const root: Dir = { name: "", dirs: new Map(), files: [] };
  for (const f of props.files) {
    const parts = f.path.split("/");
    let d = root;
    for (const p of parts.slice(0, -1)) {
      if (!d.dirs.has(p)) d.dirs.set(p, { name: p, dirs: new Map(), files: [] });
      d = d.dirs.get(p)!;
    }
    d.files.push(f);
  }
  const out: ReactNode[] = [];
  const walk = (d: Dir, depth: number, prefix: string) => {
    for (const sub of [...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      // Collapse single-child chains (a/b/c) into one row, as file trees usually do.
      let node = sub;
      let label = sub.name;
      while (node.dirs.size === 1 && node.files.length === 0) {
        node = [...node.dirs.values()][0];
        label += "/" + node.name;
      }
      const key = prefix + label + "/";
      const open = props.startCollapsed ? toggled.has(key) : !toggled.has(key);
      out.push(
        <Pressable
          key={key}
          onPress={() =>
            setToggled((c) => {
              const n = new Set(c);
              if (n.has(key)) n.delete(key);
              else n.add(key);
              return n;
            })
          }
          style={(st) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12 + depth * 14, minHeight: 26, backgroundColor: active(st) ? props.t.hover : "transparent" })}
        >
          <Icon name={open ? "ChevronDown" : "ChevronRight"} size={10} color={props.t.dim} />
          <Icon name="Folder" size={13} color={props.t.dim} />
          <Text style={{ color: props.t.text, fontSize: 12 }} numberOfLines={1}>
            {label}
          </Text>
        </Pressable>,
      );
      if (open) walk(node, depth + 1, key);
    }
    for (const f of d.files) out.push(<FileRow key={f.path} {...props} f={f} depth={depth} label={splitPath(f.path).name} />);
  };
  walk(root, 0, "");
  return <View>{out}</View>;
}

export function Segmented<V extends string>({ t, value, options, onChange }: { t: Tokens; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: "row", borderWidth: 1, borderColor: t.border, borderRadius: 4, overflow: "hidden" }}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={(st) => ({ paddingHorizontal: 8, paddingVertical: 3, backgroundColor: value === o.value ? t.select : active(st) ? t.hover : "transparent" })}>
          <Text style={{ color: value === o.value ? t.text : t.dim, fontSize: 11 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ModeToggle({ t, mode, onChange }: { t: Tokens; mode: ListMode; onChange: (m: ListMode) => void }) {
  return <Segmented t={t} value={mode} onChange={onChange} options={[{ value: "path", label: "Path" }, { value: "tree", label: "Tree" }]} />;
}
