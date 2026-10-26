'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, clipboard, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
// Built from core-node/*.ts by `npm run build:core` (shared with the Paseo plugin server).
const { git, expandCommand, powershellQuote, createHistory } = require('./core-node.gen.cjs');

const isDev = process.env.VITE_DEV === '1';
let win = null;

// ---------------------------------------------------------------- settings store

const storeFile = () => path.join(app.getPath('userData'), 'settings.json');
const defaults = {
  recent: [],
  openTabs: [],
  activeTab: null,
  autoFetchMinutes: 1,
  defaultCloneDir: path.join(require('node:os').homedir(), 'Projects'),
  pullMode: 'ff',
  dateFormat: 'relative',
  repos: [],
  customCommands: [],
  compact: false,
  pushAfterCommit: false,
  theme: 'dark',
  lightFrom: '06:00',
  darkFrom: '18:00',
};
function readStore() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(storeFile(), 'utf8')) };
  } catch {
    return { ...defaults };
  }
}
function writeStore(patch) {
  const next = { ...readStore(), ...patch };
  fs.mkdirSync(path.dirname(storeFile()), { recursive: true });
  fs.writeFileSync(storeFile(), JSON.stringify(next, null, 2));
  return next;
}
function addRecent(repo) {
  const s = readStore();
  const recent = [repo, ...s.recent.filter((r) => r !== repo)].slice(0, 20);
  writeStore({ recent });
}

// ---------------------------------------------------------------- undo / redo
// Shared with the Paseo plugin server (core-node/history.ts).

const { tracked, undo, redo, info: historyInfo } = createHistory();

// ---------------------------------------------------------------- watchers

const watchers = new Map();
function watch(repo) {
  if (watchers.has(repo)) return;
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win && !win.isDestroyed()) win.webContents.send('repo:changed', repo);
    }, 400);
  };
  try {
    const w = fs.watch(repo, { recursive: true }, (_ev, file) => {
      if (!file) return fire();
      const f = String(file);
      // Object writes and lock files churn on every git command and never change what we render.
      if (f.startsWith('.git/objects') || f.endsWith('.lock') || f.includes('node_modules')) return;
      fire();
    });
    watchers.set(repo, w);
  } catch {
    /* repo may live on a filesystem without recursive watch support */
  }
}
function unwatch(repo) {
  const w = watchers.get(repo);
  if (w) w.close();
  watchers.delete(repo);
}

// ---------------------------------------------------------------- IPC

const progress = (repo) => (text) => {
  if (win && !win.isDestroyed()) win.webContents.send('git:progress', { repo, text });
};
const NETWORK = new Set(['fetch', 'pull', 'push', 'deleteRemoteBranch', 'pushTag', 'deleteRemoteTag']);

ipcMain.handle('git', async (_e, method, args) => {
  const fn = tracked[method] || git[method];
  if (typeof fn !== 'function' || method === 'run' || method === 'git') {
    throw new Error(`Unknown git method: ${method}`);
  }
  const call = NETWORK.has(method) ? [...args, progress(args[0])] : args;
  return fn(...call);
});

ipcMain.handle('app', async (_e, method, args = []) => {
  switch (method) {
    case 'store:get':
      return readStore();
    case 'store:set':
      return writeStore(args[0]);
    case 'openRepo': {
      const top = await git.isRepo(args[0]);
      if (top) {
        addRecent(top);
        watch(top);
      }
      return top;
    }
    case 'closeRepo':
      unwatch(args[0]);
      return null;
    case 'pickDirectory': {
      const r = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
        defaultPath: args[0],
      });
      return r.canceled ? null : r.filePaths[0];
    }
    case 'clone':
      return git.clone(args[0], args[1], progress(args[1]));
    case 'init':
      return git.init(args[0], args[1]);
    case 'undo':
      return undo(args[0]);
    case 'redo':
      return redo(args[0]);
    case 'history':
      return historyInfo(args[0]);
    case 'showInFolder':
      return shell.openPath(args[0]);
    case 'openFile':
      return shell.openPath(path.join(args[0], args[1]));
    case 'openTerminal':
      return openTerminal(args[0]);
    case 'openExternal':
      return shell.openExternal(args[0]);
    case 'copy':
      return clipboard.writeText(args[0]);
    case 'exists':
      return fs.existsSync(args[0]);
    case 'setNativeTheme':
      // Keeps native chrome (scrollbars, dialogs, the traffic-light area) in step with the page.
      nativeTheme.themeSource = args[0] === 'light' ? 'light' : 'dark';
      if (win && !win.isDestroyed()) win.setBackgroundColor(args[0] === 'light' ? '#f6f7f9' : '#1b1d23');
      return null;
    case 'runCustom':
      return runCustom(args[0], args[1], args[2]);
    case 'initialRepo': {
      // `githistory /path/to/repo` opens that repository in a tab on launch.
      const arg = process.argv.slice(isDev || !app.isPackaged ? 2 : 1).find((a) => !a.startsWith('-') && a !== '.');
      return arg ? path.resolve(arg) : null;
    }
    default:
      throw new Error(`Unknown app method: ${method}`);
  }
});

// ---------------------------------------------------------------- custom commands

/**
 * Runs a user-defined command from Preferences in the user's login shell (see core-node/custom.ts for
 * how variables are substituted).
 */
function runCustom(cwd, template, vars) {
  // WHY: quoting must match the shell that runs the command, or a quote in a branch/file name breaks out.
  const win32 = process.platform === 'win32';
  const command = win32 ? expandCommand(template, vars, powershellQuote) : expandCommand(template, vars);
  return new Promise((resolve) => {
    const child = win32
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, env: process.env, windowsHide: true })
      : spawn(process.env.SHELL || '/bin/sh', ['-lc', command], { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 5 * 60 * 1000);
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: String(e), command }));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.slice(-200000), stderr: stderr.slice(-200000), command });
    });
  });
}

