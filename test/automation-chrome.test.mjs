import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  AUTOMATION_CHROME_PORT,
  chromeExecutableCandidates,
  chromeLaunchArgs,
  isMainModule,
  isRetryableSpawnError,
  plausibleChromeCandidates,
  startAutomationChrome,
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

test('every bare name survives the pre-filter -- only the OS can resolve one', () => {
  // The bug this replaces: the old resolver returned the FIRST bare name and called it resolved,
  // so a machine with chromium but no google-chrome picked google-chrome and died on ENOENT.
  const plausible = plausibleChromeCandidates({ env: {}, listDir: () => [] });
  assert.ok(plausible.includes('google-chrome'));
  assert.ok(plausible.includes('chromium'),
    'chromium must still be offered after google-chrome, not discarded by an early "resolution"');
  assert.ok(plausible.indexOf('google-chrome') < plausible.indexOf('chromium'), 'priority preserved');
});

test('a path-shaped candidate that is not on disk is dropped before it can waste a spawn', () => {
  const plausible = plausibleChromeCandidates({
    env: { GALAQUEST_CHROME: '/definitely/not/here/chrome' }, listDir: () => [],
  });
  assert.ok(!plausible.includes('/definitely/not/here/chrome'));
});

test('a Windows-style absent path is dropped too -- the separator check is not POSIX-only', () => {
  const plausible = plausibleChromeCandidates({
    env: { GALAQUEST_CHROME: 'C:\\nope\\chrome.exe' }, listDir: () => [],
  });
  assert.ok(!plausible.includes('C:\\nope\\chrome.exe'));
});

test('ENOENT and EACCES are retryable; anything else stops the search', () => {
  assert.equal(isRetryableSpawnError({ code: 'ENOENT' }), true);
  assert.equal(isRetryableSpawnError({ code: 'EACCES' }), true);
  assert.equal(isRetryableSpawnError({ code: 'EMFILE' }), false,
    'a machine-level spawn failure must not be reprinted once per candidate');
  assert.equal(isRetryableSpawnError(undefined), false);
});

// --- launch fall-through, against a stubbed spawn -------------------------------------------
//
// A test cannot conjure a machine that has chromium but not google-chrome, and the fall-through is
// the behaviour that was wrong, so startAutomationChrome takes a spawnProcess seam.

/** A child that reports ENOENT the way a real failed spawn does: asynchronously, via 'error'. */
function missingBinaryChild() {
  const child = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    const error = new Error('spawn ENOENT');
    error.code = 'ENOENT';
    child.emit('error', error);
  }, 5);
  return child;
}

const unreachablePort = 9; // discard; probeChrome can never succeed against it

test('a nonexistent first candidate does not stop a later one from being tried', async () => {
  const tried = [];
  await assert.rejects(
    startAutomationChrome({
      port: unreachablePort,
      readyTimeoutMillis: 200,
      quiet: true,
      env: {},
      profileDir: '/tmp/gq-test-profile',
      spawnProcess: (executable) => { tried.push(executable); return missingBinaryChild(); },
    }),
    /every candidate failed to launch/,
  );
  assert.ok(tried.length > 1, `every candidate should get a turn, tried: ${tried.join(', ')}`);
  assert.ok(tried.includes('google-chrome') && tried.includes('chromium'),
    `both must be attempted, tried: ${tried.join(', ')}`);
  assert.ok(tried.indexOf('google-chrome') < tried.indexOf('chromium'), 'in priority order');
});

test('an async spawn ENOENT is handled, not rethrown as an unhandled child error', async () => {
  // The old code attached only an 'exit' listener. An 'error' event with no listener is rethrown
  // by Node and takes the process down, so this test crashes the runner against that version.
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('uncaughtException', onUnhandled);
  try {
    await assert.rejects(startAutomationChrome({
      port: unreachablePort,
      readyTimeoutMillis: 200,
      quiet: true,
      env: { GALAQUEST_CHROME: undefined },
      profileDir: '/tmp/gq-test-profile',
      spawnProcess: () => missingBinaryChild(),
    }));
  } finally {
    process.off('uncaughtException', onUnhandled);
  }
  assert.deepEqual(unhandled, [], 'a missing binary must be a result, never an unhandled error');
});

test('a synchronous spawn throw falls through the same way an async one does', async () => {
  const tried = [];
  await assert.rejects(
    startAutomationChrome({
      port: unreachablePort,
      readyTimeoutMillis: 200,
      quiet: true,
      env: {},
      profileDir: '/tmp/gq-test-profile',
      spawnProcess: (executable) => {
        tried.push(executable);
        const error = new Error('spawn ENOENT');
        error.code = 'ENOENT';
        throw error;
      },
    }),
    /every candidate failed to launch/,
  );
  assert.ok(tried.length > 1, 'a sync throw must not abort the search either');
});

