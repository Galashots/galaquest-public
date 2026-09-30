// The farm capture driver's contracts that a browser run would otherwise be the only proof of.
//
// The driver itself is exercised end to end by `node tools/runtime-test/capture-farm.mjs`; these are
// the cheap mechanical facts worth pinning in the required unit gate, especially the `--repo` seam
// that lets one lane photograph another lane's farm without copying the tool or conflating SHAs.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CAPTURE_VIEWPORTS,
  DRIVER_ROOT,
  RECEIPT_NOTE,
  consoleErrorFromCdpMessage,
  farmUrlFor,
  isCosmeticConsoleError,
  parseArgs,
  readSourceIdentity,
} from '../tools/runtime-test/capture-farm.mjs';

const git = (...args) => execFileSync('git', ['-C', DRIVER_ROOT, ...args], { encoding: 'utf8' }).trim();

test('the capture matrix is exactly the two required iPad viewports', () => {
  assert.deepEqual(
    CAPTURE_VIEWPORTS.map(({ name, width, height }) => [name, width, height]),
    [['landscape', 1024, 768], ['portrait', 768, 1024]],
  );
  for (const viewport of CAPTURE_VIEWPORTS) {
    assert.equal(viewport.mobile, true, `${viewport.name} must emulate a mobile device`);
  }
});

test('the farm URL is built from a server origin, never from the retained game URL', () => {
  assert.equal(farmUrlFor('http://127.0.0.1:5202'), 'http://127.0.0.1:5202/farm/');
  // `owned-server`'s `url` is `/?hero=...`; pasting a path onto it is the documented trap this
  // driver avoids by taking `origin`. `farmUrlFor` must therefore behave for a bare origin only.
  assert.throws(() => farmUrlFor('not a url'));
});

test('--repo resolves the checkout to serve without changing the driver checkout', () => {
  const options = parseArgs(['--repo', './some/checkout'], { cwd: '/work', driverRoot: '/driver' });
  assert.equal(options.repoRoot, '/work/some/checkout');
  const absolute = parseArgs(['--repo', '/abs/checkout'], { cwd: '/work', driverRoot: '/driver' });
  assert.equal(absolute.repoRoot, '/abs/checkout');
});

test('omitting --repo captures the driver checkout itself', () => {
  assert.equal(parseArgs([], { driverRoot: '/driver' }).repoRoot, '/driver');
});

test('the driver options parse, and a flag with no value fails loudly', () => {
  const options = parseArgs(['--out', 'rel/out', '--label', 'muse-p3', '--headed', '--quiet'],
    { cwd: '/work', driverRoot: '/driver' });
  assert.equal(options.outDir, '/work/rel/out');
  assert.equal(options.label, 'muse-p3');
  assert.equal(options.headed, true);
  assert.equal(options.quiet, true);
  assert.throws(() => parseArgs(['--repo', '--headed'], { driverRoot: '/driver' }), /--repo needs a value/);
});

test('the default output root is the review-suite evidence path, overridable per task', () => {
  const options = parseArgs([], { cwd: '/work', driverRoot: '/driver' });
  assert.equal(options.outDir, '/driver/.local/runtime-test/farm-capture');
  const redirected = parseArgs(['--out', '.local/armada/farm-capture'], { cwd: '/work', driverRoot: '/driver' });
  assert.equal(redirected.outDir, '/work/.local/armada/farm-capture');
});

test('the driver can bind a capture to the exact worktree and SHA of both checkouts', () => {
  const identity = readSourceIdentity(DRIVER_ROOT);
  assert.equal(identity.available, true);
  assert.equal(identity.path, git('rev-parse', '--show-toplevel'));
  assert.equal(identity.headSha, git('rev-parse', 'HEAD'));
  assert.match(identity.headSha, /^[0-9a-f]{40}$/);
  assert.equal(typeof identity.dirty, 'boolean');
});

