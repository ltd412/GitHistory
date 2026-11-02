'use strict';
// In-app updates from GitHub Releases. The rules (newer version, which file, trusted URL, digest) are in
// core-node/update.ts; this file does the I/O: check, download with progress, verify, install per platform.
//   deb      → `sudo dpkg -i`; the password is asked in the app and goes only to sudo's stdin (pkexec when
//              there is no sudo), then relaunch
//   AppImage → replace the AppImage file in place, then relaunch it
//   NSIS     → run the setup.exe and quit
//   dmg      → open the disk image (unsigned apps cannot replace themselves on macOS)
//   manual   → open the release page
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawn } = require('node:child_process');
const { update } = require('./core-node.gen.cjs');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_CHECK_MS = 8000;

/** `app` and `shell` are Electron's; `send(state)` publishes the state to the window; `settings()` reads the store. */
function createUpdater({ app, shell, send, settings }) {
  let state = { phase: 'idle' };
  let offer = null;
  let busy = false;
  let timer = null;
  /** Resolver of the password prompt shown by the window while the state is `password`. */
  let pendingPassword = null;
  // Test hooks (never set in a normal run): pretend to be an older version, or stop before installing.
  const currentVersion = () => process.env.GITHISTORY_FAKE_VERSION || app.getVersion();
  const dryRun = process.env.GITHISTORY_UPDATE_DRY === '1';
  const sudoBin = process.env.GITHISTORY_UPDATE_SUDO || 'sudo';
  const noRelaunch = process.env.GITHISTORY_UPDATE_NO_RELAUNCH === '1';

  const set = (next) => {
    state = next;
    send(state);
  };
  const env = () => ({ platform: process.platform, arch: process.arch, appImage: process.env.APPIMAGE || null, execPath: process.env.GITHISTORY_FAKE_EXEC || process.execPath });

  /** `manual`: the user asked, so say so when there is nothing new or the check failed. */
  async function check({ manual = false } = {}) {
    if (busy || state.phase === 'downloading' || state.phase === 'installing') return state;
    if (!app.isPackaged && !process.env.GITHISTORY_FAKE_VERSION) {
      if (manual) set({ phase: 'error', manual, error: 'Updates are only available in installed builds.' });
      return state;
    }
    busy = true;
    try {
      if (manual) set({ phase: 'checking', manual });
      const res = await fetch(update.RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'GitHistory-updater' } });
      if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
      offer = update.offerFor(await res.json(), currentVersion(), env());
      if (offer) set({ phase: 'available', version: offer.version, notesUrl: offer.notesUrl, kind: offer.kind, manual });
      else set({ phase: 'idle', upToDate: manual, current: currentVersion(), manual });
    } catch (e) {
      // A background check that fails (offline) stays silent; one the user asked for says why.
      if (manual) set({ phase: 'error', manual, error: `Could not check for updates: ${e instanceof Error ? e.message : e}` });
      else if (state.phase === 'checking') set({ phase: 'idle' });
    } finally {
      busy = false;
    }
    return state;
  }

  async function download(asset, onProgress) {
    if (!update.isTrustedAssetUrl(asset.browser_download_url)) throw new Error('Refusing to download from an untrusted address.');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'githistory-update-'));
    const file = path.join(dir, path.basename(asset.name));
    const res = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'GitHistory-updater' } });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size || 0;
    const hash = crypto.createHash('sha256');
    let got = 0;
    let last = 0;
    const body = Readable.fromWeb(res.body);
    body.on('data', (chunk) => {
      hash.update(chunk);
      got += chunk.length;
      const now = Date.now();
      if (total && now - last > 150) {
        last = now;
        onProgress(Math.min(99, Math.round((got / total) * 100)));
      }
    });
    await pipeline(body, fs.createWriteStream(file));
    if (!update.digestMatches(asset.digest, hash.digest('hex'))) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error('The downloaded file does not match the checksum published with the release.');
    }
    return file;
  }

  const relaunch = (opts) => {
    if (noRelaunch) return set({ phase: 'opened', version: offer.version });
    if (!opts && process.platform === 'linux') {
      // WHY not app.relaunch(): dpkg replaced the executable that is running, so process.execPath now reads
      // ".../githistory (deleted)" and Electron would try to start a path that does not exist. Start the new
      // binary ourselves, detached, a moment after this process has released its lock and window.
      const exe = process.execPath.replace(/ \(deleted\)$/, '');
      const target = fs.existsSync(exe) ? exe : '/usr/bin/githistory';
      const child = spawn('/bin/sh', ['-c', 'sleep 1; exec "$0" "$@"', target, ...process.argv.slice(1).filter((a) => !a.startsWith('--inspect'))], { detached: true, stdio: 'ignore', env: process.env });
      child.unref();
      return app.exit(0);
    }
    app.relaunch(opts);
    app.exit(0);
  };

  /** Runs a command, resolving with its exit code and the tail of its stderr; `input` goes to stdin. */
  const run = (cmd, args, input) =>
    new Promise((resolve) => {
      const p = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, LC_ALL: 'C', LANG: 'C' } });
      let err = '';
      p.stderr.on('data', (d) => (err = (err + d).slice(-4000)));
      p.on('error', (e) => resolve({ code: -1, err: String(e), missing: e.code === 'ENOENT' }));
      p.on('close', (code) => resolve({ code, err }));
      p.stdin.on('error', () => {});
      p.stdin.end(input ?? '');
    });

  /** Asks the window for the administrator password; resolves null when the user cancels. */
  const askPassword = (wrong) =>
    new Promise((resolve) => {
      pendingPassword = resolve;
      set({ phase: 'password', version: offer.version, kind: offer.kind, wrong });
    });

  async function installDeb(file) {
    const install = ['dpkg', '-i', file];
    // Passwordless sudo (or cached credentials) needs no prompt.
    const quiet = await run(sudoBin, ['-n', ...install]);
    if (quiet.code === 0) return;
    if (quiet.missing) {
      // No sudo on this system: the desktop's own authentication dialog.
      const r = await run('pkexec', install);
      if (r.code === 0) return;
      throw new Error(r.missing ? 'Neither sudo nor pkexec is available: install the downloaded file with "dpkg -i" as administrator.' : r.code === 126 || r.code === 127 ? 'The update was cancelled.' : `dpkg failed (exit ${r.code}).`);
    }
    if (update.classifySudoFailure(quiet.err) !== 'need-password') throw new Error(`dpkg failed: ${quiet.err.trim().split('\n').pop() || `exit ${quiet.code}`}`);
    let wrong = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const password = await askPassword(wrong);
      if (password == null) throw new Error('The update was cancelled.');
      set({ phase: 'installing', version: offer.version, kind: offer.kind });
      // WHY -S and an empty prompt: the password comes from stdin, not a terminal; it is not kept anywhere.
      const r = await run(sudoBin, ['-S', '-p', '', ...install], `${password}\n`);
      if (r.code === 0) return;
      if (update.classifySudoFailure(r.err) !== 'wrong-password') throw new Error(`dpkg failed: ${r.err.trim().split('\n').pop() || `exit ${r.code}`}`);
      wrong = true;
    }
    throw new Error('Three incorrect passwords: the update was not installed.');
  }

  /** The window's answer to the password prompt (null = cancel). */
  function answerPassword(password) {
    const resolve = pendingPassword;
    pendingPassword = null;
    if (resolve) resolve(password);
  }

  async function install(file) {
    switch (offer.kind) {
      case 'deb':
        await installDeb(file);
        return relaunch();
      case 'appimage': {
        const target = process.env.APPIMAGE;
        // Same directory, so the final rename is atomic even when /tmp is another filesystem.
        const staged = `${target}.update`;
        fs.copyFileSync(file, staged);
        fs.chmodSync(staged, 0o755);
        fs.renameSync(staged, target);
        return relaunch({ execPath: target, args: [] });
      }
      case 'nsis':
        spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
        return app.quit();
      case 'dmg':
        await shell.openPath(file);
        return set({ phase: 'opened', version: offer.version });
      default:
        return shell.openExternal(offer.notesUrl);
    }
  }

  /** Download and install the offered update (the Update button). */
  async function apply() {
    if (!offer || busy) return state;
    if (!offer.asset) {
      await shell.openExternal(offer.notesUrl);
      return state;
    }
    busy = true;
    try {
      set({ phase: 'downloading', version: offer.version, progress: 0, kind: offer.kind });
      const file = await download(offer.asset, (progress) => set({ phase: 'downloading', version: offer.version, progress, kind: offer.kind }));
      set({ phase: 'installing', version: offer.version, kind: offer.kind });
      if (dryRun) return set({ phase: 'opened', version: offer.version, dry: file });
      await install(file);
    } catch (e) {
      set({ phase: 'error', version: offer.version, kind: offer.kind, error: e instanceof Error ? e.message : String(e), retry: true });
    } finally {
      busy = false;
    }
    return state;
  }

  /** Downloads of an earlier run (interrupted, or kept for a dry run) are never needed again. */
  function cleanup() {
    try {
      for (const d of fs.readdirSync(os.tmpdir())) if (d.startsWith('githistory-update-')) fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true });
    } catch {
      /* temp dir unreadable: nothing to clean */
    }
  }

  function start() {
    cleanup();
    const tick = () => settings().checkUpdates !== false && void check();
    setTimeout(tick, FIRST_CHECK_MS);
    timer = setInterval(tick, CHECK_EVERY_MS);
    timer.unref?.();
  }

  return { check, apply, start, answerPassword, state: () => state };
}

module.exports = { createUpdater };
