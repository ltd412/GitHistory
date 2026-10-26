'use strict';
// Development harness: serves the built renderer and exposes the git service over HTTP so the
// UI can be exercised in a regular browser (UI testing, screenshots) without launching Electron.
// Binds to 127.0.0.1 only. Usage: node scripts/web-bridge.cjs <repo> [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { git } = require('../electron/core-node.gen.cjs');

const repoArg = process.argv[2] ? path.resolve(process.argv[2]) : null;
const port = Number(process.argv[3] || 4321);
const dist = path.join(__dirname, '..', 'dist');
let store = { recent: [], openTabs: [], activeTab: null, autoFetchMinutes: 0, defaultCloneDir: '', pullMode: 'ff', dateFormat: 'relative', repos: [], customCommands: [], compact: false, pushAfterCommit: false, theme: 'dark', lightFrom: '06:00', darkFrom: '18:00' };

const appMethods = {
  'store:get': () => store,
  'store:set': (patch) => (store = { ...store, ...patch }),
  openRepo: (dir) => git.isRepo(dir),
  closeRepo: () => null,
  initialRepo: () => repoArg,
  history: () => ({ undo: null, redo: null }),
  exists: (p) => fs.existsSync(p),
  setNativeTheme: () => null,
  undo: () => null,
  redo: () => null,
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

http
  .createServer(async (req, res) => {
    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { channel, method, args } = JSON.parse(body);
      try {
        let result;
        if (channel === 'git') {
          if (typeof git[method] !== 'function' || method === 'run' || method === 'git') throw new Error(`Unknown method ${method}`);
          result = await git[method](...args);
        } else {
          const fn = appMethods[method];
          result = fn ? await fn(...args) : null;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ result: result ?? null }));
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    const file = path.join(dist, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
    if (!file.startsWith(dist) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(port, '127.0.0.1', () => console.log(`web bridge on http://127.0.0.1:${port} repo=${repoArg}`));
