import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATION_CHROME_PORT,
  chromeExecutableCandidates,
  chromeLaunchArgs,
  resolveChromeExecutable,
} from '../tools/runtime-test/automation-chrome.mjs';

// The pool a Claude Code cloud container actually ships, as observed on 2026-09-19:
// PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers holding chromium, chromium-1194,
// chromium_headless_shell-1194 and ffmpeg-1011. The build-numbered names are the reason this module
// reads the directory instead of hard-coding a path.
const CLOUD_POOL = ['chromium', 'chromium-1194', 'chromium_headless_shell-1194', 'ffmpeg-1011'];
const listCloudPool = (dir) => (dir === '/opt/pw-browsers' ? CLOUD_POOL : []);

test('an explicit GALAQUEST_CHROME outranks everything else', () => {
  const candidates = chromeExecutableCandidates({
    env: { GALAQUEST_CHROME: '/opt/my/chrome', PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' },
    listDir: listCloudPool,
  });
  assert.equal(candidates[0], '/opt/my/chrome');
});

test('the Playwright pool is searched, so a container with no chrome on PATH still resolves one', () => {
  const candidates = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' },
    listDir: listCloudPool,
  });
  assert.equal(candidates[0], '/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
});

test('the full Chromium build outranks the headless shell -- the harnesses photograph WebGL', () => {
  const candidates = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' },
    listDir: listCloudPool,
  });
  const fullBuild = candidates.indexOf('/opt/pw-browsers/chromium-1194/chrome-linux/chrome');
  const shell = candidates.indexOf('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
  assert.ok(fullBuild >= 0 && shell >= 0, `both builds should be offered: ${candidates.join(', ')}`);
  assert.ok(fullBuild < shell, 'the full build must be preferred over the headless shell');
});

test('a newer pool build is preferred over an older one', () => {
  const candidates = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/pool' },
    listDir: () => ['chromium-1100', 'chromium-1194', 'chromium-980'],
  });
  assert.equal(candidates[0], '/pool/chromium-1194/chrome-linux/chrome');
});

test('PLAYWRIGHT_BROWSERS_PATH=0 means "no pool", not a directory named 0', () => {
  const candidates = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
    listDir: () => { throw new Error('the pool must not be read when it is disabled'); },
  });
  assert.ok(candidates.every((candidate) => !candidate.startsWith('0/')), candidates.join(', '));
});

test('an unreadable or absent pool degrades to the PATH names rather than throwing', () => {
  const candidates = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/nope' },
  });
  assert.ok(candidates.includes('chromium'), candidates.join(', '));
  assert.ok(candidates.includes('google-chrome'), candidates.join(', '));
});

test('a desktop with no pool still offers ordinary PATH names', () => {
  const candidates = chromeExecutableCandidates({ env: {}, listDir: () => [] });
  assert.ok(candidates.includes('google-chrome'));
  assert.ok(candidates.includes('chromium'));
});

test('sabotage: the candidate list is not a constant -- the environment really changes it', () => {
  const withPool = chromeExecutableCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' }, listDir: listCloudPool,
  });
  const without = chromeExecutableCandidates({ env: {}, listDir: () => [] });
  assert.notDeepEqual(withPool, without);
});

test('a bare PATH name resolves without touching the filesystem; an absent absolute path does not', () => {
  // Only the absolute candidate is existence-checked, which is what lets `chromium` resolve on a
  // desktop where this process cannot see PATH resolution.
  assert.equal(resolveChromeExecutable({ env: {}, listDir: () => [] }), 'google-chrome');
  assert.equal(
    resolveChromeExecutable({ env: { GALAQUEST_CHROME: '/definitely/not/here/chrome' }, listDir: () => [] }),
    'google-chrome',
    'a GALAQUEST_CHROME that does not exist must fall through rather than be handed to spawn',
  );
});

test('the launch flags open CDP on the automation port, bound to loopback', () => {
  const args = chromeLaunchArgs({ profileDir: '/tmp/p' });
  assert.ok(args.includes(`--remote-debugging-port=${AUTOMATION_CHROME_PORT}`));
  assert.ok(args.includes('--remote-debugging-address=127.0.0.1'),
    'an unauthenticated debugging port must not be offered off-host');
});

test('9224, not 9223 -- 9223 is the owner\'s signed-in browser', () => {
  assert.equal(AUTOMATION_CHROME_PORT, 9224);
});

test('the profile is always the dedicated one the caller named', () => {
  const args = chromeLaunchArgs({ profileDir: '/tmp/galaquest-automation-chrome' });
  assert.ok(args.includes('--user-data-dir=/tmp/galaquest-automation-chrome'));
});

test('headless carries a software rasteriser, or the WebGL captures come back empty', () => {
  const args = chromeLaunchArgs({ profileDir: '/tmp/p', headless: true });
  assert.ok(args.includes('--headless=new'));
  assert.ok(args.includes('--use-angle=swiftshader'));
  assert.ok(args.includes('--enable-unsafe-swiftshader'));
});

test('headed drops --headless and --no-sandbox -- a desktop browser has no excuse for either', () => {
  const args = chromeLaunchArgs({ profileDir: '/tmp/p', headless: false });
  assert.ok(!args.includes('--headless=new'));
  assert.ok(!args.includes('--no-sandbox'));
  // ...but still needs the rasteriser flags, because a headed run on a GPU-less box renders nothing
  // either, and the flags are a no-op where real hardware is available.
  assert.ok(args.includes('--use-angle=swiftshader'));
});

test('the page to open is last, after every flag', () => {
  const args = chromeLaunchArgs({ profileDir: '/tmp/p' });
  assert.equal(args.at(-1), 'about:blank');
});

test('sabotage: the flag list is not a constant -- port and profile really reach it', () => {
  const a = chromeLaunchArgs({ port: 9224, profileDir: '/tmp/a' });
  const b = chromeLaunchArgs({ port: 9999, profileDir: '/tmp/b' });
  assert.notDeepEqual(a, b);
  assert.ok(b.includes('--remote-debugging-port=9999'));
});
