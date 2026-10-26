'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { expandCommand } = require('../electron/core-node.gen.cjs');

test('variables are substituted shell-quoted', () => {
  assert.equal(expandCommand('git show ${sha}', { sha: 'abc' }), "git show 'abc'");
  assert.equal(expandCommand('echo ${missing}', {}), 'echo ${missing}');
});

test('hostile names cannot inject shell syntax', () => {
  const branch = `x'; touch /tmp/pwned; echo '$(id)`;
  const cmd = expandCommand('printf %s ${branch}', { branch });
  assert.equal(execFileSync('/bin/sh', ['-c', cmd]).toString(), branch);
});

test('powershellQuote keeps a branch name literal (Windows custom commands)', () => {
  const { expandCommand, powershellQuote } = require('../electron/core-node.gen.cjs');
  assert.equal(powershellQuote("it's"), "'it''s'");
  assert.equal(expandCommand('git log ${branch}', { branch: "x'; Remove-Item -Recurse C:\\ ;'" }, powershellQuote), "git log 'x''; Remove-Item -Recurse C:\\ ;'''");
});
