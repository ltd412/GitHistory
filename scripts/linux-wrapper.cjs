// electron-builder afterPack hook (Linux): replace the launcher with a tiny wrapper script.
// WHY: an AppImage is mounted through FUSE, so chrome-sandbox cannot be SUID root there, and on Ubuntu 23.10+
// unprivileged user namespaces are blocked too — Chromium then aborts at launch. Run unsandboxed only when started
// from an AppImage ($APPIMAGE is set by its runtime); the .deb keeps the SUID sandbox set by its postinst.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function linuxWrapper({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'linux') return;
  const exe = packager.executableName;
  const bin = path.join(appOutDir, exe);
  fs.renameSync(bin, `${bin}.bin`);
  fs.writeFileSync(
    bin,
    `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
if [ -n "$APPIMAGE" ]; then
  exec "$HERE/${exe}.bin" --no-sandbox "$@"
fi
exec "$HERE/${exe}.bin" "$@"
`,
    { mode: 0o755 },
  );
};
