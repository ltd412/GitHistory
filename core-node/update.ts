// Pure rules of the in-app updater (the I/O lives in electron/updater.cjs): which release is newer, which of
// its files fits this installation, and whether a download can be trusted.

export const RELEASES_API = 'https://api.github.com/repos/ltd412/GitHistory/releases/latest';
/** Downloads are only accepted from this release path (the API's own asset URLs). */
export const TRUSTED_PREFIX = 'https://github.com/ltd412/GitHistory/releases/download/';

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size?: number;
  /** "sha256:<hex>", reported by GitHub for every asset. */
  digest?: string | null;
}

export interface Release {
  tag_name: string;
  html_url: string;
  body?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets: ReleaseAsset[];
}

/** How this copy of the app was installed, which decides how an update is applied. */
export type InstallKind = 'deb' | 'appimage' | 'nsis' | 'dmg' | 'manual';

/** 1 when a is newer than b, -1 when older, 0 when equal; "v" prefixes and pre-release suffixes are ignored. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

export function installKind(env: { platform: string; appImage?: string | null; execPath: string }): InstallKind {
  if (env.platform === 'linux') {
    if (env.appImage) return 'appimage';
    // The .deb installs to /opt/GitHistory; anything else (a tarball, a dev checkout) is updated by hand.
    return env.execPath.startsWith('/opt/GitHistory/') ? 'deb' : 'manual';
  }
  if (env.platform === 'win32') {
    // The setup.exe installs under Program Files or %LOCALAPPDATA%\Programs; the portable zip runs from anywhere.
    return /\\(Program Files( \(x86\))?|AppData\\Local\\Programs)\\/i.test(env.execPath) ? 'nsis' : 'manual';
  }
  if (env.platform === 'darwin') return 'dmg';
  return 'manual';
}

/** The release file that applies to `kind` on `arch` ('x64' | 'arm64'), or null. */
export function pickAsset(release: Release, kind: InstallKind, arch: string): ReleaseAsset | null {
  const find = (re: RegExp) => release.assets.find((a) => re.test(a.name)) ?? null;
  switch (kind) {
    case 'deb':
      return find(/-linux-amd64\.deb$/);
    case 'appimage':
      return find(/-linux-x86_64\.AppImage$/);
    case 'nsis':
      return find(/-win-x64-setup\.exe$/);
    case 'dmg':
      return find(arch === 'arm64' ? /-mac-arm64\.dmg$/ : /-mac-x64\.dmg$/);
    default:
      return null;
  }
}

export interface UpdateOffer {
  version: string;
  notesUrl: string;
  kind: InstallKind;
  /** Null when the release has no file for this installation: the offer then opens the release page. */
  asset: ReleaseAsset | null;
}

/** The offer for `release` when it is newer than `current`, else null (drafts and pre-releases are never offered). */
export function offerFor(release: Release, current: string, env: { platform: string; arch: string; appImage?: string | null; execPath: string }): UpdateOffer | null {
  if (release.draft || release.prerelease) return null;
  if (compareVersions(release.tag_name, current) <= 0) return null;
  const kind = installKind(env);
  const asset = pickAsset(release, kind, env.arch);
  return { version: release.tag_name.replace(/^v/i, ''), notesUrl: release.html_url, kind: asset ? kind : 'manual', asset };
}

export const isTrustedAssetUrl = (url: string) => url.startsWith(TRUSTED_PREFIX);

/** Whether `hex` is the SHA-256 GitHub reports in `digest`; true when GitHub reports none. */
export function digestMatches(digest: string | null | undefined, hex: string): boolean {
  if (!digest) return true;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(digest);
  return !!m && m[1].toLowerCase() === hex.toLowerCase();
}

export type SudoFailure = 'need-password' | 'wrong-password' | 'failed';

/** Why a `sudo` run failed, from its stderr (run with LC_ALL=C so the messages are English). */
export function classifySudoFailure(stderr: string): SudoFailure {
  if (/incorrect password|try again|authentication failure/i.test(stderr)) return 'wrong-password';
  if (/password is required|no password was provided|a terminal is required/i.test(stderr)) return 'need-password';
  return 'failed';
}
