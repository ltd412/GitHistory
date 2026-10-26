# GitHistory — Git plugin for Paseo

A GitKraken-style Git client inside [Paseo](https://paseo.sh): a **Git** item in Paseo's sidebar opens
several projects as tabs — commit graph, branches, tags, stashes and remotes, staging down to single
lines, commit/amend, side-by-side diffs, compare any two revisions, blame and file history, merge and
rebase with a three-way merge tool, interactive rebase, undo/redo. Desktop, web and phones.

Plugin id: `githistory` · display name: **Git** · requires Paseo **≥ 0.12.0** (0.12 draws the graph with
plain views, 0.13+ with SVG).

## Install

On the machine (or for the daemon) where Paseo runs:

```bash
paseo plugin install https://github.com/ltd412/GitHistory.git
paseo plugin ls          # githistory  running
```

Remote daemon: add `--host <host:port | pairing URL>` (and `PASEO_PASSWORD` when it has one).
Update: `paseo plugin update githistory`. Remove: `paseo plugin remove githistory`.

Requirements on the daemon machine: `git` on `PATH`; push/pull use that user's existing credentials.

## Security

The plugin runs `git` on the daemon machine and never other shell commands. File paths are confined to the
opened repository (no `..`, no `.git`, no symlinks pointing out; patch headers checked too; revisions
starting with `-` and `ext::` remote URLs refused). Anyone who can sign in to the daemon can browse folders
and run git in any repository the daemon's user can read and write — keep the daemon behind a password on
a trusted network.

## Develop

```bash
npm install
npm run typecheck
npm test
```

`shared/core/` and `server/core-node/` are generated copies of the desktop app's shared modules
(`core/`, `core-node/` in the GitKrane repository, `npm run sync-core`); edit them there.
