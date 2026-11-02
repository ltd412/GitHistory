import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifySudoFailure, compareVersions, digestMatches, installKind, isTrustedAssetUrl, offerFor, pickAsset, type Release } from '../core-node/update.ts';

const asset = (name: string, digest?: string) => ({ name, browser_download_url: `https://github.com/ltd412/GitHistory/releases/download/v0.2.0/${name}`, digest });
const release: Release = {
  tag_name: 'v0.2.0',
  html_url: 'https://github.com/ltd412/GitHistory/releases/tag/v0.2.0',
  assets: [
    asset('GitHistory-0.2.0-linux-amd64.deb'),
    asset('GitHistory-0.2.0-linux-x86_64.AppImage'),
    asset('GitHistory-0.2.0-win-x64-setup.exe'),
    asset('GitHistory-0.2.0-win-x64.zip'),
    asset('GitHistory-0.2.0-mac-arm64.dmg'),
    asset('GitHistory-0.2.0-mac-x64.dmg'),
    asset('githistory-paseo-0.2.0.tgz'),
  ],
};

test('compareVersions: numeric, v prefix, missing parts, pre-release suffix', () => {
  assert.equal(compareVersions('v0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, 'numeric, not lexical');
  assert.equal(compareVersions('0.1.2', 'v0.1.2'), 0);
  assert.equal(compareVersions('1.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.1.2', '0.2.0'), -1);
  assert.equal(compareVersions('0.2.0-beta.1', '0.2.0'), 0);
});

test('installKind: deb under /opt, AppImage by env, portable Windows and unknown Linux are manual', () => {
  assert.equal(installKind({ platform: 'linux', execPath: '/opt/GitHistory/githistory.bin' }), 'deb');
  assert.equal(installKind({ platform: 'linux', execPath: '/tmp/.mount_x/githistory', appImage: '/home/u/GitHistory.AppImage' }), 'appimage');
  assert.equal(installKind({ platform: 'linux', execPath: '/home/u/src/node_modules/electron/dist/electron' }), 'manual');
  assert.equal(installKind({ platform: 'win32', execPath: 'C:\\Users\\u\\AppData\\Local\\Programs\\GitHistory\\GitHistory.exe' }), 'nsis');
  assert.equal(installKind({ platform: 'win32', execPath: 'D:\\tools\\GitHistory\\GitHistory.exe' }), 'manual');
  assert.equal(installKind({ platform: 'darwin', execPath: '/Applications/GitHistory.app/Contents/MacOS/GitHistory' }), 'dmg');
});

test('pickAsset: one file per installation kind and architecture', () => {
  assert.match(pickAsset(release, 'deb', 'x64')!.name, /amd64\.deb$/);
  assert.match(pickAsset(release, 'appimage', 'x64')!.name, /AppImage$/);
  assert.match(pickAsset(release, 'nsis', 'x64')!.name, /setup\.exe$/);
  assert.match(pickAsset(release, 'dmg', 'arm64')!.name, /mac-arm64\.dmg$/);
  assert.match(pickAsset(release, 'dmg', 'x64')!.name, /mac-x64\.dmg$/);
  assert.equal(pickAsset(release, 'manual', 'x64'), null);
});

test('offerFor: only newer, non-draft, non-prerelease; no matching file falls back to manual', () => {
  const env = { platform: 'linux', arch: 'x64', execPath: '/opt/GitHistory/githistory.bin' };
  const o = offerFor(release, '0.1.2', env)!;
  assert.equal(o.version, '0.2.0');
  assert.equal(o.kind, 'deb');
  assert.equal(offerFor(release, '0.2.0', env), null, 'same version');
  assert.equal(offerFor(release, '0.3.0', env), null, 'already newer');
  assert.equal(offerFor({ ...release, prerelease: true }, '0.1.2', env), null);
  assert.equal(offerFor({ ...release, draft: true }, '0.1.2', env), null);
  const noDeb = offerFor({ ...release, assets: [] }, '0.1.2', env)!;
  assert.equal(noDeb.kind, 'manual');
  assert.equal(noDeb.asset, null);
});

test('downloads are trusted only from the project release path; digests must match', () => {
  assert.ok(isTrustedAssetUrl(release.assets[0].browser_download_url));
  assert.ok(!isTrustedAssetUrl('https://evil.example/ltd412/GitHistory/releases/download/x.deb'));
  assert.ok(!isTrustedAssetUrl('http://github.com/ltd412/GitHistory/releases/download/x.deb'));
  const hex = 'a'.repeat(64);
  assert.ok(digestMatches(`sha256:${hex}`, hex));
  assert.ok(digestMatches(`sha256:${hex.toUpperCase()}`, hex));
  assert.ok(!digestMatches(`sha256:${hex}`, 'b'.repeat(64)));
  assert.ok(!digestMatches('md5:abc', hex), 'unknown algorithm is not trusted');
  assert.ok(digestMatches(null, hex), 'no digest reported');
});

test('classifySudoFailure tells a wrong password from a missing one from a real failure', () => {
  assert.equal(classifySudoFailure('sudo: 1 incorrect password attempt\n'), 'wrong-password');
  assert.equal(classifySudoFailure('Sorry, try again.\nsudo: 3 incorrect password attempts'), 'wrong-password');
  assert.equal(classifySudoFailure('sudo: a password is required\n'), 'need-password');
  assert.equal(classifySudoFailure('sudo: no password was provided'), 'need-password');
  assert.equal(classifySudoFailure('dpkg: error processing archive'), 'failed');
});