test('a --repo that is not a git checkout is reported, not thrown', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gq-capture-nonrepo-'));
  try {
    const identity = readSourceIdentity(dir);
    assert.equal(identity.available, false);
    assert.equal(identity.path, dir);
    assert.ok(identity.reason.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('console errors are classified as errors, not warnings or logs', () => {
  assert.match(consoleErrorFromCdpMessage({
    method: 'Runtime.exceptionThrown',
    params: { exceptionDetails: { exception: { description: 'TypeError: nope' } } },
  }), /TypeError: nope/);
  assert.equal(consoleErrorFromCdpMessage({
    method: 'Log.entryAdded',
    params: { entry: { level: 'error', text: 'Failed to load', url: 'http://x/farm/src/main.js' } },
  }), 'Failed to load [http://x/farm/src/main.js]');
  assert.equal(consoleErrorFromCdpMessage({
    method: 'Runtime.consoleAPICalled',
    params: { type: 'error', args: [{ value: 'boom' }] },
  }), 'boom');
  assert.equal(consoleErrorFromCdpMessage({
    method: 'Runtime.consoleAPICalled', params: { type: 'warning', args: [{ value: 'hmm' }] },
  }), null);
  assert.equal(consoleErrorFromCdpMessage({ method: 'Log.entryAdded', params: { entry: { level: 'info' } } }), null);
  assert.equal(consoleErrorFromCdpMessage({ method: 'Network.loadingFailed' }), null);
});

test('a browser-provoked favicon 404 is cosmetic, a real error is not', () => {
  // The full Chrome on the hosted runner fetches /favicon.ico for the farm page; the local
  // headless-shell never does. That 404 must not fail the console gate, or CI rejects a clean run.
  assert.equal(isCosmeticConsoleError(
    'Failed to load resource: the server responded with a status of 404 (Not Found) '
    + '[http://127.0.0.1:5202/favicon.ico]',
  ), true);
  // ...but the allowlist must stay narrow: a 500 on the same URL is not a benign 404, and a real
  // missing game asset is not a favicon.
  assert.equal(isCosmeticConsoleError(
    'Failed to load resource: the server responded with a status of 500 (Internal Server Error) '
    + '[http://127.0.0.1:5202/favicon.ico]',
  ), false);
  assert.equal(isCosmeticConsoleError(
    'Failed to load resource: the server responded with a status of 404 (Not Found) '
    + '[http://127.0.0.1:5202/assets/egg.glb]',
  ), false);
  assert.equal(isCosmeticConsoleError('TypeError: nope'), false);
});

test('the receipt note never lets an emulated capture read as human acceptance', () => {
  assert.match(RECEIPT_NOTE, /never accept/);
  assert.match(RECEIPT_NOTE, /real iPad/);
});

test('the --repo choice reaches the owned server and storage is cleared before navigation', () => {
  const source = readFileSync(join(DRIVER_ROOT, 'tools', 'runtime-test', 'capture-farm.mjs'), 'utf8');
  assert.match(source, /startOwnedServer\(\{\s*repoRoot:\s*options\.repoRoot/,
    'the served checkout must be the --repo checkout, or the receipt names the wrong source');
  assert.ok(source.indexOf('Storage.clearDataForOrigin') < source.indexOf('Page.navigate'),
    'GQ-008: the clear must precede the first navigation');
});

test('the driver gates that both checkouts are git checkouts, so the receipt can bind a SHA', () => {
  const source = readFileSync(join(DRIVER_ROOT, 'tools', 'runtime-test', 'capture-farm.mjs'), 'utf8');
  // readSourceIdentity reports a non-checkout instead of throwing; if the driver never gates that
  // report, a bad --repo writes an undefined-SHA receipt under a wall of PASS.
  assert.match(source,
    /check\('the driver checkout is a git checkout[^']*',\s*driverSource\.available/);
  assert.match(source,
    /check\('the served checkout is a git checkout[^']*',\s*servedSource\.available/);
});