/** Opens the platform's terminal in `dir`: Terminal.app, a Windows console, or the first Linux terminal found. */
function openTerminal(dir) {
  const launch = (cmd, argv, opts = {}) =>
    new Promise((resolve, reject) => {
      const child = spawn(cmd, argv, { cwd: dir, detached: true, stdio: 'ignore', ...opts });
      child.once('error', reject);
      child.once('spawn', () => (child.unref(), resolve(true)));
    });
  if (process.platform === 'darwin') return launch('open', ['-a', 'Terminal', dir]);
  if (process.platform === 'win32') return launch('cmd.exe', ['/c', 'start', '', '/D', dir, 'cmd.exe'], { windowsHide: true });
  const candidates = [
    ['x-terminal-emulator', []],
    ['gnome-terminal', [`--working-directory=${dir}`]],
    ['konsole', ['--workdir', dir]],
    ['xfce4-terminal', [`--working-directory=${dir}`]],
    ['xterm', []],
  ];
  return candidates.reduce((p, [cmd, argv]) => p.catch(() => launch(cmd, argv)), Promise.reject(new Error('no terminal'))).catch(() => {
    throw new Error('No terminal emulator found (tried x-terminal-emulator, gnome-terminal, konsole, xfce4-terminal, xterm).');
  });
}

// ---------------------------------------------------------------- window

function buildMenu() {
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  const template = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Open Repository…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Clone Repository…', accelerator: 'CmdOrCtrl+N', click: send('clone') },
        { label: 'Init Repository…', accelerator: 'CmdOrCtrl+I', click: send('init') },
        { type: 'separator' },
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: send('newTab') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('closeTab') },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: send('preferences') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find Commit…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Command Palette…', accelerator: 'CmdOrCtrl+P', click: send('palette') },
      ],
    },
    {
      label: 'Repository',
      submenu: [
        { label: 'Fetch All', accelerator: 'CmdOrCtrl+Shift+F', click: send('fetch') },
        { label: 'Pull', accelerator: 'CmdOrCtrl+Shift+L', click: send('pull') },
        { label: 'Push', accelerator: 'CmdOrCtrl+Shift+P', click: send('push') },
        { type: 'separator' },
        { label: 'Create Branch…', accelerator: 'CmdOrCtrl+B', click: send('branch') },
        { label: 'Stash', accelerator: 'CmdOrCtrl+Shift+S', click: send('stash') },
        { label: 'Pop Stash', accelerator: 'CmdOrCtrl+Shift+O', click: send('pop') },
        { type: 'separator' },
        { label: 'Stage All', accelerator: 'CmdOrCtrl+Shift+A', click: send('stageAll') },
        { label: 'Commit', accelerator: 'CmdOrCtrl+Enter', click: send('commit') },
        { type: 'separator' },
        { label: 'Open in Terminal', accelerator: 'Alt+T', click: send('terminal') },
        { label: 'Reveal in Finder', click: send('reveal') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Left Panel', accelerator: 'CmdOrCtrl+J', click: send('toggleLeft') },
        { label: 'Toggle Right Panel', accelerator: 'CmdOrCtrl+K', click: send('toggleRight') },
        { label: 'Toggle Compact Mode', accelerator: 'CmdOrCtrl+Shift+M', click: send('compact') },
        { label: 'Repository Manager', accelerator: 'CmdOrCtrl+Shift+R', click: send('repoManager') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#1b1d23',
    // macOS: the tab bar shares the title row with the traffic lights; elsewhere keep the native frame.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } } : { autoHideMenuBar: true }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  if (isDev) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  const screenshotTo = process.env.GITHISTORY_SCREENSHOT || process.env.GITKRANE_SCREENSHOT;
  if (screenshotTo) {
    // Verification hook: capture the window after it settles, then quit.
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        // Optional page script (clicks, opening a diff…) run before the capture, for documentation shots.
        const script = process.env.GITHISTORY_SCREENSHOT_SCRIPT;
        if (script) {
          await win.webContents.executeJavaScript(fs.readFileSync(script, 'utf8')).catch((e) => console.error(e));
          await new Promise((r) => setTimeout(r, 1500));
        }
        const img = await win.webContents.capturePage();
        fs.writeFileSync(screenshotTo, img.toPNG());
        app.quit();
      }, Number((process.env.GITHISTORY_SCREENSHOT_DELAY || process.env.GITKRANE_SCREENSHOT_DELAY) || 3500));
    });
  }
  win.on('closed', () => {
    win = null;
  });
}

app.setName('GitHistory');
const userDataOverride = process.env.GITHISTORY_USER_DATA || process.env.GITKRANE_USER_DATA;
if (userDataOverride) app.setPath('userData', userDataOverride);
else {
  // Renamed from GitKrane: carry the saved settings (repositories, theme, custom commands) over once.
  const now = app.getPath('userData');
  const before = path.join(path.dirname(now), 'GitKrane', 'settings.json');
  if (!fs.existsSync(path.join(now, 'settings.json')) && fs.existsSync(before)) {
    fs.mkdirSync(now, { recursive: true });
    fs.copyFileSync(before, path.join(now, 'settings.json'));
  }
}
app.whenReady().then(() => {
  buildMenu();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  for (const r of [...watchers.keys()]) unwatch(r);
  if (process.platform !== 'darwin') app.quit();
});