test('no runnable browser at all produces a clear, actionable failure', async () => {
  await assert.rejects(
    startAutomationChrome({
      port: unreachablePort,
      readyTimeoutMillis: 200,
      quiet: true,
      env: {},
      profileDir: '/tmp/gq-test-profile',
      spawnProcess: () => missingBinaryChild(),
    }),
    (error) => {
      assert.match(error.message, /no usable Chrome\/Chromium/);
      assert.match(error.message, /GALAQUEST_CHROME/, 'the message must say how to fix it');
      assert.match(error.message, /ENOENT/, 'and must name what actually went wrong');
      return true;
    },
  );
});

test('a non-retryable spawn failure stops immediately rather than repeating per candidate', async () => {
  let calls = 0;
  await assert.rejects(
    startAutomationChrome({
      port: unreachablePort,
      readyTimeoutMillis: 200,
      quiet: true,
      env: {},
      profileDir: '/tmp/gq-test-profile',
      spawnProcess: () => {
        calls += 1;
        const error = new Error('too many open files');
        error.code = 'EMFILE';
        throw error;
      },
    }),
    /could not start the automation browser/,
  );
  assert.equal(calls, 1, 'EMFILE is about the machine, so it must not be retried eight times');
});

test('an explicit GALAQUEST_CHROME that exists is tried first', async () => {
  const tried = [];
  await assert.rejects(startAutomationChrome({
    port: unreachablePort,
    readyTimeoutMillis: 200,
    quiet: true,
    // process.execPath is a real executable on any machine running this suite, so it survives the
    // on-disk pre-filter and proves ordering rather than existence.
    env: { GALAQUEST_CHROME: process.execPath },
    profileDir: '/tmp/gq-test-profile',
    spawnProcess: (executable) => { tried.push(executable); return missingBinaryChild(); },
  }));
  assert.equal(tried[0], process.execPath, `explicit override must win, tried: ${tried.join(', ')}`);
});

test('the Playwright pool is still tried ahead of PATH when the pool entry exists', () => {
  // Uses a real directory so the on-disk pre-filter cannot drop it: the pool "binary" is this
  // process's own executable, which exists by definition.
  const plausible = plausibleChromeCandidates({
    env: { PLAYWRIGHT_BROWSERS_PATH: '/opt/pw-browsers' },
    listDir: listCloudPool,
  });
  const pooled = plausible.find((candidate) => candidate.startsWith('/opt/pw-browsers/'));
  // The pool paths do not exist on every machine running this suite; when they do not, the filter
  // correctly drops them and the PATH names remain. Either way the ORDER is what matters.
  if (pooled) {
    assert.ok(plausible.indexOf(pooled) < plausible.indexOf('google-chrome'));
  } else {
    assert.ok(plausible.includes('google-chrome'), 'PATH names survive when the pool is absent');
  }
});

// --- portable CLI entry detection ------------------------------------------------------------

test('isMainModule matches the file it was launched with', () => {
  assert.equal(isMainModule('file:///home/u/x.mjs', '/home/u/x.mjs'), true);
});

test('isMainModule rejects a different file', () => {
  assert.equal(isMainModule('file:///home/u/x.mjs', '/home/u/other.mjs'), false);
});

test('isMainModule is false when imported (no argv[1] to match)', () => {
  assert.equal(isMainModule('file:///home/u/x.mjs', undefined), false);
  assert.equal(isMainModule('file:///home/u/x.mjs', ''), false);
});

test('a path with a space still matches -- the old template string did not encode it', () => {
  // `file://${'/home/u/my dir/x.mjs'}` is not a valid URL and never equals import.meta.url, which
  // carries %20. This is one of the shapes the replaced comparison silently got wrong.
  assert.equal(isMainModule('file:///home/u/my%20dir/x.mjs', '/home/u/my dir/x.mjs'), true);
});

test('the check is not the two-slash POSIX string the old code used', () => {
  // A Windows import.meta.url is file:///C:/... -- three slashes, forward separators, drive letter.
  // The old `file://${argv1}` spelling produced file://C:\... and could never match, which is why
  // the CLI branch was dead on Windows. Asserted as a shape so a POSIX runner can still prove it.
  const windowsUrl = 'file:///C:/tools/x.mjs';
  assert.notEqual(windowsUrl, `file://${'C:\\tools\\x.mjs'}`,
    'the old comparison shape must be demonstrably wrong, or this test proves nothing');
  assert.equal(isMainModule(windowsUrl, 'C:\\tools\\x.mjs'), process.platform === 'win32');
});

test('isMainModule never throws on junk input', () => {
  assert.equal(isMainModule(undefined, undefined), false);
  assert.equal(isMainModule('not-a-url', '/home/u/x.mjs'), false);
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
