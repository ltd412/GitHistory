// Path containment for every file a client names (plans/261026-paseo-plugin/solution.md §4).
// Requests can come from a phone on the network, so a path is trusted only after it is proven to stay
// inside the workspace's repository, outside `.git`, and not to escape through a symlink.
import fs from "node:fs";
import path from "node:path";

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

/** The deepest existing ancestor of `p` (or `p` itself), resolved through symlinks. */
function realExistingPrefix(p: string): string {
  let cur = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
}

const within = (root: string, p: string) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * Throws unless `rel` names a location inside `toplevel` that is not `.git` or below it — checked on the
 * lexical path and again after resolving symlinks, so `link -> /etc` cannot be written through.
 * Returns the absolute path.
 */
export function assertInsideRepo(toplevel: string, rel: string): string {
  if (rel.includes("\0")) throw new GuardError(`Invalid path: ${JSON.stringify(rel)}`);
  if (path.isAbsolute(rel)) throw new GuardError(`Absolute paths are not allowed: ${rel}`);
  const root = fs.realpathSync(toplevel);
  const lexical = path.resolve(root, rel);
  if (!within(root, lexical) || lexical === root) throw new GuardError(`Path is outside the repository: ${rel}`);
  const first = path.relative(root, lexical).split(path.sep)[0];
  // WHY: writing under .git (hooks, config) turns a file edit into code execution on the next git command.
  if (first.toLowerCase() === ".git") throw new GuardError(`Paths inside .git are not allowed: ${rel}`);
  const real = realExistingPrefix(lexical);
  if (!within(root, real)) throw new GuardError(`Path leaves the repository through a symlink: ${rel}`);
  const realFirst = path.relative(root, real).split(path.sep)[0];
  if (realFirst.toLowerCase() === ".git") throw new GuardError(`Paths inside .git are not allowed: ${rel}`);
  return lexical;
}

/**
 * Undo git's C-style path quoting (`"a/\303\251.txt"`). Git applies the patch to the unquoted name, so the
 * containment check must see that name too — `"b/..\057x"` is `b/../x`.
 */
function unquote(p: string): string {
  if (!(p.length >= 2 && p.startsWith('"') && p.endsWith('"'))) return p;
  const bytes: number[] = [];
  const body = p.slice(1, -1);
  const esc: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, "\\": 92 };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      bytes.push(...Buffer.from(c, "utf8"));
      continue;
    }
    const n = body[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(body.slice(i, i + 3), 8));
      i += 2;
    } else if (n in esc) bytes.push(esc[n]);
    else throw new GuardError(`Invalid quoted path in patch: ${p}`);
  }
  return Buffer.from(bytes).toString("utf8");
}

const stripPrefix = (p: string) => unquote(p).replace(/^[ab]\//, "");

/** Every path a unified diff touches, from its headers (`diff --git`, `---/+++`, rename/copy lines). */
export function patchPaths(patch: string): string[] {
  const out = new Set<string>();
  for (const line of patch.split("\n")) {
    let m: RegExpExecArray | null;
    if (line.startsWith("diff --git ")) {
      if ((m = /^diff --git ("(?:[^"\\]|\\.)*"|\S+) ("(?:[^"\\]|\\.)*"|\S+)$/.exec(line))) {
        out.add(stripPrefix(m[1]));
        out.add(stripPrefix(m[2]));
      } else {
        // Unquoted names with spaces make this line ambiguous: check every word, so no reading of it escapes.
        for (const w of line.slice("diff --git ".length).split(/\s+/)) if (w) out.add(stripPrefix(w));
      }
    } else if ((m = /^(?:---|\+\+\+) (.+?)(?:\t.*)?$/.exec(line))) {
      if (m[1] !== "/dev/null") out.add(stripPrefix(m[1]));
    } else if ((m = /^(?:rename|copy) (?:from|to) (.+)$/.exec(line))) {
      out.add(unquote(m[1]));
    }
  }
  return [...out];
}

/** Throws unless every path a patch touches is inside the repository. */
export function assertPatchInsideRepo(toplevel: string, patch: string): void {
  const paths = patchPaths(patch);
  if (!paths.length) throw new GuardError("Patch names no files");
  for (const p of paths) assertInsideRepo(toplevel, p);
}
