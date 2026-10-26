'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { expandCommand } = require('../electron/core-node.gen.cjs');

test('variables are substituted shell-quoted', () => {
  assert.equal(expandCommand('git show ${sha}', { sha: 'abc' }), "git show 'abc'");
  assert.equal(expandCommand('echo ${missing}', {}), 'echo ${missing}');
});

test('hostile names cannot inject shell syntax', { skip: process.platform === 'win32' && 'POSIX shell (Windows: next test)' }, () => {
  const branch = `x'; touch /tmp/pwned; echo '$(id)`;
  const cmd = expandCommand('printf %s ${branch}', { branch });
  assert.equal(execFileSync('/bin/sh', ['-c', cmd]).toString(), branch);
});

test('hostile names cannot inject PowerShell syntax', { skip: process.platform !== 'win32' && 'PowerShell runs on Windows' }, () => {
  const { powershellQuote } = require('../electron/core-node.gen.cjs');
  const branch = `x'; Write-Output pwned; '$(Get-Date)`;
  const cmd = expandCommand('Write-Output ${branch}', { branch }, powershellQuote);
  assert.equal(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd]).toString().trim(), branch);
});

test('powershellQuote keeps a branch name literal (Windows custom commands)', () => {
  const { expandCommand, powershellQuote } = require('../electron/core-node.gen.cjs');
  assert.equal(powershellQuote("it's"), "'it''s'");
  assert.equal(expandCommand('git log ${branch}', { branch: "x'; Remove-Item -Recurse C:\\ ;'" }, powershellQuote), "git log 'x''; Remove-Item -Recurse C:\\ ;'''");
});
