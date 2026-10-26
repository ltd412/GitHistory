// electron-builder afterSign hook: ad-hoc sign the macOS app when there is no Developer ID.
// WHY: on Apple Silicon an app whose signature no longer matches its bundle (Electron's own linker signature
// after the app is assembled) is reported as "damaged" and cannot be opened at all; an ad-hoc signature
// makes it open with the usual "unidentified developer" prompt instead.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

module.exports = async function adhocSign({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'darwin') return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
