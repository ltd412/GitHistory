Git adds a **Git** item to Paseo's sidebar: a GitKraken-style client with several projects open as tabs —
commit graph, branches, tags, stashes and remotes, staging (down to single lines), commit and amend,
side-by-side diffs, compare any two revisions, blame and file history, merge and rebase with a
three-way merge tool, interactive rebase, undo/redo. It works on desktop, web and phones.

Open a Paseo workspace, or any folder on the daemon's machine with **＋**. Open tabs are remembered on
the daemon.

It runs `git` on the daemon machine and never other shell commands. Every file path stays inside the
opened repository (no `..`, no `.git`, no symlinks pointing out). Git must be installed and on the
daemon's `PATH`; push and pull use the daemon user's existing credentials (SSH agent or credential
helper).

Anyone who can sign in to the daemon can browse folders and run git in any repository the daemon's
user can read and write — keep the daemon on a trusted network with a password.
