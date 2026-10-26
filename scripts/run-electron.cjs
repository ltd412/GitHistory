// Starts Electron from source. On Linux adds --no-sandbox when node_modules' chrome-sandbox is not SUID root.
// WHY: npm cannot make chrome-sandbox setuid, and Ubuntu 23.10+ blocks unprivileged user namespaces, so
// Chromium aborts at launch ("The SUID sandbox helper binary was found, but is not configured correctly").
// Packaged builds are not affected: the .deb sets the SUID bit in its postinst.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const electron = require('electron');
const args = process.argv.slice(2);
if (process.platform === 'linux') {
  let suid = false;
  try {
    const st = fs.statSync(path.join(path.dirname(electron), 'chrome-sandbox'));
    suid = st.uid === 0 && (st.mode & 0o4000) !== 0;
  } catch {
    /* binary missing: let Electron report it */
  }
  if (!suid) args.unshift('--no-sandbox');
}
const child = spawn(electron, args, { stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
